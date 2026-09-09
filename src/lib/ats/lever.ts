/**
 * Lever job-board client.
 *
 * Lever is one of the ATS platforms we monitor (spec section 4 & 6). Every
 * company that uses Lever publishes a free, public, read-only JSON feed of
 * its open postings at:
 *
 *   https://api.lever.co/v0/postings/{company}?mode=json
 *
 * `{company}` is the short slug Lever assigns the company (e.g. "netflix").
 * `mode=json` just tells Lever "give me JSON, not an HTML careers page."
 *
 * Unlike Greenhouse's response (one object with a "jobs" array), Lever's
 * endpoint returns a bare JSON array of postings directly.
 *
 * This file's only job is: call that URL, make sure the response actually
 * looks like a Lever posting list, and convert every posting into our
 * internal CanonicalJob format (spec section 7) so the rest of the app
 * never has to know Lever exists.
 */

import { z } from "zod";
import type { CanonicalJob, RemoteType } from "@/lib/jobs/types";
import { stripHtml } from "./html";

/**
 * Thrown whenever something goes wrong talking to Lever.
 *
 * `retryable` tells the caller (the continuous scanner, spec section 5)
 * whether it makes sense to back off and try again later, or whether it
 * should give up on this board entirely:
 *   - HTTP 429 (rate limited) or 5xx (Lever having a bad day)   -> retryable
 *   - HTTP 404 (the company slug doesn't exist / was removed)   -> NOT retryable
 *   - a 200 response whose JSON doesn't match what we expect     -> NOT retryable
 *     (retrying won't fix a schema mismatch; a human needs to look at it)
 */
