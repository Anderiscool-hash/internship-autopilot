/**
 * The hard eligibility engine (spec §11).
 *
 * Deliberately separate from match scoring, as the spec insists: this answers
 * "could you take this job at all?", not "how good a fit is it?". A 95% match
 * that requires a security clearance is a zero, and mixing the two would let a
 * high score paper over a hard blocker.
 *
 * Three verdicts per check, and the third one carries the weight:
 *
 *   pass    — the posting stated a requirement and the profile satisfies it
 *   fail    — the posting stated a requirement and the profile contradicts it
 *   unknown — one side or the other never said
 *
 * Unknown never fails. A posting that does not mention sponsorship has not
 * refused it, and a profile with a blank graduation date has not claimed a
 * year. Treating either silence as a "no" would quietly hide jobs the
 * candidate could have had — the one error they can never discover.
 */

import {
  educationRank,
  type EducationLevel,
  type JobRequirements,
} from "./requirements";

/** Verdict for a single requirement. */
export type CheckVerdict = "pass" | "fail" | "unknown";

/** One row of the eligibility table in spec §11. */
export interface EligibilityCheck {
  /** Short name, e.g. "Work authorization". */
  label: string;
  verdict: CheckVerdict;
  /** Plain-language explanation, shown to the reader as-is. */
  reason: string;
}

/** The overall answer. */
export type EligibilityVerdict =
  /** Nothing the posting stated rules the candidate out, and nothing is unknown. */
  | "eligible"
  /** At least one stated requirement is contradicted — do not apply (spec §11). */
  | "ineligible"
  /** Nothing failed, but something neither side stated. */
  | "unconfirmed";

export interface EligibilityResult {
  verdict: EligibilityVerdict;
  checks: EligibilityCheck[];
  /** Just the failing checks, which are the reasons not to apply. */
  blockers: EligibilityCheck[];
}

/** The candidate facts eligibility depends on (spec §2's eligibility-critical fields). */
export interface EligibilityProfile {
  degree: string | null;
  graduationDate: Date | null;
  needsSponsorship: boolean;
  citizenship: string | null;
  workAuthorization: string | null;
  certifications: string[];
  /**
   * Years of professional experience the candidate claims, or null if they
   * have not said. Internships and coursework do not count here — this is the
   * number a posting means when it writes "3+ years of experience".
   *
   * Null is a real answer, not a zero: see experienceCheck for why silence
   * cannot be allowed to fail.
   */
  yearsOfExperience: number | null;
}

/**
 * How many years a posting can ask for before it stops looking like a student
 * role, used ONLY when the profile has not said how much experience it has.
 *
 * JUDGMENT CALL. Spec §11 lists "requires experience above allowed threshold"
 * as a hard failure but never sets the number. Two years is the line where a
 * posting stops being plausibly open to someone still in school; anything at
 * or below it passes, so an internship asking for "1-2 years" is not ruled
 * out. Passed in as a parameter so it can be tuned without touching logic.
 *
 * Note what this number may and may not do. When the profile states a number,
 * the check compares the two stated figures and this constant is not consulted
 * at all. When the profile is silent, exceeding this threshold produces
 * "unknown", never "fail" — the posting said something, the candidate said
 * nothing, and inventing the contradiction is exactly what the header of this
 * file forbids.
 */
export const DEFAULT_MAX_EXPERIENCE_YEARS = 2;

/**
 * Work out what degree level a free-text degree field describes.
 *
 * The field is free text on purpose (spec §2), so this reads it rather than
 * demanding a dropdown. Anything it cannot recognize returns null, which
 * becomes an unknown check rather than a wrong one.
 */
