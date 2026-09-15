/**
 * Tests for the apply worker (spec §23).
 *
 * The worker is the thing that decides an application's fate, so what is worth
 * pinning down is not that it works — it is that it STOPS. At trust level 3,
 * where this ships, a run must come to rest at WAITING_FOR_USER with nothing
 * sent and nothing claimed; the human's approval is the only thing that turns
 * a filled form into a submitted one.
 *
 * The other half is where a run lands when it cannot finish. Every condition
 * that makes a form un-submittable has to put the row in a state a person can
 * actually act on. A worker that mapped a CAPTCHA to FAILED would "handle" it
 * in the sense that nothing crashes, while making the one thing a human could
 * fix in thirty seconds indistinguishable from a bug — it would sit in the
 * failure pile being retried forever.
 *
 * No browser here on purpose. The submit path itself is covered by
 * submit.test.ts against real fixtures; these tests are about the decisions
 * made around it.
 */

import { describe, it, expect } from "vitest";
import { ApplicationStatus, type PrismaClient } from "@prisma/client";
import { canTransition, resumeTarget } from "../applications/machine";
import { runApplyWorker, statusForRun } from "./worker";
import type { ShadowRunResult } from "./shadow";

/** A clean run, which each test then spoils in exactly one way. */
function runResult(overrides: Partial<ShadowRunResult> = {}): ShadowRunResult {
  return {
    url: "https://boards.greenhouse.io/acme/jobs/1",
    outcomes: [],
    blockingGaps: [],
    screenshotPath: "/tmp/shot.png",
    captcha: false,
    loginRequired: false,
    blockedSubmissions: [],
    blockedTrackers: 0,
    allowedUploads: [],
    ...overrides,
  };
}

describe("statusForRun", () => {
  it("sends a CAPTCHA to CAPTCHA", () => {
    expect(statusForRun(runResult({ captcha: true }))).toBe(ApplicationStatus.CAPTCHA);
  });

  it("sends a sign-in wall to LOGIN_REQUIRED", () => {
    expect(statusForRun(runResult({ loginRequired: true }))).toBe(
      ApplicationStatus.LOGIN_REQUIRED,
    );
  });

  it("sends required fields nothing could fill to AMBIGUOUS_QUESTION", () => {
    expect(statusForRun(runResult({ blockingGaps: ["Why us?"] }))).toBe(
      ApplicationStatus.AMBIGUOUS_QUESTION,
    );
  });

  it("reports nothing for a clean run, so the caller keeps going", () => {
    expect(statusForRun(runResult())).toBeNull();
  });

  // Precedence, and why it is not arbitrary: a CAPTCHA or a login wall leaves
  // blocking gaps behind it almost by definition — the fields below the wall
  // were never reachable. Reporting the gaps would send the person off to
  // answer questions that are not the actual blockage, and they would answer
  // them and watch the run stop in exactly the same place.
  it("prefers the CAPTCHA over the gaps it caused", () => {
    expect(
      statusForRun(runResult({ captcha: true, blockingGaps: ["Email", "Phone"] })),
    ).toBe(ApplicationStatus.CAPTCHA);
  });

  it("prefers the login wall over the gaps it caused", () => {
    expect(
      statusForRun(runResult({ loginRequired: true, blockingGaps: ["Email", "Phone"] })),
    ).toBe(ApplicationStatus.LOGIN_REQUIRED);
  });
});

/**
 * Against the real state machine, not a restatement of it.
 *
 * The worker walks a row through these states one call at a time because
 * canTransition permits exactly one pipeline step per move. If that rule or
 * the pipeline order ever changes, the worker's sequence of transitions
 * silently starts failing at runtime — these tests are what would notice.
 */
