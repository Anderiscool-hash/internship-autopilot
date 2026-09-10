/**
 * Auto-apply rules (spec §18).
 *
 * This is the decision that actually matters in the whole product: whether a
 * program submits an application to a real employer in someone's name without
 * asking first. So it is a pure function with every input passed in — no
 * database, no clock, no network — which means the decision is reproducible
 * and every one of its reasons is testable.
 *
 * Three verdicts, and the middle one is the important one:
 *
 *   auto     every rule passed; the worker may submit
 *   review   nothing is wrong, but a person should look first
 *   blocked  a rule says no; do not submit, now or on retry
 *
 * The default everywhere is the cautious one. Spec §18's own example config
 * ends with `unknown: false` — an ATS nobody has explicitly enabled does not
 * get auto-applied to — and that principle is applied to every unknown value
 * here, not just to ATS platforms.
 */

/** What may happen automatically on a given ATS (spec §18's per-ATS map). */
export type AutoApplyMode = "AUTO" | "REVIEW" | "DISABLED";

/** The thresholds and limits from spec §18. */
export interface AutoApplyRules {
  /** Jobs scoring below this are never queued (0-100). */
  minimumFitScore: number;
  /** Even a great match will not auto-submit below this (0-100, spec §17). */
  minimumApplicationConfidence: number;
  /** Ignore postings older than this, likely already filled. */
  maximumPostingAgeHours: number;
  dailyApplicationLimit: number;
  maxApplicationsPerCompany: number;
  /** ATS name (the database enum spelling) to mode. Missing means DISABLED. */
  atsModes: Record<string, AutoApplyMode>;
}

/** Everything known about one candidate application at decision time. */
export interface AutoApplyContext {
  /** Spec §12's fit score, or null if it could not be computed. */
  fitScore: number | null;
  /** Spec §17's application confidence, or null before the form was parsed. */
  applicationConfidence: number | null;
  /** Hard eligibility verdict (spec §11). */
  eligibility: "eligible" | "unconfirmed" | "ineligible";
  /** Whether the posting is still listed on its board. */
  jobOpen: boolean;
  /** When the posting was first seen, for the age rule. */
  firstSeenAt: Date;
  /** The ATS this job lives on, in the database's spelling. */
  atsType: string;
  /** Applications already submitted today. */
  applicationsToday: number;
  /** Applications already submitted to this company. */
  applicationsToCompany: number;
}

export type AutoApplyVerdict = "auto" | "review" | "blocked";

export interface AutoApplyDecision {
  verdict: AutoApplyVerdict;
  /** Why, in plain language. Always populated, including for "auto". */
  reasons: string[];
}

/** Spec §18's defaults, matching the schema's own column defaults. */
export const DEFAULT_RULES: AutoApplyRules = {
  minimumFitScore: 0,
  minimumApplicationConfidence: 0,
  maximumPostingAgeHours: 72,
  dailyApplicationLimit: 25,
  maxApplicationsPerCompany: 3,
  atsModes: {},
};

/** The mode configured for an ATS — absent means disabled (spec §18 `unknown: false`). */
export function modeFor(rules: AutoApplyRules, atsType: string): AutoApplyMode {
  return rules.atsModes[atsType] ?? "DISABLED";
}

/**
 * Decide whether this application may be submitted automatically.
 *
 * Blocking rules are evaluated first and all of them are collected, so the
 * caller can show every reason at once rather than one per retry.
 */
export function decideAutoApply(
  rules: AutoApplyRules,
  context: AutoApplyContext,
  now: Date,
): AutoApplyDecision {
  const blocked: string[] = [];
  const review: string[] = [];

  // --- hard blocks -------------------------------------------------------

  if (context.eligibility === "ineligible") {
    blocked.push("This job fails a hard eligibility requirement (spec §11).");
  }
  if (!context.jobOpen) {
    blocked.push("The posting is no longer listed on its board.");
  }

  const ageHours = (now.getTime() - context.firstSeenAt.getTime()) / (60 * 60 * 1000);
  if (ageHours > rules.maximumPostingAgeHours) {
    blocked.push(
      `Posting is ${Math.floor(ageHours)}h old; your limit is ${rules.maximumPostingAgeHours}h.`,
    );
  }

  if (context.applicationsToday >= rules.dailyApplicationLimit) {
    blocked.push(
      `Daily limit reached (${context.applicationsToday}/${rules.dailyApplicationLimit}).`,
    );
  }
  if (context.applicationsToCompany >= rules.maxApplicationsPerCompany) {
    blocked.push(
      `Already applied to this company ${context.applicationsToCompany} times; your limit is ${rules.maxApplicationsPerCompany}.`,
    );
  }

  const mode = modeFor(rules, context.atsType);
  if (mode === "DISABLED") {
    blocked.push(`Auto-apply is not enabled for ${context.atsType}.`);
  }

  // A fit score below the floor is a block, not a review: spec §18 says such
  // jobs are "never queued for application, auto or otherwise".
  if (context.fitScore !== null && context.fitScore < rules.minimumFitScore) {
    blocked.push(
      `Fit ${context.fitScore}% is below your minimum of ${rules.minimumFitScore}%.`,
    );
  }

  // --- reasons to stop and ask ------------------------------------------

  if (context.eligibility === "unconfirmed") {
    review.push("Eligibility could not be fully confirmed.");
  }

  // An unknown value cannot clear a threshold. It is not a block — the
  // information may simply not have been computed yet — but it can never be
  // an automatic yes.
  if (context.fitScore === null && rules.minimumFitScore > 0) {
    review.push("No fit score was computed, so your minimum cannot be checked.");
  }
  if (context.applicationConfidence === null) {
    review.push("The form has not been parsed yet, so confidence is unknown.");
  } else if (context.applicationConfidence < rules.minimumApplicationConfidence) {
    review.push(
      `Application confidence ${context.applicationConfidence}% is below your minimum of ${rules.minimumApplicationConfidence}%.`,
    );
  }

  if (mode === "REVIEW") {
    review.push(`${context.atsType} is set to review rather than auto.`);
  }

  // --- verdict -----------------------------------------------------------

  if (blocked.length > 0) return { verdict: "blocked", reasons: blocked };
  if (review.length > 0) return { verdict: "review", reasons: review };

  return {
    verdict: "auto",
    reasons: [
      `Eligible, fit ${context.fitScore ?? "n/a"}%, confidence ${context.applicationConfidence ?? "n/a"}%, ${context.atsType} set to auto.`,
    ],
  };
}

/**
 * Read the per-ATS mode map out of the JSON column.
 *
 * The column is `Json` and the schema itself flags this as application-level
 * validation rather than a database guarantee, so anything unrecognized is
 * dropped instead of trusted. A junk value here would decide whether a program
 * submits applications on someone's behalf — the one place in this codebase
 * where being permissive with bad input is least acceptable.
 */
export function readAtsModes(value: unknown): Record<string, AutoApplyMode> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const modes: Record<string, AutoApplyMode> = {};
  for (const [ats, mode] of Object.entries(value as Record<string, unknown>)) {
    if (mode === "AUTO" || mode === "REVIEW" || mode === "DISABLED") {
      modes[ats] = mode;
    }
  }
  return modes;
}
