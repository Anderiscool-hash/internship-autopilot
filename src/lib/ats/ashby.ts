/**
 * Ashby job-board client.
 *
 * Ashby is one of the ATS platforms we monitor (spec section 4 & 6). Every
 * company that uses Ashby publishes a free, public, read-only JSON feed of
 * its open jobs at:
 *
 *   https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
 *
 * `{board}` is the short slug Ashby assigns the company (e.g. "ashby"
 * itself, or a hiring company's own slug). `includeCompensation=true` asks
 * Ashby to include salary range data on each job when the company has
 * chosen to publish it.
 *
 * This file's only job is: call that URL, make sure the response actually
 * looks like an Ashby job board, and convert every job into our internal
 * CanonicalJob format (spec section 7) so the rest of the app never has to
 * know Ashby exists.
 */

import { z } from "zod";
import type { CanonicalJob, RemoteType } from "@/lib/jobs/types";
import { stripHtml } from "./html";

/**
 * Thrown whenever something goes wrong talking to Ashby.
 *
 * `retryable` tells the caller (the continuous scanner, spec section 5)
 * whether it makes sense to back off and try again later, or whether it
 * should give up on this board entirely:
 *   - HTTP 429 (rate limited) or 5xx (Ashby having a bad day)  -> retryable
 *   - HTTP 404 (the board slug doesn't exist / was removed)    -> NOT retryable
 *   - a 200 response whose JSON doesn't match what we expect    -> NOT retryable
 *     (retrying won't fix a schema mismatch; a human needs to look at it)
 */
export class AshbyApiError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number }) {
    super(message);
    this.name = "AshbyApiError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

// --- Shape of Ashby's response, just enough to trust it ---------------------
//
// We only declare the fields we actually use. `id` and `title` are required
// because sourceJobId and title are non-nullable on CanonicalJob - a job
// missing either is treated as a malformed response rather than silently
// skipped.

const AshbyCompensationComponentSchema = z.object({
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  currencyCode: z.string().nullable().optional(),
});

const AshbyCompensationSchema = z
  .object({
    summaryComponents: z.array(AshbyCompensationComponentSchema).nullable().optional(),
  })
  .nullable()
  .optional();

const AshbyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullable().optional(),
  // Ashby's simple remote/on-site flag. Always present in practice, but we
  // don't hard-require it in case a job predates the field.
  isRemote: z.boolean().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  descriptionHtml: z.string().nullable().optional(),
  descriptionPlain: z.string().nullable().optional(),
  // ISO 8601 timestamp of when the job was first published.
  publishedAt: z.string().nullable().optional(),
  jobUrl: z.string().nullable().optional(),
  applyUrl: z.string().nullable().optional(),
  compensation: AshbyCompensationSchema,
});

const AshbyResponseSchema = z.object({
  jobs: z.array(AshbyJobSchema),
});

type AshbyJob = z.infer<typeof AshbyJobSchema>;

/**
 * Maps Ashby's "isRemote" flag to our RemoteType enum. Ashby's public feed
 * only tells us remote-or-not, not whether an on-site role is hybrid or
 * fully on-site, so a non-remote job is classified "unknown" rather than
 * guessed as "onsite".
 */
function mapRemoteType(isRemote: boolean | null | undefined): RemoteType {
  if (isRemote === true) {
    return "remote";
  }
  return "unknown";
}

/**
 * Pulls a salary range out of Ashby's optional compensation data.
 *
 * We only trust this because the fetch URL explicitly passes
 * `includeCompensation=true`; if the company hasn't published a range,
 * Ashby simply omits the data and we correctly fall back to nulls instead
 * of inventing a number.
 */
function extractSalary(job: AshbyJob): {
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
} {
  const component = job.compensation?.summaryComponents?.[0];
  if (!component) {
    return { salaryMin: null, salaryMax: null, currency: null };
  }
  return {
    salaryMin: component.minValue ?? null,
    salaryMax: component.maxValue ?? null,
    currency: component.currencyCode ?? null,
  };
}

/**
 * Converts one Ashby job into our CanonicalJob format.
 */
function toCanonicalJob(job: AshbyJob, companyName: string): CanonicalJob {
  const canonicalUrl = job.jobUrl ?? job.applyUrl;
  if (!canonicalUrl) {
    // CanonicalUrl is required (non-nullable) - a job with neither a jobUrl
    // nor an applyUrl is not something we can safely represent.
    throw new AshbyApiError(
      `Ashby job "${job.id}" (${job.title}) has no jobUrl or applyUrl to use as its canonical link.`,
      { retryable: false },
    );
  }

  const postedAt = job.publishedAt ? new Date(job.publishedAt) : null;
  const description = job.descriptionHtml
    ? stripHtml(job.descriptionHtml)
    : job.descriptionPlain
      ? job.descriptionPlain.trim()
      : "";
  const salary = extractSalary(job);

  return {
    companyName,
    source: "Ashby",
    sourceJobId: job.id,
    atsType: "ashby",
    title: job.title,
    location: job.location ?? null,
    remoteType: mapRemoteType(job.isRemote),
    employmentType: job.employmentType ?? null,
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    currency: salary.currency,
    description,
    canonicalUrl,
    sourcePostedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
  };
}

/**
 * Fetches every open job posted by one company on Ashby.
 *
 * This is the only exported entry point most callers need. Give it the
 * company's Ashby board slug and the company's display name (used to fill
 * CanonicalJob.companyName, since we prefer the name the registry already
 * has for the company over trusting the feed), and you get back a fully
 * normalized, validated job list ready for deduplication and scoring.
 *
 * If Ashby is unreachable, rate-limiting us, returning a broken board, or
 * sending back JSON that doesn't look like a real job board, this throws an
 * AshbyApiError instead of silently returning an empty array - an empty
 * array would look exactly like "this company has no internships right
 * now" and the scanner would wrongly treat a working board as quiet.
 */
export async function fetchAshbyJobs(
  board: string,
  companyName: string,
): Promise<CanonicalJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;

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
    throw new AshbyApiError(
      `Network error fetching Ashby board "${board}": ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new AshbyApiError(
        `Ashby board "${board}" was not found (404). The board slug is likely wrong or the company removed it.`,
        { retryable: false, statusCode: 404 },
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new AshbyApiError(
        `Ashby returned HTTP ${response.status} for board "${board}" (rate-limited or server error).`,
        { retryable: true, statusCode: response.status },
      );
    }
    throw new AshbyApiError(
      `Ashby returned unexpected HTTP ${response.status} for board "${board}".`,
      { retryable: false, statusCode: response.status },
    );
  }

  // If the server returns 200 with a body that isn't valid JSON (truncated
  // response, proxy interstitial, HTML error page), the .json() call throws
  // a SyntaxError. We catch that and rethrow as a retryable AshbyApiError,
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
    // AshbyApiError.retryable - would never see them.
    throw new AshbyApiError(
      `Ashby returned an unreadable response body for board "${board}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true },
    );
  }

  const parsed = AshbyResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new AshbyApiError(
      `Ashby response for board "${board}" did not match the expected job-board shape: ${parsed.error.message}`,
      { retryable: false },
    );
  }

  return parsed.data.jobs.map((job) => toCanonicalJob(job, companyName));
}