export function inferEducationLevel(degree: string | null): EducationLevel | null {
  if (!degree) return null;
  const text = degree.toLowerCase();

  if (/\bph\.?\s?d\b|\bdoctoral\b|\bdoctorate\b/.test(text)) return "phd";
  if (/\bm\.?s\.?c?\b|\bmaster'?s?\b|\bmba\b|\bm\.?eng\b|\bm\.?a\.?\b/.test(text)) {
    return "masters";
  }
  if (/\bb\.?s\.?c?\b|\bb\.?a\.?\b|\bbachelor'?s?\b|\bundergrad\w*\b/.test(text)) {
    return "bachelors";
  }
  if (/\bassociate'?s?\b|\ba\.?a\.?s?\.?\b/.test(text)) return "associates";

  return null;
}

/** Does this citizenship field satisfy a demand for a given country? */
function citizenshipSatisfies(citizenship: string, required: string): boolean {
  const held = citizenship.toLowerCase();
  const wanted = required.toLowerCase();

  if (wanted.includes("united states")) {
    return /\bu\.?s\.?a?\b|united states|american/.test(held);
  }
  return held.includes(wanted);
}

/** Anything in the profile that evidences an existing clearance. */
function hasClearanceEvidence(profile: EligibilityProfile): boolean {
  const haystack = [...profile.certifications, profile.workAuthorization ?? ""]
    .join(" ")
    .toLowerCase();
  return /clearance|ts\/sci|top secret/.test(haystack);
}

/** Run every hard check and combine them into one verdict. */
export function checkEligibility(
  profile: EligibilityProfile,
  requirements: JobRequirements,
  options: { now?: Date; maxExperienceYears?: number } = {},
): EligibilityResult {
  const maxExperience = options.maxExperienceYears ?? DEFAULT_MAX_EXPERIENCE_YEARS;

  const checks: EligibilityCheck[] = [
    degreeCheck(profile, requirements),
    graduationCheck(profile, requirements),
    experienceCheck(profile, requirements, maxExperience),
    sponsorshipCheck(profile, requirements),
    citizenshipCheck(profile, requirements),
    clearanceCheck(profile, requirements),
  ];

  const blockers = checks.filter((check) => check.verdict === "fail");
  const unknowns = checks.filter((check) => check.verdict === "unknown");

  const verdict: EligibilityVerdict =
    blockers.length > 0 ? "ineligible" : unknowns.length > 0 ? "unconfirmed" : "eligible";

  return { verdict, checks, blockers };
}

function degreeCheck(
  profile: EligibilityProfile,
  requirements: JobRequirements,
): EligibilityCheck {
  const label = "Degree requirement";
  const required = requirements.educationLevel;
  if (required === null) {
    return { label, verdict: "pass", reason: "The posting states no degree requirement." };
  }

  const held = inferEducationLevel(profile.degree);
  if (held === null) {
    return {
      label,
      verdict: "unknown",
      reason: `The posting requires a ${required} degree; your profile does not say what you are studying.`,
    };
  }

  if (educationRank(held) >= educationRank(required)) {
    return { label, verdict: "pass", reason: `Requires ${required}; you have ${held}.` };
  }
  return {
    label,
    verdict: "fail",
    reason: `Requires a ${required} degree; your profile says ${held}.`,
  };
}

function graduationCheck(
  profile: EligibilityProfile,
  requirements: JobRequirements,
): EligibilityCheck {
  const label = "Graduation requirement";
  const window = requirements.graduationWindow;
  if (window === null) {
    return {
      label,
      verdict: "pass",
      reason: "The posting states no graduation window.",
    };
  }

  if (profile.graduationDate === null) {
    return {
      label,
      verdict: "unknown",
      reason: `The posting wants graduates of ${describeWindow(window)}; your profile has no graduation date.`,
    };
  }

  const year = profile.graduationDate.getUTCFullYear();
  if (year >= window.from && year <= window.to) {
    return {
      label,
      verdict: "pass",
      reason: `Wants ${describeWindow(window)}; you graduate ${year}.`,
    };
  }
  return {
    label,
    verdict: "fail",
    reason: `Wants graduates of ${describeWindow(window)}; you graduate ${year}.`,
  };
}

function describeWindow(window: { from: number; to: number }): string {
  return window.from === window.to ? `${window.from}` : `${window.from}–${window.to}`;
}

/**
 * Compare the experience a posting asks for against the experience the
 * candidate claims.
 *
 * This is the one check that used to break the rule at the top of this file.
 * It failed any posting asking for more than a fixed two years, even though
 * the profile never stated a number to contradict — the posting had spoken,
 * the candidate had not, and the engine invented the conflict anyway. That is
 * how a senior-sounding posting and a genuine internship both disappeared for
 * the same reason.
 *
 * Now there are two paths. If the profile states a number, the two stated
 * figures are compared and a shortfall is a real, evidenced "fail". If the
 * profile is silent, a posting over the student-role threshold is "unknown":
 * worth flagging to the reader, never grounds for hiding the job.
 */
function experienceCheck(
  profile: EligibilityProfile,
  requirements: JobRequirements,
  maxYears: number,
): EligibilityCheck {
  const label = "Experience requirement";
  const years = requirements.minimumExperienceYears;
  const held = profile.yearsOfExperience;

  if (years === null) {
    return { label, verdict: "pass", reason: "The posting states no experience minimum." };
  }

  // Both sides stated a number. The comparison is NOT a bare `years <= held`,
  // because the student-role threshold is a floor of leniency that a stated
  // number can raise but never lower.
  //
  // The reason is concrete: a candidate who honestly answers 0 full-time
  // years would otherwise be ruled out of a posting titled "Payment Risk
  // Intern" for asking "1 year of experience" — a line that, on an
  // internship, is counting the coursework and internships this field
  // explicitly excludes. Erring lenient here costs a glance at a posting;
  // erring strict hides a job the candidate could have had and never tells
  // them. Someone with six years still gets the benefit of their six.
  if (held !== null) {
    const allowed = Math.max(held, maxYears);
    if (years <= allowed) {
      return {
        label,
        verdict: "pass",
        reason: `Asks for ${years} years; you have ${held}.`,
      };
    }
    return {
      label,
      verdict: "fail",
      reason: `Asks for ${years} years of experience; your profile says ${held}.`,
    };
  }

  // The profile said nothing. Below the student-role threshold this is
  // plainly fine; above it, say so without ruling the job out.
  if (years <= maxYears) {
    return { label, verdict: "pass", reason: `Asks for ${years} years, within reach.` };
  }
  return {
    label,
    verdict: "unknown",
    reason:
      `Asks for ${years} years of experience — more than the ${maxYears} years typical of a student role. ` +
      "Your profile does not say how many years you have, so this cannot be checked.",
  };
}

function sponsorshipCheck(
  profile: EligibilityProfile,
  requirements: JobRequirements,
): EligibilityCheck {
  const label = "Work authorization";

  if (!profile.needsSponsorship) {
    return {
      label,
      verdict: "pass",
      reason: "You do not need sponsorship.",
    };
  }

  switch (requirements.sponsorship) {
    case "none":
      return {
        label,
        verdict: "fail",
        reason: "You need sponsorship and this posting states it does not sponsor.",
      };
    case "available":
      return {
        label,
        verdict: "pass",
        reason: "You need sponsorship and this posting states it sponsors.",
      };
    default:
      return {
        label,
        verdict: "unknown",
        reason: "You need sponsorship and the posting does not say whether it sponsors.",
      };
  }
}

function citizenshipCheck(
  profile: EligibilityProfile,
  requirements: JobRequirements,
): EligibilityCheck {
  const label = "Citizenship requirement";
  const required = requirements.citizenshipRequired;

  if (required === null) {
    return { label, verdict: "pass", reason: "The posting states no citizenship requirement." };
  }
  if (profile.citizenship === null) {
    return {
      label,
      verdict: "unknown",
      reason: `The posting requires ${required} citizenship; your profile does not state yours.`,
    };
  }
  if (citizenshipSatisfies(profile.citizenship, required)) {
    return { label, verdict: "pass", reason: `Requires ${required} citizenship, which you hold.` };
  }
  return {
    label,
    verdict: "fail",
    reason: `Requires ${required} citizenship; your profile says ${profile.citizenship}.`,
  };
}

function clearanceCheck(
  profile: EligibilityProfile,
  requirements: JobRequirements,
): EligibilityCheck {
  const label = "Security clearance";

  if (!requirements.clearanceRequired) {
    return { label, verdict: "pass", reason: "No clearance required." };
  }
  if (hasClearanceEvidence(profile)) {
    return {
      label,
      verdict: "pass",
      reason: "Clearance required, and your profile records one.",
    };
  }
  return {
    label,
    verdict: "fail",
    reason:
      "Requires an existing security clearance. Nothing in your profile records one — add it to your certifications if you hold it.",
  };
}
