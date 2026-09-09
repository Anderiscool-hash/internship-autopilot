/**
 * Greenhouse job-board client.
 *
 * Greenhouse is one of the ATS platforms we monitor (spec section 4 & 6).
 * Every company that uses Greenhouse publishes a free, public, read-only JSON
 * feed of its open jobs at:
 *
 *   https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
 *
 * `{board}` is the short slug Greenhouse assigns the company (e.g. "airbnb").
 * `content=true` asks Greenhouse to include the full HTML job description in
 * the response so we don't need a second request per job.
 *
 * This file's only job is: call that URL, make sure the response actually
 * looks like a Greenhouse job list (not an error page or a shape we don't
 * recognize), and convert every job into our internal CanonicalJob format
 * (spec section 7) so the rest of the app never has to know Greenhouse
 * exists.
 */

import { z } from "zod";
import type { CanonicalJob, RemoteType } from "@/lib/jobs/types";
import { stripHtml } from "./html";

/**
 * Thrown whenever something goes wrong talking to Greenhouse.
 *
 * `retryable` tells the caller (the continuous scanner, spec section 5)
 * whether it makes sense to back off and try again later, or whether it
 * should give up on this board entirely:
 *   - HTTP 429 (rate limited) or 5xx (Greenhouse having a bad day)  -> retryable
 *   - HTTP 404 (the board slug doesn't exist / was removed)        -> NOT retryable
 *   - a 200 response whose JSON doesn't match what we expect        -> NOT retryable
 *     (retrying won't fix a schema mismatch; a human needs to look at it)
 */
export class GreenhouseApiError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number }) {
    super(message);
    this.name = "GreenhouseApiError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

// --- Shape of Greenhouse's response, just enough to trust it ---------------
//
// We only declare the fields we actually use. Fields are marked optional /
// nullable wherever Greenhouse is known to sometimes omit them, so a normal
// job posting doesn't fail validation just because it lacks, say, a location.
// `id` and `title` and `absolute_url` are required: without those we can't
// build a valid CanonicalJob (sourceJobId, title, and canonicalUrl are all
// non-nullable), so a job missing them is treated as a malformed response.

const GreenhouseLocationSchema = z
  .object({
    name: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const GreenhouseJobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  absolute_url: z.string(),
  location: GreenhouseLocationSchema,
  content: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  // "first_published" is when the job actually first went live; Greenhouse
  // documents this on the public boards API. We prefer it over updated_at
  // (which changes every time the listing is edited) for sourcePostedAt.
  first_published: z.string().nullable().optional(),
});

const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobSchema),
});

type GreenhouseJob = z.infer<typeof GreenhouseJobSchema>;

/**
 * Guesses whether a job is remote/hybrid/onsite from the free-text location
 * Greenhouse gives us. Greenhouse's public API does not expose a dedicated
 * "remote type" field, so this is a best-effort keyword guess, not a fact
 * from the platform. Anything we can't confidently classify comes back as
 * "unknown" rather than guessing wrong.
 */
function inferRemoteType(locationName: string | null): RemoteType {
  if (!locationName) {
    return "unknown";
  }
  const lower = locationName.toLowerCase();
  if (lower.includes("hybrid")) {
    return "hybrid";
  }
  if (lower.includes("remote")) {
    return "remote";
  }
  return "unknown";
}

/**
 * Converts one Greenhouse job into our CanonicalJob format.
 *
 * Fields Greenhouse's public boards API genuinely does not provide
 * (employment type, salary range) are set to null rather than guessed, per
 * the project rule of never fabricating data (spec section 3, Truth Ledger
 * mindset applied to scraping too).
 */
function toCanonicalJob(job: GreenhouseJob, companyName: string): CanonicalJob {
  const locationName = job.location?.name ?? null;
  const postedAtRaw = job.first_published ?? job.updated_at ?? null;
  const postedAt = postedAtRaw ? new Date(postedAtRaw) : null;

  return {
    companyName,
    source: "Greenhouse",
    sourceJobId: String(job.id),
    atsType: "greenhouse",
    title: job.title,
    location: locationName,
    remoteType: inferRemoteType(locationName),
    // Not exposed by Greenhouse's public job-board API.
    employmentType: null,
    // Greenhouse's public feed does not include compensation data.
    salaryMin: null,
    salaryMax: null,
    currency: null,
    description: stripHtml(job.content ?? ""),
    canonicalUrl: job.absolute_url,
    sourcePostedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
  };
}

/**
 * Fetches every open job posted by one company on Greenhouse.
 *
 * This is the only exported entry point most callers need. Give it the
 * company's Greenhouse board slug (e.g. "airbnb") and the company's display
 * name (used to fill CanonicalJob.companyName, since Greenhouse's job feed
 * itself doesn't reliably include a company name), and you get back a fully
 * normalized, validated job list ready for deduplication and scoring.
 *
 * If Greenhouse is unreachable, rate-limiting us, returning a broken board,
 * or sending back JSON that doesn't look like a real job list, this throws
 * a GreenhouseApiError instead of silently returning an empty array - an
 * empty array would look exactly like "this company has no internships
 * right now" and the scanner would wrongly treat a working board as quiet.
 */
export async function fetchGreenhouseJobs(
  board: string,
  companyName: string,
): Promise<CanonicalJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;

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
    // Network failure, DNS failure, or the 15s timeout firing. All of these
    // are transient conditions worth retrying later.
    throw new GreenhouseApiError(
      `Network error fetching Greenhouse board "${board}": ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new GreenhouseApiError(
        `Greenhouse board "${board}" was not found (404). The board slug is likely wrong or the company removed it.`,
        { retryable: false, statusCode: 404 },
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new GreenhouseApiError(
        `Greenhouse returned HTTP ${response.status} for board "${board}" (rate-limited or server error).`,
        { retryable: true, statusCode: response.status },
      );
    }
    throw new GreenhouseApiError(
      `Greenhouse returned unexpected HTTP ${response.status} for board "${board}".`,
      { retryable: false, statusCode: response.status },
    );
  }

  // If the server returns 200 with a body that isn't valid JSON (truncated
  // response, proxy interstitial, HTML error page), the .json() call throws
  // a SyntaxError. We catch that and rethrow as a retryable GreenhouseApiError,
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
    // GreenhouseApiError.retryable - would never see them.
    throw new GreenhouseApiError(
      `Greenhouse returned an unreadable response body for board "${board}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true },
    );
  }

  const parsed = GreenhouseResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new GreenhouseApiError(
      `Greenhouse response for board "${board}" did not match the expected job-list shape: ${parsed.error.message}`,
      { retryable: false },
    );
  }

  return parsed.data.jobs.map((job) => toCanonicalJob(job, companyName));
}
