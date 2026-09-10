/**
 * One pass over a company's job board.
 *
 * This is the piece the continuous scanner (spec §5) repeats forever, and the
 * piece `npm run discover` runs once by hand. Both go through here so there is
 * exactly one definition of what scanning a board means:
 *
 *   fetch -> normalize -> upsert -> close what vanished -> reschedule
 *
 * The scheduling decisions live in `schedule.ts` and the removal decisions in
 * `diff.ts`, both pure and unit tested. This file is what talks to Postgres
 * and the outside world, and it is written so that no single company can take
 * the whole run down with it.
 */

import { EventEntityType, JobStatus } from "@prisma/client";
import type { AtsType as DbAtsType, PrismaClient } from "@prisma/client";
import { getAtsJobFetcher } from "../ats/index";
import { dbAtsToCode, upsertJob } from "../jobs/persist";
import { boardChanged, findDisappearedJobs, shouldTrustForRemoval } from "./diff";
import {
  backoffInterval,
  nextPollInterval,
  selectDueCompanies,
  type SchedulableCompany,
} from "./schedule";

/** The company fields a scan needs. */
export interface ScannableCompany extends SchedulableCompany {
  name: string;
  atsType: DbAtsType | null;
  atsIdentifier: string | null;
}

/** What one company's scan did. */
export interface ScanOutcome {
  companyId: string;
  companyName: string;
  /** False when the board could not be fetched at all. */
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  closed: number;
  /** Whether anything appeared or disappeared - drives the polling tier. */
  changed: boolean;
  /** Minutes until this company is due again. */
  nextInterval: number;
  /** Row ids of the jobs this scan discovered — what alerts are sent for. */
  createdJobIds: string[];
  /** Present only when `ok` is false. */
  error?: string;
}

/**
 * Scan one company's board and record everything that follows from it.
 *
 * Never throws: a board that 404s, times out or returns garbage produces an
 * outcome with `ok: false` and a backed-off schedule. A scanner that dies on
 * one bad board is a scanner that stops finding internships.
 */
export async function scanCompany(
  db: PrismaClient,
  company: ScannableCompany,
  now: Date,
): Promise<ScanOutcome> {
  const base: ScanOutcome = {
    companyId: company.id,
    companyName: company.name,
    ok: true,
    fetched: 0,
    created: 0,
    updated: 0,
    closed: 0,
    changed: false,
    nextInterval: company.pollInterval,
    createdJobIds: [],
  };

  try {
    if (!company.atsIdentifier || !company.atsType) {
      // A registry entry whose board slug was never confirmed (spec §4).
      // Guessing one would mean scanning some other company's jobs.
      throw new Error(
        `no confirmed ATS type or board identifier for ${company.name}`,
      );
    }

    const fetchJobs = getAtsJobFetcher(dbAtsToCode(company.atsType));
    const jobs = await fetchJobs(company.atsIdentifier, company.name);

    const createdJobIds: string[] = [];
    let updated = 0;
    for (const job of jobs) {
      const { outcome, jobId } = await upsertJob(db, company.id, job);
      if (outcome === "created") createdJobIds.push(jobId);
      else updated += 1;
    }
    const created = createdJobIds.length;

    const closed = await closeDisappearedJobs(db, company.id, jobs, now);
    const changed = boardChanged(created, closed);

    // Reschedule against the activity we just observed, not the stale row: a
    // board that just produced its first new job in a month should move to the
    // fast tier now, not after one more slow cycle.
    const lastChange = changed ? now : company.lastChange;
    const nextInterval = nextPollInterval({ ...company, lastChange }, now);

    await db.company.update({
      where: { id: company.id },
      data: {
        lastScan: now,
        ...(changed ? { lastChange: now } : {}),
        failureCount: 0,
        pollInterval: nextInterval,
      },
    });

    return {
      ...base,
      fetched: jobs.length,
      created,
      updated,
      closed,
      changed,
      nextInterval,
      createdJobIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCount = company.failureCount + 1;
    const nextInterval = backoffInterval(failureCount, nextPollInterval(company, now));

    // lastScan still moves on a failure. It means "last attempted", which is
    // what the due-check needs - without it a permanently broken board would be
    // picked as the most-overdue company on every single cycle, forever.
    await db.company.update({
      where: { id: company.id },
      data: { lastScan: now, failureCount, pollInterval: nextInterval },
    });

    return { ...base, ok: false, nextInterval, error: message };
  }
}

/**
 * Mark jobs that have vanished from a board as CLOSED, and log why.
 *
 * Returns how many were closed. The EventLog rows are what let you answer
 * "why did this job disappear from my dashboard?" months later - that is what
 * the job event log from spec §40's Phase 1 is for.
 */
async function closeDisappearedJobs(
  db: PrismaClient,
  companyId: string,
  fetched: { sourceJobId: string }[],
  now: Date,
): Promise<number> {
  if (!shouldTrustForRemoval(fetched.length)) return 0;

  const known = await db.job.findMany({
    where: { companyId, status: JobStatus.OPEN },
    select: { id: true, sourceJobId: true },
  });

  const goneIds = findDisappearedJobs(
    known,
    fetched.map((job) => job.sourceJobId),
  );
  if (goneIds.length === 0) return 0;

  await db.job.updateMany({
    where: { id: { in: goneIds } },
    data: { status: JobStatus.CLOSED },
  });

  await db.eventLog.createMany({
    data: goneIds.map((jobId) => ({
      entityType: EventEntityType.JOB,
      entityId: jobId,
      eventType: "job_closed",
      payload: { reason: "missing_from_board", observedAt: now.toISOString() },
    })),
  });

  return goneIds.length;
}

/** Totals for one pass over every company that was due. */
export interface CycleSummary {
  /** Every job discovered this cycle, across all boards. */
  createdJobIds: string[];
  scanned: number;
  fetched: number;
  created: number;
  updated: number;
  closed: number;
  failed: number;
  outcomes: ScanOutcome[];
}

/**
 * Scan every company that is due right now, one at a time.
 *
 * Sequential on purpose: the boards belong to other people, and hammering a
 * dozen ATS APIs in parallel from one IP is how an adapter starts getting rate
 * limited (spec §5 treats rate limiting as a failure to back off from - better
 * not to provoke it in the first place).
 */
export async function runScanCycle(
  db: PrismaClient,
  now: Date,
  options: { limit?: number; onOutcome?: (outcome: ScanOutcome) => void } = {},
): Promise<CycleSummary> {
  const limit = options.limit ?? 25;

  const candidates = await db.company.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      atsType: true,
      atsIdentifier: true,
      scanPriority: true,
      pollInterval: true,
      failureCount: true,
      lastScan: true,
      lastChange: true,
    },
    orderBy: { lastScan: "asc" },
  });

  const due = selectDueCompanies(candidates, now, limit);

  const summary: CycleSummary = {
    createdJobIds: [],
    scanned: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    closed: 0,
    failed: 0,
    outcomes: [],
  };

  for (const company of due) {
    const outcome = await scanCompany(db, company, now);
    summary.scanned += 1;
    summary.fetched += outcome.fetched;
    summary.created += outcome.created;
    summary.updated += outcome.updated;
    summary.closed += outcome.closed;
    summary.createdJobIds.push(...outcome.createdJobIds);
    if (!outcome.ok) summary.failed += 1;
    summary.outcomes.push(outcome);
    options.onOutcome?.(outcome);
  }

  return summary;
}