export class LeverApiError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number }) {
    super(message);
    this.name = "LeverApiError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

// --- Shape of one Lever posting, just enough to trust it --------------------
//
// We only declare the fields we actually use. `id` and `text` (Lever's name
// for the job title) are required because sourceJobId and title are
// non-nullable on CanonicalJob - a posting missing either is treated as a
// malformed response rather than silently skipped.

const LeverCategoriesSchema = z
  .object({
    location: z.string().nullable().optional(),
    commitment: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const LeverListSchema = z.object({
  text: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
});

const LeverPostingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().nullable().optional(),
  applyUrl: z.string().nullable().optional(),
  // Epoch milliseconds, per Lever's documented posting format.
  createdAt: z.number().nullable().optional(),
  categories: LeverCategoriesSchema,
  description: z.string().nullable().optional(),
  lists: z.array(LeverListSchema).nullable().optional(),
  // Lever's newer field describing on-site/hybrid/remote arrangement.
  workplaceType: z.string().nullable().optional(),
});

const LeverResponseSchema = z.array(LeverPostingSchema);

type LeverPosting = z.infer<typeof LeverPostingSchema>;

/**
 * Builds the full plain-text job description by combining Lever's intro
 * paragraph with every labelled section (e.g. "Requirements"), so nothing
 * from the original posting is lost.
 */
function buildDescription(posting: LeverPosting): string {
  const parts: string[] = [];
  if (posting.description) {
    parts.push(stripHtml(posting.description));
  }
  for (const section of posting.lists ?? []) {
    const heading = section.text ? stripHtml(section.text) : "";
    const body = section.content ? stripHtml(section.content) : "";
    if (heading || body) {
      parts.push([heading, body].filter(Boolean).join("\n"));
    }
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}

/**
 * Maps Lever's "workplaceType" field to our RemoteType enum. Lever exposes
 * this directly (values like "on-site", "hybrid", "remote"), so unlike
 * Greenhouse this isn't a guess - we only fall back to "unknown" when the
 * field is missing or has a value we don't recognize.
 */
function mapWorkplaceType(workplaceType: string | null | undefined): RemoteType {
  if (!workplaceType) {
    return "unknown";
  }
  const normalized = workplaceType.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "remote") {
    return "remote";
  }
  if (normalized === "hybrid") {
    return "hybrid";
  }
  if (normalized === "onsite") {
    return "onsite";
  }
  return "unknown";
}

/**
 * Converts one Lever posting into our CanonicalJob format.
 *
 * Salary is deliberately left null: Lever's public postings endpoint (the
 * `mode=json` feed this client calls) does not request or guarantee
 * compensation data, so rather than guess at an undocumented field we treat
 * it as absent, per the project rule of never fabricating data.
 */
function toCanonicalJob(posting: LeverPosting, companyName: string): CanonicalJob {
  const canonicalUrl = posting.hostedUrl ?? posting.applyUrl;
  if (!canonicalUrl) {
    // CanonicalUrl is required (non-nullable) - a posting with neither a
    // hostedUrl nor an applyUrl is not something we can safely represent.
    throw new LeverApiError(
      `Lever posting "${posting.id}" (${posting.text}) has no hostedUrl or applyUrl to use as its canonical link.`,
      { retryable: false },
    );
  }

  const postedAt =
    typeof posting.createdAt === "number" ? new Date(posting.createdAt) : null;

  return {
    companyName,
    source: "Lever",
    sourceJobId: posting.id,
    atsType: "lever",
    title: posting.text,
    location: posting.categories?.location ?? null,
    remoteType: mapWorkplaceType(posting.workplaceType),
    employmentType: posting.categories?.commitment ?? null,
    // See function comment above: not requested/guaranteed by this feed.
    salaryMin: null,
    salaryMax: null,
    currency: null,
    description: buildDescription(posting),
    canonicalUrl,
    sourcePostedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
  };
}

/**
 * Fetches every open posting by one company on Lever.
 *
 * This is the only exported entry point most callers need. Give it the
 * company's Lever slug (e.g. "netflix") and the company's display name
 * (used to fill CanonicalJob.companyName, since Lever's feed itself doesn't
 * include a company name), and you get back a fully normalized, validated
 * job list ready for deduplication and scoring.
 *
 * If Lever is unreachable, rate-limiting us, returning a broken board, or
 * sending back JSON that doesn't look like a real posting list, this throws
 * a LeverApiError instead of silently returning an empty array - an empty
 * array would look exactly like "this company has no internships right
 * now" and the scanner would wrongly treat a working board as quiet.
 */
export async function fetchLeverJobs(
  company: string,
  companyName: string,
): Promise<CanonicalJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "InternshipAutopilot/1.0 (+job-discovery; contact: internship-autopilot)",
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw new LeverApiError(
      `Network error fetching Lever postings for "${company}": ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new LeverApiError(
        `Lever company "${company}" was not found (404). The company slug is likely wrong or the board was removed.`,
        { retryable: false, statusCode: 404 },
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new LeverApiError(
        `Lever returned HTTP ${response.status} for company "${company}" (rate-limited or server error).`,
        { retryable: true, statusCode: response.status },
      );
    }
    throw new LeverApiError(
      `Lever returned unexpected HTTP ${response.status} for company "${company}".`,
      { retryable: false, statusCode: response.status },
    );
  }

  // If the server returns 200 with a body that isn't valid JSON (truncated
  // response, proxy interstitial, HTML error page), the .json() call throws
  // a SyntaxError. We catch that and rethrow as a retryable LeverApiError,
  // because truncation or proxy issues are transient conditions worth retrying,
  // unlike a schema mismatch which is a permanent problem.
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch (error) {
    // Every failure here is wrapped, not just SyntaxError. Reading the body
    // can also fail with a TypeError if the connection drops mid-download, or
    // an AbortError if the 15s timeout fires while the body is still
    // streaming. Those are exactly as transient as malformed JSON, and if we
    // let them through unwrapped the scanner's backoff logic - which keys off
    // LeverApiError.retryable - would never see them.
    throw new LeverApiError(
      `Lever returned an unreadable response body for company "${company}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true },
    );
  }

  const parsed = LeverResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new LeverApiError(
      `Lever response for company "${company}" did not match the expected posting-list shape: ${parsed.error.message}`,
      { retryable: false },
    );
  }

  return parsed.data.map((posting) => toCanonicalJob(posting, companyName));
}
