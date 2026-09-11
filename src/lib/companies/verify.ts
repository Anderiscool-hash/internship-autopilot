/**
 * Checking a board identifier against the live ATS before trusting it.
 *
 * Spec §4 stores a board token per company — "stripe" on Greenhouse,
 * "palantir" on Lever — and getting it wrong is not a harmless typo. A slug
 * that belongs to a different company returns that company's jobs, and they
 * land in the database under the name you typed. The registry would then be
 * quietly lying, and every downstream number would be computed from it.
 *
 * So a company is never added on the strength of a plausible-looking slug.
 * This asks the ATS, and reports what actually came back.
 */

import { getAtsJobFetcher, UnsupportedAtsError } from "../ats/index";
import type { AtsType } from "../jobs/types";

/** What the live check found. */
export type VerificationResult =
  | {
      ok: true;
      /** How many postings the board returned. */
      jobCount: number;
      /** A few titles, so a human can tell whether this is the right company. */
      sampleTitles: string[];
    }
  | { ok: false; reason: string };

/** The most titles worth showing back as evidence. */
const SAMPLE_SIZE = 3;

/**
 * Fetch a board and report what it holds.
 *
 * An empty board is treated as a failure rather than a success with zero jobs.
 * Every ATS in this registry returns 200 with an empty list for a slug that
 * does not exist, so "no jobs" and "no such board" are indistinguishable from
 * the response alone — and silently accepting the wrong slug is precisely the
 * outcome to avoid. A real company with a genuinely empty board can be added
 * again when it has a posting.
 */
export async function verifyBoard(
  atsType: AtsType,
  identifier: string,
  companyName: string,
): Promise<VerificationResult> {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "No board identifier was given." };
  }

  let fetchJobs;
  try {
    fetchJobs = getAtsJobFetcher(atsType);
  } catch (error) {
    if (error instanceof UnsupportedAtsError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }

  try {
    const jobs = await fetchJobs(trimmed, companyName);

    if (jobs.length === 0) {
      return {
        ok: false,
        reason:
          `"${trimmed}" returned no postings. That usually means the board ` +
          `identifier is wrong — these platforms answer with an empty list ` +
          `rather than an error when the board does not exist.`,
      };
    }

    return {
      ok: true,
      jobCount: jobs.length,
      sampleTitles: jobs.slice(0, SAMPLE_SIZE).map((job) => job.title),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `The board could not be read: ${message}` };
  }
}
