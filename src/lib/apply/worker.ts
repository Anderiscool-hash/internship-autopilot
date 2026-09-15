/**
 * The apply worker (spec §23).
 *
 * Walks an application from QUEUED to a resting place, which at trust level 3
 * — where this ships — is WAITING_FOR_USER with a filled form and a set of gate
 * results for a person to look at. The human's approval is what supplies the
 * authorization record and starts the submit phase.
 *
 * Level 4 is the same path without the stop, and is unreachable until an ATS
 * has both the evidence and an explicit opt-in.
 */

import { ApplicationStatus, type PrismaClient } from "@prisma/client";
import type { Browser } from "playwright";
import { transitionApplication } from "../applications/store";
import { loadAutoApplyRules } from "../autoapply/load-rules";
import { modeFor } from "../autoapply/rules";
import { documentKindForField, type DocumentKind } from "../documents/kind-for-field";
import { adapterFor } from "./adapters";
import {
  answeredFromOutcomes,
  scoreConfidence,
  type MaterialsState,
} from "./confidence";
import { runApplication } from "./run-application";
import type { FilledHandle, ShadowRunResult } from "./shadow";
import {
  submitFilledApplication,
  type Authorization,
  type GateName,
  type GateOutcome,
} from "./submit";
import {
  computeTrustLevel,
  gatherTrustEvidence,
  reliabilityForTrustLevel,
} from "./trust";

export interface WorkerResult {
  applicationId: string;
  finalStatus: ApplicationStatus;
  attemptId: string | null;
  reason: string;
}

export interface ApplyWorkerParams {
  applicationId: string;
  candidateId: string;
  /**
   * Supplied only when a human has approved this specific application. Its
   * absence is what keeps level 3 stopping.
   */
  authorization?: Authorization;
  /**
   * How to get a warm browser, called only if a run actually reaches the
   * filling stage.
   *
   * A provider rather than a Browser because the cheap exits above it — no
   * such application, the posting closed, the row is not ours to take — must
   * not cost a Chromium launch. Shadow mode launches headful, so an eagerly
   * awaited browser also means a window opening in someone's face for a run
   * that was never going to happen.
   */
  browser?: () => Promise<Browser>;
  log?: (line: string) => void;
}

/**
 * The state an exception on this run maps to, or null if the run is clean.
 *
 * Order matters: a CAPTCHA or a login wall usually leaves blocking gaps behind
 * it, and reporting the gaps would send someone off to answer questions that
 * are not the actual blockage.
 */
export function statusForRun(result: ShadowRunResult): ApplicationStatus | null {
  if (result.captcha) return ApplicationStatus.CAPTCHA;
  if (result.loginRequired) return ApplicationStatus.LOGIN_REQUIRED;
  if (result.blockingGaps.length > 0) return ApplicationStatus.AMBIGUOUS_QUESTION;
  return null;
}

/** How long the submit guard may stay open. A real submit is an XHR plus a redirect. */
const SUBMIT_WINDOW_MS = 30_000;

/** What was written to the SubmissionAttempt row, kept for the landing decision. */
interface WrittenAttempt {
  id: string;
  outcome: string;
  refusedGate: GateName | null;
}

/**
 * What the candidate actually got onto this form, read off the run itself.
 *
 * Never a constant. `documentsScore` in confidence.ts turns these two booleans
 * into a tenth of the number that gates a real submission, so a hardcoded
 * `true` here would be this code telling the gate that a resume it never
 * attached is ready. The only honest source is what the run did: an outcome
 * with status "attached" is a document the page took and read back (see
 * attachDocument in shadow.ts, which confirms rather than assumes), and its
 * label run through `documentKindForField` — the very function that chose
 * which document to put there — says which of the two it was. A label that
 * function cannot read is not counted as either.
 */
function materialsFromRun(result: ShadowRunResult): MaterialsState {
  const attached = new Set<DocumentKind>();
  for (const outcome of result.outcomes) {
    if (outcome.status !== "attached") continue;
    const kind = documentKindForField(outcome.label);
    if (kind !== null) attached.add(kind);
  }

  return {
    resumeReady: attached.has("RESUME"),
    coverLetterReady: attached.has("COVER_LETTER"),
  };
}

/**
 * Take one application as far as it can honestly go.
 *
 * Everything that can stop it — a closed posting, a CAPTCHA, a refused gate,
 * the absence of an approval — lands the row in a state naming what happened,
 * never a bare failure.
 */
