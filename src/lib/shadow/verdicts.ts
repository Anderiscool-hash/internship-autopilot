/**
 * Recording and reading human verdicts on Shadow Mode runs (spec §20/§21).
 *
 * A shadow run is a form the bot filled and did not submit. On its own that
 * proves nothing: spec §21 promotes an adapter on evidence, and the evidence is
 * a person having looked at the screenshot and said whether the fill was right.
 * This module is the only place that verdict gets written, so the rules about
 * what may be written live in one place rather than in every caller.
 *
 * `verdict` is an unconstrained String column in the schema. Everything here
 * treats that as a hazard rather than a convenience: nothing but "correct" or
 * "wrong" goes in, and nothing but an exact "correct" is counted as a pass on
 * the way back out.
 */

import type { PrismaClient, AtsType } from "@prisma/client";
import { computeTrustLevel, gatherTrustEvidence, type TrustLevel } from "../apply/trust";

/** The only two things a human review can conclude. */
export type Verdict = "correct" | "wrong";

const VERDICTS: readonly string[] = ["correct", "wrong"];

/** How much of the review queue is done. */
export interface RunProgress {
  total: number;
  verified: number;
  pending: number;
}

/** One ATS's track record, as the review screen shows it. */
export interface AtsStanding {
  atsType: string;
  verified: number;
  correct: number;
  level: TrustLevel;
}

/**
 * A run as the reviewer sees it.
 *
 * Deliberately not the whole row: jobId and candidateId say nothing about
 * whether the form was filled correctly, and the verdict columns are what the
 * reviewer is about to supply.
 */
export interface ShadowRunRow {
  id: string;
  url: string;
  atsType: AtsType;
  fieldsTotal: number;
  fieldsFilled: number;
  fieldsSkipped: number;
  fieldsFailed: number;
  blockingGaps: string[];
  captcha: boolean;
  loginRequired: boolean;
  screenshotPath: string;
  outcomes: unknown;
  createdAt: Date;
  /** A note kept from an undone verdict, so it is not retyped. Usually null. */
  verdictNote: string | null;
}

const REVIEW_COLUMNS = {
  id: true,
  url: true,
  atsType: true,
  fieldsTotal: true,
  fieldsFilled: true,
  fieldsSkipped: true,
  fieldsFailed: true,
  blockingGaps: true,
  captcha: true,
  loginRequired: true,
  screenshotPath: true,
  outcomes: true,
  createdAt: true,
  // An unverified run can still carry a note: clearVerdict withdraws the
  // verdict but deliberately keeps what the reviewer wrote, so an undone
  // misclick hands the note back rather than making them type it twice.
  verdictNote: true,
} as const;

/**
 * Record what a human concluded about one run.
 *
 * The existence check is done before the update so a mistyped id fails with a
 * sentence instead of a Prisma P2025, and so the caller cannot mistake "no such
 * run" for "recorded".
 */
export async function recordVerdict(
  db: PrismaClient,
  runId: string,
  verdict: Verdict,
  note: string | null,
): Promise<void> {
  if (!VERDICTS.includes(verdict)) {
    throw new Error(
      `Invalid verdict ${JSON.stringify(verdict)}: expected "correct" or "wrong".`,
    );
  }

  const existing = await db.shadowRun.findUnique({
    where: { id: runId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error(`No shadow run with id ${runId}.`);
  }

  await db.shadowRun.update({
    where: { id: runId },
    data: {
      verdict,
      // An empty note is the absence of a note. Storing "" would make
      // "they wrote nothing" indistinguishable from "they wrote a blank", and
      // every reader would then have to check both.
      verdictNote: note?.trim() ? note.trim() : null,
      verifiedAt: new Date(),
    },
  });
}

/**
 * Undo a verdict recorded by mistake, putting the run back in the queue.
 *
 * `verdictNote` is deliberately left alone. The realistic misclick is someone
 * typing a careful note about what went wrong and then pressing the wrong
 * button; wiping the note would punish exactly the case this function exists
 * for, so it survives as a draft for the second attempt. Nothing in the
 * codebase reads `verdictNote` — recordVerdict is its only other mention — so
 * a note left sitting next to a null verdict misleads no reader and is counted
 * by nothing.
 */
export async function clearVerdict(db: PrismaClient, runId: string): Promise<void> {
  const existing = await db.shadowRun.findUnique({
    where: { id: runId },
    select: { id: true, verdict: true, verifiedAt: true },
  });
  if (!existing) {
    throw new Error(`No shadow run with id ${runId}.`);
  }

  // Already unverified. Returning instead of writing means a double-clicked
  // Undo link is harmless rather than an error, and spares the row a write
  // that would change nothing but look like a real review action afterwards.
  if (existing.verdict === null && existing.verifiedAt === null) {
    return;
  }

  await db.shadowRun.update({
    where: { id: runId },
    data: {
      verdict: null,
      // Cleared together with the verdict on purpose: a verifiedAt without a
      // verdict would read as "a human checked this" to anyone scanning the
      // column, which is the one claim an undo is meant to withdraw.
      verifiedAt: null,
    },
  });
}

/**
 * The next run waiting on a human, oldest first.
 *
 * Oldest rather than newest so the queue drains instead of growing a tail of
 * runs nobody ever gets to.
 */
export async function nextUnverifiedRun(db: PrismaClient): Promise<ShadowRunRow | null> {
  return db.shadowRun.findFirst({
    where: { verdict: null },
    orderBy: { createdAt: "asc" },
    select: REVIEW_COLUMNS,
  });
}

/** How far through the queue the reviewer is. */
export async function verificationProgress(db: PrismaClient): Promise<RunProgress> {
  const total = await db.shadowRun.count();
  const verified = await db.shadowRun.count({ where: { verdict: { not: null } } });

  // Derived rather than counted separately: two independent counts against a
  // moving table can disagree, and "pending" is defined as the remainder.
  return { total, verified, pending: total - verified };
}

/**
 * Per-ATS standing, for the screen that decides whether an adapter has earned
 * more trust.
 *
 * An ATS appears as soon as it has a run at all, even if none are verified —
 * "nobody has checked Workday yet" is the thing a reviewer most needs to see,
 * and it is invisible if unverified ATSes are filtered out.
 */
export async function atsStandings(db: PrismaClient): Promise<AtsStanding[]> {
  const runs = await db.shadowRun.findMany({ select: { atsType: true } });
  const atsTypes = [...new Set(runs.map((run) => run.atsType))].sort();

  const standings: AtsStanding[] = [];
  for (const atsType of atsTypes) {
    // autoSubmitOptIn is false here on purpose: this is a report, and a report
    // must never be the thing that hands out level 4. The opt-in belongs to
    // whoever is actually about to submit.
    const evidence = await gatherTrustEvidence(db, atsType, false);
    standings.push({
      atsType,
      verified: evidence.verifiedRuns,
      correct: evidence.correctRuns,
      level: computeTrustLevel(evidence),
    });
  }

  return standings;
}
