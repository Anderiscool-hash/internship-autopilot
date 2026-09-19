/**
 * Reading and writing applications (spec §23 state machine, §24 tracker).
 *
 * Every state change goes through `transitionApplication`, which refuses moves
 * the machine does not allow and writes an EventLog row for the ones it does.
 * That log is the answer to "why is this application sitting in CAPTCHA?"
 * three weeks later — spec §23 wants applications resumable, and resuming
 * something you cannot reconstruct the history of is guesswork.
 */

import {
  ApplicationStatus,
  EventEntityType,
  type AtsType,
  type Application,
  type ApplicationOutcome,
  type PrismaClient,
} from "@prisma/client";
import { canTransition } from "./machine";

/** An application row with the job and company it belongs to. */
export type ApplicationWithJob = Application & {
  job: {
    id: string;
    title: string;
    location: string | null;
    canonicalUrl: string;
    atsType: AtsType;
    company: { name: string; id: string; contacts: { id: string; firstName: string; lastName: string; title: string | null; emails: { id: string; address: string; status: string }[] }[] };
  };
};

/** Everything the tracker shows, newest activity first. */
export async function listApplications(
  db: PrismaClient,
  candidateId: string,
): Promise<ApplicationWithJob[]> {
  return db.application.findMany({
    where: { candidateId },
    orderBy: { updatedAt: "desc" },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          location: true,
          canonicalUrl: true,
          atsType: true,
          company: { select: { id: true, name: true, contacts: { orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, title: true, emails: { orderBy: [{ confidence: "desc" }, { address: "asc" }], select: { id: true, address: true, status: true } } } } } },
        },
      },
    },
  });
}

/**
 * Put a job on the tracker, or return the row that is already there.
 *
 * The schema's unique [candidateId, jobId] makes double-tracking impossible
 * (spec §8 wants duplicate applications prevented outright), so this reads as
 * "ensure it is tracked" rather than "create". Clicking Save twice is not an
 * error and should not look like one.
 */
export async function trackJob(
  db: PrismaClient,
  candidateId: string,
  jobId: string,
  status: ApplicationStatus = ApplicationStatus.DISCOVERED,
  fitScore: number | null = null,
): Promise<{ application: Application; created: boolean }> {
  const existing = await db.application.findUnique({
    where: { candidateId_jobId: { candidateId, jobId } },
  });
  if (existing) return { application: existing, created: false };

  const application = await db.application.create({
    data: {
      candidateId,
      jobId,
      status,
      fitScore,
      // A row created straight into "applied" is someone reporting they
      // applied by hand; the timestamp belongs on it.
      appliedAt: isApplied(status) ? new Date() : null,
      confirmedAt: status === ApplicationStatus.CONFIRMED ? new Date() : null,
    },
  });

  await logEvent(db, application.id, "created", { status });
  return { application, created: true };
}

/** Has this status actually been submitted to the employer? */
function isApplied(status: ApplicationStatus): boolean {
  return (
    status === ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION ||
    status === ApplicationStatus.CONFIRMED
  );
}

/** The outcome of a state change attempt. */
export type TransitionResult =
  | { ok: true; application: Application }
  | { ok: false; error: string };

/**
 * Move an application to a new state.
 *
 * Refuses illegal moves rather than performing them: the state machine is the
 * only thing standing between "resumable" and a row whose status is whatever
 * the last button press happened to write.
 */
export async function transitionApplication(
  db: PrismaClient,
  candidateId: string,
  applicationId: string,
  to: ApplicationStatus,
  reason?: string,
): Promise<TransitionResult> {
  // Scoped to the candidate: the id came from a form in a browser.
  const application = await db.application.findFirst({
    where: { id: applicationId, candidateId },
  });
  if (!application) return { ok: false, error: "That application no longer exists." };

  if (!canTransition(application.status, to)) {
    return {
      ok: false,
      error: `An application cannot go from ${application.status} to ${to}.`,
    };
  }

  const now = new Date();
  const updated = await db.application.update({
    where: { id: applicationId },
    data: {
      status: to,
      // Timestamps are only ever set, never cleared or overwritten: when you
      // actually applied is a historical fact, and walking the row through
      // the states again should not rewrite it.
      ...(isApplied(to) && application.appliedAt === null ? { appliedAt: now } : {}),
      ...(to === ApplicationStatus.CONFIRMED && application.confirmedAt === null
        ? { confirmedAt: now }
        : {}),
      ...(reason ? { failureReason: reason } : {}),
    },
  });

  await logEvent(db, applicationId, "status_changed", {
    from: application.status,
    to,
    ...(reason ? { reason } : {}),
  });

  return { ok: true, application: updated };
}

/**
 * Record what came of an application (spec §24's statuses: OA, Interview,
 * Offer, Rejected...).
 *
 * Only allowed once something was actually submitted. An "Offer" on a job that
 * was never applied to is not a state this app should be able to represent.
 */
export async function setOutcome(
  db: PrismaClient,
  candidateId: string,
  applicationId: string,
  outcome: ApplicationOutcome | null,
): Promise<TransitionResult> {
  const application = await db.application.findFirst({
    where: { id: applicationId, candidateId },
  });
  if (!application) return { ok: false, error: "That application no longer exists." };

  if (outcome !== null && application.appliedAt === null) {
    return {
      ok: false,
      error: "Mark the application as applied before recording an outcome.",
    };
  }

  const updated = await db.application.update({
    where: { id: applicationId },
    data: { outcome },
  });
  await logEvent(db, applicationId, "outcome_set", { outcome });

  return { ok: true, application: updated };
}

/** Save free-text notes against an application (spec §24 "Notes"). */
export async function setNotes(
  db: PrismaClient,
  candidateId: string,
  applicationId: string,
  notes: string | null,
): Promise<TransitionResult> {
  const result = await db.application.updateMany({
    where: { id: applicationId, candidateId },
    data: { notes },
  });
  if (result.count === 0) {
    return { ok: false, error: "That application no longer exists." };
  }

  const application = await db.application.findFirstOrThrow({
    where: { id: applicationId },
  });
  return { ok: true, application };
}

/**
 * Take a job off the tracker entirely.
 *
 * Distinct from SKIPPED, which is a decision worth keeping ("I looked at this
 * and said no"). Removal is for rows that should never have been added.
 */
export async function untrackApplication(
  db: PrismaClient,
  candidateId: string,
  applicationId: string,
): Promise<boolean> {
  const result = await db.application.deleteMany({
    where: { id: applicationId, candidateId },
  });
  return result.count > 0;
}

/** The application for one job, if it is being tracked. */
export async function findApplicationForJob(
  db: PrismaClient,
  candidateId: string,
  jobId: string,
): Promise<Application | null> {
  return db.application.findUnique({
    where: { candidateId_jobId: { candidateId, jobId } },
  });
}

/** Append to the append-only history for this application. */
async function logEvent(
  db: PrismaClient,
  applicationId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.eventLog.create({
    data: {
      entityType: EventEntityType.APPLICATION,
      entityId: applicationId,
      eventType,
      payload: payload as never,
    },
  });
}