export async function runApplyWorker(
  db: PrismaClient,
  params: ApplyWorkerParams,
): Promise<WorkerResult> {
  const { applicationId, candidateId } = params;
  const log = params.log ?? (() => undefined);

  const application = await db.application.findFirst({
    where: { id: applicationId, candidateId },
    include: { job: { select: { id: true, atsType: true, status: true } } },
  });

  if (!application) {
    // Nothing to move. Writing a status against an id that has no row would
    // either throw or invent one, and neither is a report of reality.
    return {
      applicationId,
      finalStatus: ApplicationStatus.FAILED,
      attemptId: null,
      reason: "That application no longer exists.",
    };
  }

  const job = application.job;

  // A job that closed while this sat in the queue is not a failure and not
  // something to ask a person about — it is a closed job, and JOB_CLOSED is
  // terminal. Checked before a browser is opened, because opening one to fill
  // a posting nobody can apply to is a minute wasted on every stale row.
  if (job.status !== "OPEN") {
    const reason = "The posting closed before this was submitted.";
    await transitionApplication(
      db,
      candidateId,
      applicationId,
      ApplicationStatus.JOB_CLOSED,
      reason,
    );
    return {
      applicationId,
      finalStatus: ApplicationStatus.JOB_CLOSED,
      attemptId: null,
      reason,
    };
  }

  const rules = await loadAutoApplyRules(db, candidateId);
  // The level-4 opt-in is the per-ATS AUTO mode and nothing else — evidence
  // never sets it (see trust.ts), and neither does this.
  const evidence = await gatherTrustEvidence(
    db,
    job.atsType,
    modeFor(rules, job.atsType) === "AUTO",
  );
  const trustLevel = computeTrustLevel(evidence);
  const adapter = adapterFor(job.atsType);

  // The lease. A row locked by a worker that then died stays locked on
  // purpose: its fate is unknown, and it should be looked at rather than
  // silently retried into a second submission.
  await db.application.update({
    where: { id: applicationId },
    data: {
      attemptCount: { increment: 1 },
      lockedAt: new Date(),
      lockedBy: "worker",
    },
  });

  const applying = await transitionApplication(
    db,
    candidateId,
    applicationId,
    ApplicationStatus.APPLYING,
  );
  if (!applying.ok) {
    await releaseLease(db, applicationId);
    return {
      applicationId,
      finalStatus: application.status,
      attemptId: null,
      reason: applying.error,
    };
  }

  // A list rather than a `let`, because the assignment happens inside the
  // onFilled closure and TypeScript's control-flow analysis cannot see a
  // callback run — a plain variable narrows to `null` for the rest of the
  // function and the branches below become unreachable to the checker.
  const written: WrittenAttempt[] = [];
  let landed: ApplicationStatus;
  let reason: string;

  try {
    const outcome = await runApplication(db, {
      jobId: job.id,
      browser: await params.browser?.(),
      persistSession: true,
      log,

      async onFilled(handle: FilledHandle) {
        // An exception on the run means there is nothing to submit. Scoring a
        // form behind a CAPTCHA and offering the number to a gate would be
        // arithmetic over a page nobody read.
        if (statusForRun(handle.result)) return;

        // ── THE LEVEL-3 STOP ────────────────────────────────────────────
        // No authorization means no human has approved this specific
        // application, and at level 3 that is the entire point: the run ends
        // filled and unsent, and somebody looks at it. This is the line that
        // makes the difference, so it is an early return rather than a flag
        // threaded into the gate list — nothing below here can run without an
        // approval that somebody produced.
        const authorization = params.authorization;
        if (!authorization) return;

        const materials = materialsFromRun(handle.result);

        // Scored from the REAL parsed form, not from a form rebuilt out of the
        // fill outcomes: rebuilding puts every field in the "standard" bucket,
        // and scoreConfidence's fraction() returns 1 for an empty bucket, so
        // an unanswered legal question would read as a perfect score.
        const confidence = scoreConfidence(
          {
            ...handle.form,
            fields: answeredFromOutcomes(handle.form.fields, handle.result.outcomes),
          },
          materials,
          reliabilityForTrustLevel(trustLevel),
        );

        const submitted = await submitFilledApplication(handle, {
          adapter,
          authorization,
          confidence: Math.round(confidence.score),
          minimumConfidence: rules.minimumApplicationConfidence,
          trustLevel,
          windowMs: SUBMIT_WINDOW_MS,
          screenshotPath: `${handle.result.screenshotPath}.submitted.png`,
        });

        const row = await db.submissionAttempt.create({
          data: {
            applicationId,
            jobId: job.id,
            candidateId,
            url: handle.result.url,
            atsType: job.atsType,
            adapterId: submitted.adapterId,
            authorizationKind: authorization.kind,
            authorizationActor: authorization.actor,
            authorizedAt: authorization.at,
            trustLevel,
            confidence: Math.round(confidence.score),
            // The whole GateOutcome[] into the Json column, so a refusal can
            // be explained months later without re-deriving it.
            gates: submitted.gates satisfies GateOutcome[] as never,
            refusedGate: submitted.refusedGate,
            requests: submitted.requests,
            outcome: submitted.outcome,
            adapterError: submitted.adapterError,
            screenshotPath: submitted.screenshotPath,
            finishedAt: new Date(),
          },
          select: { id: true },
        });

        written.push({
          id: row.id,
          outcome: submitted.outcome,
          refusedGate: submitted.refusedGate,
        });
      },
    });

    const exception = statusForRun(outcome.result);
    if (exception) {
      landed = exception;
      reason = reasonForException(exception, outcome.result);
    } else {
      const attempt = written[0] ?? null;
      if (!attempt) {
        // Filled, clean, and nobody has approved it. The resting place.
        landed = ApplicationStatus.WAITING_FOR_USER;
        reason = "Filled and ready to submit. Waiting for your approval.";
      } else if (attempt.outcome === "submitted") {
        landed = ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION;
        reason = "Submitted — the ATS showed its confirmation page.";
      } else if (attempt.outcome === "unconfirmed") {
        // Deliberately the same status and a different sentence. The POST may
        // well have arrived; nothing confirmed it, and saying so is the only
        // honest version — "we think we applied" is worse than not applying if
        // the person stops chasing a role nobody heard from them about.
        landed = ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION;
        reason =
          "The submission was sent but the ATS did not confirm it. " +
          "Check the employer's site yourself before counting it as applied.";
      } else {
        landed = ApplicationStatus.WAITING_FOR_USER;
        reason = attempt.refusedGate
          ? `Not submitted: the "${attempt.refusedGate}" check did not pass.`
          : `Not submitted: the attempt ended as "${attempt.outcome}".`;
      }
    }
  } catch (error) {
    landed = ApplicationStatus.FAILED;
    reason = error instanceof Error ? error.message : String(error);
  } finally {
    // The lease goes back whatever happened. A worker that finished and left
    // the row locked is indistinguishable from one that died holding it.
    await releaseLease(db, applicationId);
  }

  const moved = await transitionApplication(db, candidateId, applicationId, landed, reason);

  // A refused transition means the row is NOT where this function decided it
  // should be, so reporting `landed` would be reporting a status the database
  // does not have. Read back what is actually there instead: the caller shows
  // this to a person, and a worker that misreports where it left an
  // application is worse than one that admits it could not move it.
  let finalStatus = landed;
  if (!moved.ok) {
    reason = `${reason} (${moved.error})`;
    const actual = await db.application
      .findUnique({ where: { id: applicationId }, select: { status: true } })
      .catch(() => null);
    if (actual) finalStatus = actual.status;
  }

  return {
    applicationId,
    finalStatus,
    attemptId: written[0]?.id ?? null,
    reason,
  };
}

/** What to tell the person about a run that stopped on an exception. */
function reasonForException(
  status: ApplicationStatus,
  result: ShadowRunResult,
): string {
  if (status === ApplicationStatus.CAPTCHA) {
    return "The form is behind a CAPTCHA, which only a person can answer.";
  }
  if (status === ApplicationStatus.LOGIN_REQUIRED) {
    return "The form asked for a sign-in, so the application page was never reached.";
  }
  return `Required fields nothing could fill: ${result.blockingGaps.join(", ")}`;
}

/** Let go of the row, best effort — a failure here must not mask the run's. */
async function releaseLease(db: PrismaClient, applicationId: string): Promise<void> {
  await db.application
    .update({ where: { id: applicationId }, data: { lockedAt: null, lockedBy: null } })
    .catch(() => undefined);
}
