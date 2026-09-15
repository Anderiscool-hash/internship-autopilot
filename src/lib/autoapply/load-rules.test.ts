/**
 * Tests for the single loader that turns a CandidatePreferences row into
 * AutoApplyRules.
 *
 * This exists because the mapping used to be written out twice, and the two
 * copies disagreed: one spread atsModes into the rules and one did not. The
 * consequence of the wrong one reaching the apply worker is submitting on an
 * ATS the person had switched off, so the thing worth pinning down is that
 * atsModes survives the trip and that a missing row means defaults rather than
 * a crash.
 */

import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { loadAutoApplyRules } from "./load-rules";
import { DEFAULT_RULES } from "./rules";

function fakeDb(row: unknown) {
  return {
    candidatePreferences: { findUnique: async () => row },
  } as unknown as PrismaClient;
}

describe("loadAutoApplyRules", () => {
  it("falls back to the defaults when the candidate has no preferences row", async () => {
    const rules = await loadAutoApplyRules(fakeDb(null), "candidate-1");
    expect(rules).toEqual(DEFAULT_RULES);
  });

  it("carries atsModes through, which the duplicated copy used to drop", async () => {
    const rules = await loadAutoApplyRules(
      fakeDb({
        minimumFitScore: 70,
        minimumApplicationConfidence: 80,
        maximumPostingAgeHours: 48,
        dailyApplicationLimit: 10,
        maxApplicationsPerCompany: 2,
        atsAutoApplyModes: { GREENHOUSE: "REVIEW", LEVER: "AUTO" },
      }),
      "candidate-1",
    );

    expect(rules.atsModes).toEqual({ GREENHOUSE: "REVIEW", LEVER: "AUTO" });
    expect(rules.minimumApplicationConfidence).toBe(80);
  });

  it("drops modes that are not one of the three legal values", async () => {
    const rules = await loadAutoApplyRules(
      fakeDb({
        minimumFitScore: 0,
        minimumApplicationConfidence: 0,
        maximumPostingAgeHours: 72,
        dailyApplicationLimit: 25,
        maxApplicationsPerCompany: 3,
        atsAutoApplyModes: { GREENHOUSE: "YOLO", LEVER: "AUTO" },
      }),
      "candidate-1",
    );

    expect(rules.atsModes).toEqual({ LEVER: "AUTO" });
  });

  it("treats a null atsAutoApplyModes as no modes, not a crash", async () => {
    const rules = await loadAutoApplyRules(
      fakeDb({
        minimumFitScore: 0,
        minimumApplicationConfidence: 0,
        maximumPostingAgeHours: 72,
        dailyApplicationLimit: 25,
        maxApplicationsPerCompany: 3,
        atsAutoApplyModes: null,
      }),
      "candidate-1",
    );

    expect(rules.atsModes).toEqual({});
  });
});
