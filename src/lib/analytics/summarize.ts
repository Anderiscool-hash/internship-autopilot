/**
 * Search analytics (spec §29).
 *
 * The numbers spec §29 asks for are ratios — response rate, interview rate,
 * offer rate — and ratios over small samples are where a dashboard most easily
 * lies to you. Three applications and one interview is not a 33% interview
 * rate in any useful sense.
 *
 * So every rate here comes back with the counts it was computed from, and a
 * rate over fewer than `MIN_SAMPLE` applications comes back null. The page
 * prints "not enough data yet" rather than a number that would be read as a
 * fact about how the search is going.
 *
 * Pure aggregation over rows the caller has already fetched.
 */

import { ApplicationOutcome } from "@prisma/client";

/** Below this many applications, a percentage is noise rather than a signal. */
export const MIN_SAMPLE = 5;

/** One application, reduced to what the analytics care about. */
export interface AnalyticsApplication {
  appliedAt: Date | null;
  outcome: ApplicationOutcome | null;
  fitScore: number | null;
  companyName: string;
  atsType: string;
}

/** A rate, with the numbers behind it. */
export interface Rate {
  /** 0-100, or null when the sample is too small to mean anything. */
  percent: number | null;
  numerator: number;
  denominator: number;
}

/** The headline numbers from spec §29. */
export interface AnalyticsSummary {
  tracked: number;
  applied: number;
  responses: number;
  interviews: number;
  offers: number;
  rejections: number;
  ghosted: number;
  responseRate: Rate;
  interviewRate: Rate;
  offerRate: Rate;
  /** Mean fit score of applications that were actually submitted. */
  averageFitApplied: number | null;
}

/** A breakdown row, e.g. per company or per ATS (spec §29's "also analyze"). */
export interface Breakdown {
  key: string;
  applied: number;
  interviews: number;
  offers: number;
  interviewRate: Rate;
}

/**
 * Outcomes that mean the employer did something other than ignore you.
 *
 * GHOSTED is deliberately not here — it is the absence of a response, which is
 * the whole reason the rate is worth measuring.
 */
const RESPONSE_OUTCOMES: ApplicationOutcome[] = [
  ApplicationOutcome.OA,
  ApplicationOutcome.INTERVIEW,
  ApplicationOutcome.FINAL_ROUND,
  ApplicationOutcome.OFFER,
  ApplicationOutcome.REJECTED,
];

/** Outcomes that reached at least an interview. */
const INTERVIEW_OUTCOMES: ApplicationOutcome[] = [
  ApplicationOutcome.INTERVIEW,
  ApplicationOutcome.FINAL_ROUND,
  ApplicationOutcome.OFFER,
];

/** Build a rate, refusing to state one on too small a sample. */
export function rate(numerator: number, denominator: number): Rate {
  if (denominator < MIN_SAMPLE) return { percent: null, numerator, denominator };
  return {
    percent: Math.round((numerator / denominator) * 100),
    numerator,
    denominator,
  };
}

/** Everything spec §29's first list asks for. */
export function summarize(applications: AnalyticsApplication[]): AnalyticsSummary {
  const submitted = applications.filter((application) => application.appliedAt !== null);

  const responses = submitted.filter(
    (application) =>
      application.outcome !== null && RESPONSE_OUTCOMES.includes(application.outcome),
  ).length;
  const interviews = countOutcomes(submitted, INTERVIEW_OUTCOMES);
  const offers = countOutcomes(submitted, [ApplicationOutcome.OFFER]);
  const rejections = countOutcomes(submitted, [ApplicationOutcome.REJECTED]);
  const ghosted = countOutcomes(submitted, [ApplicationOutcome.GHOSTED]);

  const scored = submitted.filter((application) => application.fitScore !== null);
  const averageFitApplied =
    scored.length === 0
      ? null
      : Math.round(
          scored.reduce((sum, application) => sum + (application.fitScore ?? 0), 0) /
            scored.length,
        );

  return {
    tracked: applications.length,
    applied: submitted.length,
    responses,
    interviews,
    offers,
    rejections,
    ghosted,
    responseRate: rate(responses, submitted.length),
    interviewRate: rate(interviews, submitted.length),
    offerRate: rate(offers, submitted.length),
    averageFitApplied,
  };
}

/** How many of these applications ended in one of the given outcomes. */
function countOutcomes(
  applications: AnalyticsApplication[],
  outcomes: ApplicationOutcome[],
): number {
  return applications.filter(
    (application) =>
      application.outcome !== null && outcomes.includes(application.outcome),
  ).length;
}

/**
 * Group submitted applications by some property of the job.
 *
 * Used for spec §29's per-company and per-ATS breakdowns. Sorted by volume,
 * because a row with one application is not a finding.
 */
export function breakdownBy(
  applications: AnalyticsApplication[],
  key: (application: AnalyticsApplication) => string,
): Breakdown[] {
  const groups = new Map<string, AnalyticsApplication[]>();

  for (const application of applications) {
    if (application.appliedAt === null) continue;
    const groupKey = key(application);
    const existing = groups.get(groupKey);
    if (existing) existing.push(application);
    else groups.set(groupKey, [application]);
  }

  return [...groups.entries()]
    .map(([groupKey, group]) => {
      const interviews = countOutcomes(group, INTERVIEW_OUTCOMES);
      return {
        key: groupKey,
        applied: group.length,
        interviews,
        offers: countOutcomes(group, [ApplicationOutcome.OFFER]),
        interviewRate: rate(interviews, group.length),
      };
    })
    .sort((a, b) => b.applied - a.applied);
}
