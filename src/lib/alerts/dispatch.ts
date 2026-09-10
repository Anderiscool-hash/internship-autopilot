/**
 * Deciding what to alert on, and remembering that we did (spec §28).
 *
 * Called by the scanner after each cycle with the jobs that cycle discovered.
 * Two rules shape it:
 *
 *   1. Alert only on titles the classifier thinks are student roles. A scan of
 *      Stripe's board finds 600 jobs; three of them are internships. Alerting
 *      on all of them makes the channel useless.
 *   2. Never alert on the same job twice. "Sent" is recorded in the EventLog,
 *      so it survives restarts — an in-memory set would re-alert everything
 *      every time the scanner was restarted.
 */

import { EventEntityType, type PrismaClient } from "@prisma/client";
import { classifyStudentRole } from "../jobs/classify";
import type { Verdict } from "../jobs/filters";
import { formatAlertBatch, type AlertableJob } from "./format";
import type { AlertChannel } from "./channels";

/** The EventLog eventType that records an alert having been sent. */
export const ALERT_EVENT = "alert_sent";

/**
 * Verdicts worth alerting on.
 *
 * "ambiguous" is included: those are exactly the titles the cheap classifier
 * cannot call, and Phase 3's AI pass does not exist yet. Missing a real
 * internship costs more than an occasional false alarm, and the alert text
 * says which ones are unconfirmed.
 */
export const ALERT_VERDICTS: Verdict[] = ["keep", "ambiguous"];

/** What one dispatch did. */
export interface DispatchResult {
  /** Jobs an alert went out for. */
  alerted: number;
  /** Jobs skipped because the classifier rejected the title. */
  notStudentRole: number;
  /** Jobs skipped because an alert had already been sent for them. */
  alreadySent: number;
  /** Channels that threw. Non-empty means the jobs were NOT marked as sent. */
  failures: string[];
}

/**
 * Alert on whichever of these jobs is new and looks like a student role.
 *
 * Returns counts rather than throwing: the scanner should carry on scanning
 * even if a notification channel is down.
 */
export async function dispatchAlerts(
  db: PrismaClient,
  jobIds: string[],
  now: Date,
  channels: AlertChannel[],
): Promise<DispatchResult> {
  const result: DispatchResult = {
    alerted: 0,
    notStudentRole: 0,
    alreadySent: 0,
    failures: [],
  };
  if (jobIds.length === 0 || channels.length === 0) return result;

  const jobs = await db.job.findMany({
    where: { id: { in: jobIds } },
    select: {
      id: true,
      title: true,
      location: true,
      canonicalUrl: true,
      firstSeenAt: true,
      company: { select: { name: true } },
    },
  });

  const candidates: AlertableJob[] = [];
  for (const job of jobs) {
    const verdict = classifyStudentRole(job.title).verdict;
    if (!ALERT_VERDICTS.includes(verdict)) {
      result.notStudentRole += 1;
      continue;
    }
    candidates.push({
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      location: job.location,
      canonicalUrl: job.canonicalUrl,
      firstSeenAt: job.firstSeenAt,
      verdict,
    });
  }
  if (candidates.length === 0) return result;

  const alreadySent = await findAlreadyAlerted(
    db,
    candidates.map((job) => job.id),
  );
  const fresh = candidates.filter((job) => !alreadySent.has(job.id));
  result.alreadySent = candidates.length - fresh.length;
  if (fresh.length === 0) return result;

  // Newest first, so the top of the message is the most urgent line in it.
  fresh.sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime());
  const message = formatAlertBatch(fresh, now);

  for (const channel of channels) {
    try {
      await channel(message);
    } catch (error) {
      result.failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  // If every channel failed, nothing was delivered — leave the jobs unmarked so
  // the next cycle tries again. If at least one worked, the alert happened, and
  // re-sending it to the channels that did work would be spam.
  if (result.failures.length === channels.length) return result;

  await db.eventLog.createMany({
    data: fresh.map((job) => ({
      entityType: EventEntityType.JOB,
      entityId: job.id,
      eventType: ALERT_EVENT,
      payload: { channels: channels.length - result.failures.length },
    })),
  });
  result.alerted = fresh.length;

  return result;
}

/** Which of these job ids already have an alert recorded against them. */
async function findAlreadyAlerted(
  db: PrismaClient,
  jobIds: string[],
): Promise<Set<string>> {
  const events = await db.eventLog.findMany({
    where: {
      entityType: EventEntityType.JOB,
      entityId: { in: jobIds },
      eventType: ALERT_EVENT,
    },
    select: { entityId: true },
  });
  return new Set(events.map((event) => event.entityId));
}
