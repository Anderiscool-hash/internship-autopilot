/**
 * Tests for the application state machine (spec §23).
 *
 * The properties worth locking down: the pipeline is the spec's order and
 * cannot be jumped by the bot, an exception can happen at any point and can be
 * recovered from, and every status the schema allows shows up somewhere in the
 * tracker — a state that belongs to no column would be an application that
 * silently vanishes from the screen.
 */

import { describe, it, expect } from "vitest";
import { ApplicationStatus } from "@prisma/client";
import {
  allowedTransitions,
  canTransition,
  columnFor,
  EXCEPTIONS,
  isException,
  isTerminal,
  nextInPipeline,
  PIPELINE,
  resumeTarget,
  TRACKER_COLUMNS,
} from "./machine";

describe("PIPELINE", () => {
  it("is spec §23's order, start to end", () => {
    expect(PIPELINE[0]).toBe(ApplicationStatus.DISCOVERED);
    expect(PIPELINE[PIPELINE.length - 1]).toBe(ApplicationStatus.CONFIRMED);
    expect(PIPELINE).toHaveLength(10);
  });

  it("covers every status exactly once, together with the exceptions", () => {
    const all = [...PIPELINE, ...EXCEPTIONS].sort();
    const schema = Object.values(ApplicationStatus).sort();
    expect(all).toEqual(schema);
  });
});

describe("nextInPipeline", () => {
  it("advances one step", () => {
    expect(nextInPipeline(ApplicationStatus.DISCOVERED)).toBe(
      ApplicationStatus.NORMALIZED,
    );
    expect(nextInPipeline(ApplicationStatus.QUEUED)).toBe(ApplicationStatus.APPLYING);
  });

  it("has nowhere to go from the end, or from an exception", () => {
    expect(nextInPipeline(ApplicationStatus.CONFIRMED)).toBeNull();
    expect(nextInPipeline(ApplicationStatus.CAPTCHA)).toBeNull();
  });
});

describe("canTransition", () => {
  it("allows one step forward but not two", () => {
    expect(
      canTransition(ApplicationStatus.DISCOVERED, ApplicationStatus.NORMALIZED),
    ).toBe(true);
    expect(canTransition(ApplicationStatus.DISCOVERED, ApplicationStatus.QUEUED)).toBe(
      false,
    );
  });

  it("never allows moving backwards along the pipeline", () => {
    expect(canTransition(ApplicationStatus.QUEUED, ApplicationStatus.MATCHED)).toBe(
      false,
    );
  });

  it("allows an exception from any pipeline state", () => {
    for (const status of PIPELINE) {
      if (isTerminal(status)) continue;
      expect(canTransition(status, ApplicationStatus.CAPTCHA), status).toBe(true);
      expect(canTransition(status, ApplicationStatus.FAILED), status).toBe(true);
    }
  });

  it("lets a resumable exception go back to where it resumes", () => {
    expect(canTransition(ApplicationStatus.CAPTCHA, ApplicationStatus.QUEUED)).toBe(
      true,
    );
    expect(canTransition(ApplicationStatus.FAILED, ApplicationStatus.QUEUED)).toBe(true);
    expect(
      canTransition(ApplicationStatus.SKIPPED, ApplicationStatus.DISCOVERED),
    ).toBe(true);
  });

  it("lets the human report reality from anywhere", () => {
    // Applied on the company's site directly, without the bot involved.
    expect(
      canTransition(
        ApplicationStatus.DISCOVERED,
        ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION,
      ),
    ).toBe(true);
    expect(canTransition(ApplicationStatus.MATCHED, ApplicationStatus.SKIPPED)).toBe(
      true,
    );
  });

  it("does not treat staying put as a transition", () => {
    expect(canTransition(ApplicationStatus.QUEUED, ApplicationStatus.QUEUED)).toBe(
      false,
    );
  });

  it("stops the bot moving anything on from a terminal state", () => {
    expect(canTransition(ApplicationStatus.CONFIRMED, ApplicationStatus.APPLYING)).toBe(
      false,
    );
    expect(canTransition(ApplicationStatus.JOB_CLOSED, ApplicationStatus.QUEUED)).toBe(
      false,
    );
  });

  it("still lets a human correct a terminal row", () => {
    // "I marked this confirmed by mistake, it was actually closed."
    expect(
      canTransition(ApplicationStatus.CONFIRMED, ApplicationStatus.JOB_CLOSED),
    ).toBe(true);
  });
});

describe("allowedTransitions", () => {
  it("never includes the current state", () => {
    for (const status of Object.values(ApplicationStatus)) {
      expect(allowedTransitions(status), status).not.toContain(status);
    }
  });

  it("agrees with canTransition", () => {
    for (const from of Object.values(ApplicationStatus)) {
      for (const to of allowedTransitions(from)) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
      }
    }
  });
});

describe("resumeTarget", () => {
  it("routes recoverable exceptions back into the queue", () => {
    expect(resumeTarget(ApplicationStatus.CAPTCHA)).toBe(ApplicationStatus.QUEUED);
    expect(resumeTarget(ApplicationStatus.LOGIN_REQUIRED)).toBe(
      ApplicationStatus.QUEUED,
    );
  });

  it("has no route out of a closed job", () => {
    expect(resumeTarget(ApplicationStatus.JOB_CLOSED)).toBeNull();
  });
});

describe("isException", () => {
  it("separates the two vocabularies", () => {
    expect(isException(ApplicationStatus.CAPTCHA)).toBe(true);
    expect(isException(ApplicationStatus.QUEUED)).toBe(false);
  });
});

describe("TRACKER_COLUMNS", () => {
  it("gives every status a home, so nothing can vanish from the screen", () => {
    const covered = TRACKER_COLUMNS.flatMap(
      (column) => column.statuses as readonly ApplicationStatus[],
    );
    expect([...covered].sort()).toEqual(Object.values(ApplicationStatus).sort());
  });

  it("puts each status in exactly one column", () => {
    const covered = TRACKER_COLUMNS.flatMap(
      (column) => column.statuses as readonly ApplicationStatus[],
    );
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("routes statuses to the column a person would look in", () => {
    expect(columnFor(ApplicationStatus.DISCOVERED)).toBe("saved");
    expect(columnFor(ApplicationStatus.QUEUED)).toBe("preparing");
    expect(columnFor(ApplicationStatus.CAPTCHA)).toBe("needs-you");
    expect(columnFor(ApplicationStatus.CONFIRMED)).toBe("applied");
    expect(columnFor(ApplicationStatus.SKIPPED)).toBe("closed");
  });
});