describe("the states the worker moves through", () => {
  it("allows QUEUED -> APPLYING, which is how a run starts", () => {
    expect(canTransition(ApplicationStatus.QUEUED, ApplicationStatus.APPLYING)).toBe(true);
  });

  it("allows APPLYING -> SUBMITTED_PENDING_CONFIRMATION, the only success", () => {
    expect(
      canTransition(
        ApplicationStatus.APPLYING,
        ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION,
      ),
    ).toBe(true);
  });

  it("allows APPLYING -> WAITING_FOR_USER and resumes it back into the queue", () => {
    expect(
      canTransition(ApplicationStatus.APPLYING, ApplicationStatus.WAITING_FOR_USER),
    ).toBe(true);
    // The level-3 resting place has to be recoverable, or approving an
    // application would be a dead end.
    expect(resumeTarget(ApplicationStatus.WAITING_FOR_USER)).toBe(ApplicationStatus.QUEUED);
  });

  it("can reach every exception it maps to from APPLYING", () => {
    for (const status of [
      ApplicationStatus.CAPTCHA,
      ApplicationStatus.LOGIN_REQUIRED,
      ApplicationStatus.AMBIGUOUS_QUESTION,
      ApplicationStatus.JOB_CLOSED,
      ApplicationStatus.FAILED,
      ApplicationStatus.WAITING_FOR_USER,
    ]) {
      expect(canTransition(ApplicationStatus.APPLYING, status)).toBe(true);
    }
  });
});

/** What the fake database was asked to do, so the tests can check absences. */
interface DbCalls {
  updates: unknown[];
  attempts: unknown[];
  events: { eventType: string; payload: Record<string, unknown> }[];
}

function fakeDb(application: unknown): { db: PrismaClient; calls: DbCalls } {
  const calls: DbCalls = { updates: [], attempts: [], events: [] };

  const db = {
    application: {
      findFirst: async () => application,
      update: async ({ data }: { data: unknown }) => {
        calls.updates.push(data);
        return { ...(application as object), ...(data as object) };
      },
    },
    submissionAttempt: {
      create: async ({ data }: { data: unknown }) => {
        calls.attempts.push(data);
        return { id: "attempt-1" };
      },
      findUnique: async () => null,
    },
    eventLog: {
      create: async ({ data }: { data: DbCalls["events"][number] }) => {
        calls.events.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;

  return { db, calls };
}

describe("runApplyWorker", () => {
  it("closes an application whose posting closed while it sat in the queue", async () => {
    // A job that closed before the worker got to it is not a failure and not
    // something a person should be asked to fix. It is a closed job, and
    // JOB_CLOSED is terminal — which is the whole point of checking before
    // opening a browser rather than after.
    const { db, calls } = fakeDb({
      id: "app-1",
      candidateId: "cand-1",
      status: ApplicationStatus.QUEUED,
      job: { id: "job-1", atsType: "GREENHOUSE", status: "CLOSED" },
    });

    const result = await runApplyWorker(db, {
      applicationId: "app-1",
      candidateId: "cand-1",
    });

    expect(result.finalStatus).toBe(ApplicationStatus.JOB_CLOSED);
    expect(result.applicationId).toBe("app-1");
    // Nothing was attempted: no browser was opened, so there is no attempt row
    // and no lease to clear.
    expect(result.attemptId).toBeNull();
    expect(calls.attempts).toEqual([]);
    // The one write is the transition itself.
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({ status: ApplicationStatus.JOB_CLOSED });
  });

  it("reports a missing application as FAILED without transitioning anything", async () => {
    // There is no row to move, so there is nothing to transition. Writing a
    // status for an id that does not exist would either throw or, worse,
    // invent a row.
    const { db, calls } = fakeDb(null);

    const result = await runApplyWorker(db, {
      applicationId: "gone",
      candidateId: "cand-1",
    });

    expect(result.finalStatus).toBe(ApplicationStatus.FAILED);
    expect(result.attemptId).toBeNull();
    expect(result.reason).toMatch(/gone|no longer|not found|does not exist/i);
    expect(calls.updates).toEqual([]);
    expect(calls.events).toEqual([]);
  });
});
