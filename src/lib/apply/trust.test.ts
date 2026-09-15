/**
 * Tests for the adapter trust ladder (spec §21).
 *
 * Two properties matter more than the specific thresholds, and both are the
 * reason this file exists: evidence can make an ATS *eligible* for auto-submit
 * but must never *promote* it — that last step is a human's — and an
 * unverified run is not evidence of anything. A regression in either one would
 * mean applications going out on the strength of runs nobody ever checked.
 */

import { describe, it, expect } from "vitest";
import {
  computeTrustLevel,
  correctRate,
  gatherTrustEvidence,
  reliabilityForTrustLevel,
  TRUST_THRESHOLDS,
  type TrustEvidence,
} from "./trust";
import type { PrismaClient } from "@prisma/client";

/** Evidence for an ATS that has earned nothing yet. */
function evidence(overrides: Partial<TrustEvidence> = {}): TrustEvidence {
  return {
    hasAdapter: true,
    verifiedRuns: 0,
    correctRuns: 0,
    confirmedSubmissions: 0,
    wrongSubmissions: 0,
    autoSubmitOptIn: false,
    ...overrides,
  };
}

describe("computeTrustLevel", () => {
  it("gives an ATS with no adapter level 0, however good its history", () => {
    expect(
      computeTrustLevel(
        evidence({
          hasAdapter: false,
          verifiedRuns: 100,
          correctRuns: 100,
          confirmedSubmissions: 50,
          autoSubmitOptIn: true,
        }),
      ),
    ).toBe(0);
  });

  it("starts a fresh adapter at level 1", () => {
    expect(computeTrustLevel(evidence())).toBe(1);
  });

  it("reaches level 2 on five verified runs at 80%", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 5, correctRuns: 4 }))).toBe(2);
  });

  it("holds at level 1 when the rate is met but the count is not", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 4, correctRuns: 4 }))).toBe(1);
  });

  it("holds at level 1 when the count is met but the rate is not", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 5, correctRuns: 3 }))).toBe(1);
  });

  it("reaches level 3 — where this ships — on ten verified runs at 90%", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 10, correctRuns: 9 }))).toBe(3);
  });

  it("never reaches level 4 on evidence alone", () => {
    expect(
      computeTrustLevel(
        evidence({
          verifiedRuns: 100,
          correctRuns: 100,
          confirmedSubmissions: 50,
          autoSubmitOptIn: false,
        }),
      ),
    ).toBe(3);
  });

  it("reaches level 4 only with the evidence AND the opt-in", () => {
    expect(
      computeTrustLevel(
        evidence({
          verifiedRuns: 25,
          correctRuns: 24,
          confirmedSubmissions: 10,
          autoSubmitOptIn: true,
        }),
      ),
    ).toBe(4);
  });

  it("refuses level 4 while any submission was judged wrong", () => {
    expect(
      computeTrustLevel(
        evidence({
          verifiedRuns: 100,
          correctRuns: 100,
          confirmedSubmissions: 50,
          wrongSubmissions: 1,
          autoSubmitOptIn: true,
        }),
      ),
    ).toBe(3);
  });

  it("refuses level 4 without enough confirmed submissions", () => {
    expect(
      computeTrustLevel(
        evidence({
          verifiedRuns: 25,
          correctRuns: 25,
          confirmedSubmissions: 9,
          autoSubmitOptIn: true,
        }),
      ),
    ).toBe(3);
  });

  it("is monotonic: adding a correct run never lowers the level", () => {
    for (let runs = 0; runs < 40; runs += 1) {
      const before = computeTrustLevel(
        evidence({ verifiedRuns: runs, correctRuns: runs, autoSubmitOptIn: false }),
      );
      const after = computeTrustLevel(
        evidence({ verifiedRuns: runs + 1, correctRuns: runs + 1, autoSubmitOptIn: false }),
      );
      expect(after, `${runs} -> ${runs + 1}`).toBeGreaterThanOrEqual(before);
    }
  });
});

describe("correctRate", () => {
  it("is null with no verified runs, not zero", () => {
    expect(correctRate(evidence())).toBeNull();
  });

  it("is the fraction of verified runs judged correct", () => {
    expect(correctRate(evidence({ verifiedRuns: 4, correctRuns: 3 }))).toBe(0.75);
  });
});

