/**
 * Job schema types for the Internship Autopilot.
 *
 * These types represent a unified, normalized job posting that has been
 * extracted from various ATS platforms and career pages. All scraped jobs
 * must be converted into this canonical format before storage and analysis.
 *
 * See spec section 7: Job Normalization.
 */

/**
 * ATS type enumeration.
 * Lists all supported Application Tracking Systems we can parse.
 */
export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "smartrecruiters"
  | "icims"
  | "jobvite"
  | "oracle"
  | "sap"
  | "custom";

/**
 * Remote work arrangement type.
 * Describes whether a role requires on-site presence, offers hybrid options,
 * is fully remote, or if the arrangement is unknown.
 */
export type RemoteType = "onsite" | "hybrid" | "remote" | "unknown";

/**
 * Canonical job posting.
 *
 * This is the unified structure for all job postings after normalization.
 * All jobs from all sources are converted to this format before storage.
 *
 * Why this structure matters:
 * - Deduplication: Fingerprint (SHA256 of companyName + sourceJobId) prevents
 *   storing the same job twice if it appears on multiple boards.
 * - Scoring: AI match engine receives a consistent schema for all jobs.
 * - Tracking: Applications reference canonical_job_id to prevent duplicate
 *   applications to the same role.
 * - Analytics: Consistent data makes reporting accurate across all sources.
 */
export interface CanonicalJob {
  /**
   * Company's official name (normalized).
   * Used in deduplication fingerprint and eligibility checks.
   * Example: "Acme Corporation", "Tesla Inc."
   */
  companyName: string;

  /**
   * Name of the discovery source (ATS system, career page, feed, etc).
   * Example: "Greenhouse", "LinkedIn", "Ashby", "company.com/careers"
   * Used for adapter selection and source tracking in analytics.
   */
  source: string;

  /**
   * The unique ID assigned by the ATS or career page for this posting.
   * Used in deduplication fingerprint to detect the same job posted twice.
   * Example: Greenhouse "job_12345", Lever "abc-def-ghi"
   */
  sourceJobId: string;

  /**
   * Type of ATS platform hosting this job.
   * Used to select the correct Playwright adapter for application workflows.
   * See spec section 22 for adapter details.
   */
  atsType: AtsType;

  /**
   * Job title as posted on the career page.
   * Example: "Software Engineering Intern", "Product Manager"
   * Analyzed by classifier (spec §9) to filter for student roles early.
   */
  title: string;

  /**
   * Job location (city, state, country, or null if not specified).
   * Example: "New York, NY", "San Francisco, CA", null (if remote-only)
   * Null indicates location was not disclosed; see remoteType for work arrangement.
   */
  location: string | null;

  /**
   * Work arrangement: on-site, hybrid, remote, or unknown.
   * Used for eligibility filtering (spec §11) against candidate preferences.
   */
  remoteType: RemoteType;

  /**
   * Employment type (Full-Time, Part-Time, Contract, Internship, etc).
   * Null if not specified in the posting.
   * Used for filtering in eligibility engine and candidate preferences.
   */
  employmentType: string | null;

  /**
   * Minimum salary in annual compensation (in specified currency).
   * Null if not disclosed. Used in eligibility checks and sorting.
   */
  salaryMin: number | null;

  /**
   * Maximum salary in annual compensation (in specified currency).
   * Null if not disclosed. Used in eligibility checks and sorting.
   */
  salaryMax: number | null;

  /**
   * Currency code for salary values (USD, EUR, GBP, etc).
   * Null if salary not disclosed or currency not specified.
   */
  currency: string | null;

  /**
   * Full HTML or plaintext job description from the posting.
   * Used for requirement extraction (spec §10) and AI match scoring (spec §12).
   */
  description: string;

  /**
   * Direct URL to this job posting on the employer's career page.
   * This is the source of truth for availability checks and application submission.
   * Example: "https://careers.example.com/jobs/123"
   */
  canonicalUrl: string;

  /**
   * When this job was posted (if available from the source).
   * Null if the source does not provide this information.
   * Used for filtering by freshness (spec §18, auto-apply rules).
   */
  sourcePostedAt: Date | null;
}
