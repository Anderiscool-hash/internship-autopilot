/**
 * Adapter trust levels (spec §21).
 *
 * A level is computed from evidence, never stored: the evidence is the
 * ShadowRun verdicts a human has already recorded, plus what past submissions
 * on this ATS actually did. Storing a level would let it drift from the runs
 * that justified it.
 *
 * Two properties are load-bearing:
 *
 *   - Evidence makes an ATS *eligible*; it never *promotes* it. Level 4 needs a
 *     human opt-in on top of the numbers.
 *   - An unverified run is not evidence. A ShadowRun with a null verdict is a
 *     run nobody checked, and it counts for nothing in either direction.
 */

import type { PrismaClient, AtsType } from "@prisma/client";
import { adapterFor } from "./adapters";

/** 0 unsupported, 1 parse, 2 autofill, 3 review+submit, 4 auto-submit. */
export type TrustLevel = 0 | 1 | 2 | 3 | 4;

/** What is known about an ATS's track record. */
export interface TrustEvidence {
  hasAdapter: boolean;
  verifiedRuns: number;
  correctRuns: number;
  confirmedSubmissions: number;
  wrongSubmissions: number;
  /** The explicit manual opt-in. Never set by evidence. */
  autoSubmitOptIn: boolean;
}

export interface TrustThreshold {
  level: TrustLevel;
  minVerifiedRuns: number;
  minCorrectRate: number;
  minConfirmedSubmissions: number;
  requiresOptIn: boolean;
}

/**
 * Confirmed by the user 2026-09-16. These were the one set of numbers in this
 * feature chosen by the author rather than by the person whose applications are
 * at stake; they have now been reviewed and kept as they stand.
 *
 * The asymmetry that justifies them: at level 3 every application still stops
 * for human approval, so this bar governs only how early the system may *ask*.
 * Level 4 is the unattended one, which is why it carries a much heavier bar and
 * a manual opt-in on top of it.
 *
 * Still deliberately in one place, so changing them is this constant and the
 * table-driven test, nothing else.
 */
export const TRUST_THRESHOLDS: TrustThreshold[] = [
  { level: 1, minVerifiedRuns: 0, minCorrectRate: 0, minConfirmedSubmissions: 0, requiresOptIn: false },
  { level: 2, minVerifiedRuns: 5, minCorrectRate: 0.8, minConfirmedSubmissions: 0, requiresOptIn: false },
  { level: 3, minVerifiedRuns: 10, minCorrectRate: 0.9, minConfirmedSubmissions: 0, requiresOptIn: false },
  { level: 4, minVerifiedRuns: 25, minCorrectRate: 0.95, minConfirmedSubmissions: 10, requiresOptIn: true },
];

/**
 * The share of checked runs that were right, or null if nothing was checked.
 *
 * Null rather than 0 on purpose: zero reads as "always wrong", and "nobody has
 * looked yet" is a different statement.
 */
export function correctRate(evidence: TrustEvidence): number | null {
  if (evidence.verifiedRuns === 0) return null;
  return evidence.correctRuns / evidence.verifiedRuns;
}

function meets(evidence: TrustEvidence, threshold: TrustThreshold): boolean {
  if (threshold.requiresOptIn && !evidence.autoSubmitOptIn) return false;
  if (evidence.verifiedRuns < threshold.minVerifiedRuns) return false;
  if (evidence.confirmedSubmissions < threshold.minConfirmedSubmissions) return false;

  // A wrong submission is disqualifying for auto-submit specifically. A wrong
  // *fill* is already priced into the rate; a wrong *submission* went to a real
  // employer and is not something a percentage should be able to average away.
  if (threshold.level === 4 && evidence.wrongSubmissions > 0) return false;

  if (threshold.minCorrectRate > 0) {
    const rate = correctRate(evidence);
    if (rate === null || rate < threshold.minCorrectRate) return false;
  }

  return true;
}

/** The highest level this ATS's evidence supports. */
export function computeTrustLevel(evidence: TrustEvidence): TrustLevel {
  if (!evidence.hasAdapter) return 0;

  let earned: TrustLevel = 0;
  for (const threshold of TRUST_THRESHOLDS) {
    if (!meets(evidence, threshold)) break;
    earned = threshold.level;
  }
  return earned;
}

/**
 * How much of the confidence score's submission component this level earns
 * (spec §17's last 5%).
 *
 * Replaces the hardcoded SUBMISSION_RELIABILITY map, whose own comment said it
 * could not be a measurement "until an apply worker exists and has actually
 * submitted anything". Level 4 stops short of 1.0 because no adapter is certain.
 */
export function reliabilityForTrustLevel(level: TrustLevel): number {
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 0.25;
    case 2:
      return 0.5;
    case 3:
      return 0.85;
    case 4:
      return 0.95;
  }
}

/**
 * Read this ATS's track record out of the database.
 *
 * The ShadowRun query is the one the @@index([atsType, verdict]) was added for.
 */
export async function gatherTrustEvidence(
  db: PrismaClient,
  atsType: AtsType,
  autoSubmitOptIn: boolean,
): Promise<TrustEvidence> {
  const runs = await db.shadowRun.findMany({
    where: { atsType, verdict: { not: null } },
    select: { verdict: true },
  });

  const attempts = await db.submissionAttempt.findMany({
    where: { atsType },
    select: { outcome: true, verdict: true },
  });

  return {
    hasAdapter: adapterFor(atsType).id !== "generic",
    verifiedRuns: runs.length,
    // Anything that is not exactly "correct" is not a pass. The column is an
    // unconstrained String, so this must not be written as `!== "wrong"`.
    correctRuns: runs.filter((run) => run.verdict === "correct").length,
    confirmedSubmissions: attempts.filter((a) => a.outcome === "submitted").length,
    wrongSubmissions: attempts.filter((a) => a.verdict === "wrong").length,
    autoSubmitOptIn,
  };
}
