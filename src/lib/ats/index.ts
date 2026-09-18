/**
 * ATS registry.
 *
 * The company registry (spec section 4) stores an `ats_type` for every
 * company we track. When the continuous scanner (spec section 5) wants to
 * check a company for new jobs, it needs to turn that `ats_type` string
 * into the right fetch function - without a giant switch statement copied
 * into every caller.
 *
 * This file is that lookup table. Callers should use `getAtsJobFetcher`
 * rather than importing each platform's fetch function directly, so adding
 * a new supported ATS later only means updating this one file.
 */

import type { AtsType, CanonicalJob } from "@/lib/jobs/types";
import { fetchGreenhouseJobs } from "./greenhouse";
import { fetchLeverJobs } from "./lever";
import { fetchAshbyJobs } from "./ashby";
import { fetchSmartRecruitersJobs } from "./smartrecruiters";

/**
 * The shape every ATS client function must have: given a company's board
 * identifier on that platform and the company's display name, return its
 * current list of open jobs already converted to our CanonicalJob format.
 */
export type AtsJobFetcher = (
  boardIdentifier: string,
  companyName: string,
) => Promise<CanonicalJob[]>;

/**
 * Thrown when the registry is asked to fetch jobs for an ATS type that
 * doesn't have a client implemented yet (Workday, iCIMS, Jobvite, Oracle,
 * SAP SuccessFactors, and custom career pages - spec section 4 lists these
 * as future work). Callers should catch this and
 * route the company to manual/Level-0 handling (spec section 21) instead of
 * crashing the scan loop.
 */
export class UnsupportedAtsError extends Error {
  readonly atsType: AtsType;

  constructor(atsType: AtsType) {
    super(
      `No job-board client is implemented yet for ATS type "${atsType}". ` +
        `Currently supported: greenhouse, lever, ashby, smartrecruiters.`,
    );
    this.name = "UnsupportedAtsError";
    this.atsType = atsType;
  }
}

/**
 * Maps each ATS type we know how to fetch to its client function. Platforms
 * with no entry here (workday, icims, jobvite, oracle, sap, custom) simply
 * aren't implemented yet - `getAtsJobFetcher` turns a
 * missing entry into a clear UnsupportedAtsError rather than `undefined`
 * silently propagating.
 */
const registry: Partial<Record<AtsType, AtsJobFetcher>> = {
  greenhouse: fetchGreenhouseJobs,
  lever: fetchLeverJobs,
  smartrecruiters: fetchSmartRecruitersJobs,
  ashby: fetchAshbyJobs,
};

/**
 * Looks up the job-fetching function for a given ATS type.
 *
 * This is how the rest of the app should dispatch by `company.atsType`
 * instead of writing `if (atsType === "greenhouse") ... else if (...)`
 * everywhere a scan happens. Throws UnsupportedAtsError for any platform we
 * haven't built a client for yet.
 */
export function getAtsJobFetcher(atsType: AtsType): AtsJobFetcher {
  const fetcher = registry[atsType];
  if (!fetcher) {
    throw new UnsupportedAtsError(atsType);
  }
  return fetcher;
}

/**
 * True if we currently have a working client for this ATS type. Useful for
 * the company registry UI/import flow to warn the user up front, rather
 * than only discovering "unsupported" the first time a scan runs.
 */
export function isAtsSupported(atsType: AtsType): boolean {
  return atsType in registry;
}

// Re-exported so callers who already know the specific platform they want
// can still import it directly from the registry module for convenience.
export { fetchGreenhouseJobs, GreenhouseApiError } from "./greenhouse";
export { fetchLeverJobs, LeverApiError } from "./lever";
export { fetchAshbyJobs, AshbyApiError } from "./ashby";