describe("TRUST_THRESHOLDS", () => {
  it("is ordered by level with no gaps", () => {
    expect(TRUST_THRESHOLDS.map((threshold) => threshold.level)).toEqual([1, 2, 3, 4]);
  });

  it("never lowers a requirement as the level rises", () => {
    for (let index = 1; index < TRUST_THRESHOLDS.length; index += 1) {
      const previous = TRUST_THRESHOLDS[index - 1]!;
      const current = TRUST_THRESHOLDS[index]!;
      expect(current.minVerifiedRuns, `level ${current.level}`).toBeGreaterThanOrEqual(
        previous.minVerifiedRuns,
      );
      expect(current.minCorrectRate, `level ${current.level}`).toBeGreaterThanOrEqual(
        previous.minCorrectRate,
      );
    }
  });

  it("requires a human opt-in at level 4 and nowhere else", () => {
    for (const threshold of TRUST_THRESHOLDS) {
      expect(threshold.requiresOptIn, `level ${threshold.level}`).toBe(
        threshold.level === 4,
      );
    }
  });
});

describe("reliabilityForTrustLevel", () => {
  it("is zero for an ATS that cannot submit", () => {
    expect(reliabilityForTrustLevel(0)).toBe(0);
  });

  it("rises with the level", () => {
    const levels = [0, 1, 2, 3, 4] as const;
    for (let index = 1; index < levels.length; index += 1) {
      expect(
        reliabilityForTrustLevel(levels[index]!),
        `level ${levels[index]}`,
      ).toBeGreaterThan(reliabilityForTrustLevel(levels[index - 1]!));
    }
  });

  it("never claims certainty", () => {
    expect(reliabilityForTrustLevel(4)).toBeLessThan(1);
  });
});

describe("gatherTrustEvidence", () => {
  /** A Prisma stand-in holding just the two tables this function reads. */
  function fakeDb(
    runs: { verdict: string | null }[],
    attempts: { outcome: string; verdict: string | null }[] = [],
  ) {
    return {
      shadowRun: {
        // The real query filters verdict: { not: null } in SQL, so the fake
        // does the same rather than handing back rows the database would not.
        findMany: async () => runs.filter((run) => run.verdict !== null),
      },
      submissionAttempt: { findMany: async () => attempts },
    } as unknown as PrismaClient;
  }

  it("counts only runs a human actually verified", async () => {
    const result = await gatherTrustEvidence(
      fakeDb([
        { verdict: "correct" },
        { verdict: "correct" },
        { verdict: "wrong" },
        { verdict: null },
        { verdict: null },
      ]),
      "GREENHOUSE",
      false,
    );

    expect(result.verifiedRuns).toBe(3);
    expect(result.correctRuns).toBe(2);
    expect(result.hasAdapter).toBe(true);
  });

  it("reports no adapter for an ATS the registry does not cover", async () => {
    const result = await gatherTrustEvidence(fakeDb([]), "WORKDAY", false);
    expect(result.hasAdapter).toBe(false);
  });

  it("counts only attempts that actually landed as confirmed submissions", async () => {
    // "unconfirmed" is the outcome for "the POST went out and nothing confirmed
    // it". Counting it as a success here would inflate the very evidence that
    // unlocks auto-submit, which is the one number that must not be generous.
    const result = await gatherTrustEvidence(
      fakeDb(
        [],
        [
          { outcome: "submitted", verdict: null },
          { outcome: "submitted", verdict: "correct" },
          { outcome: "unconfirmed", verdict: null },
          { outcome: "refused", verdict: null },
          { outcome: "error", verdict: null },
        ],
      ),
      "GREENHOUSE",
      false,
    );

    expect(result.confirmedSubmissions).toBe(2);
  });

  it("counts a submission a human judged wrong, whatever its outcome said", async () => {
    // The adapter can believe it succeeded and still have sent the wrong
    // thing. A human saying so is what blocks level 4, so it is read from the
    // verdict rather than from the outcome.
    const result = await gatherTrustEvidence(
      fakeDb(
        [],
        [
          { outcome: "submitted", verdict: "wrong" },
          { outcome: "submitted", verdict: "correct" },
          { outcome: "unconfirmed", verdict: "wrong" },
        ],
      ),
      "GREENHOUSE",
      false,
    );

    expect(result.wrongSubmissions).toBe(2);
  });

  it("passes the opt-in through untouched, since evidence must never set it", async () => {
    const off = await gatherTrustEvidence(fakeDb([]), "GREENHOUSE", false);
    const on = await gatherTrustEvidence(fakeDb([]), "GREENHOUSE", true);
    expect(off.autoSubmitOptIn).toBe(false);
    expect(on.autoSubmitOptIn).toBe(true);
  });
});
