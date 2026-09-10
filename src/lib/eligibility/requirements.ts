/**
 * What a job posting demands (spec §10).
 *
 * Spec §10 shows this as the output of "convert a job description into
 * structured requirements". Every field here is optional or explicitly
 * "unknown", and that is the point: a posting that never mentions sponsorship
 * has not said anything about sponsorship, and recording that as "sponsorship
 * available" or "no sponsorship" would be inventing a fact about someone
 * else's job (spec §3's second rule).
 *
 * The eligibility engine is built to treat unknown as "cannot rule you out",
 * never as a failure, so honest nulls here are safe.
 */

/** Education levels a posting can demand, in increasing order. */
export const EDUCATION_LEVELS = ["associates", "bachelors", "masters", "phd"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** Rank a level so two can be compared. */
export function educationRank(level: EducationLevel): number {
  return EDUCATION_LEVELS.indexOf(level);
}

/** What the posting says about visa sponsorship. */
export type SponsorshipStance =
  /** The posting states sponsorship is available. */
  | "available"
  /** The posting states it will not sponsor. */
  | "none"
  /** The posting did not say. */
  | "unknown";

/** The years of graduation a posting will accept, inclusive. */
export interface GraduationWindow {
  from: number;
  to: number;
}

/** Structured requirements extracted from one posting. */
export interface JobRequirements {
  /** Lowest degree the posting demands, or null if it did not say. */
  educationLevel: EducationLevel | null;
  /** Graduation years accepted, or null if the posting did not say. */
  graduationWindow: GraduationWindow | null;
  /** Years of experience demanded, or null if the posting did not say. */
  minimumExperienceYears: number | null;
  /** Whether the posting states it will sponsor a visa. */
  sponsorship: SponsorshipStance;
  /** The posting explicitly requires citizenship of a particular country. */
  citizenshipRequired: string | null;
  /** The posting requires an existing security clearance. */
  clearanceRequired: boolean;
}

/** Requirements for a posting that stated nothing we can check. */
export const NO_REQUIREMENTS: JobRequirements = {
  educationLevel: null,
  graduationWindow: null,
  minimumExperienceYears: null,
  sponsorship: "unknown",
  citizenshipRequired: null,
  clearanceRequired: false,
};
