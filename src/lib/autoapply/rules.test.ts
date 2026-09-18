/**
 * Tests for the auto-apply decision (spec §18).
 *
 * This is the function that decides whether software submits an application to
 * a real employer in someone's name. So the tests are weighted towards proving
 * it says no: every threshold blocks, every unknown falls back to asking a
 * person, and an ATS nobody enabled is never auto-applied to.
 */

import { describe, it, expect } from "vitest";
import {
  decideAutoApply,
  DEFAULT_RULES,
  modeFor,
  readAtsModes,
  type AutoApplyContext,
  type AutoApplyRules,
} from "./rules";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/** Rules permissive enough that each test can be the thing that blocks. */
function rules(overrides: Partial<AutoApplyRules> = {}): AutoApplyRules {
  return {
    ...DEFAULT_RULES,
    minimumFitScore: 80,
    minimumApplicationConfidence: 90,
    atsModes: { GREENHOUSE: "AUTO", ASHBY: "REVIEW" },
    ...overrides,
  };
}

/** A context that would otherwise be auto-approved. */
function context(overrides: Partial<AutoApplyContext> = {}): AutoApplyContext {
  return {
    fitScore: 92,
    applicationConfidence: 98,
    eligibility: "eligible",
    jobOpen: true,
    firstSeenAt: new Date(NOW.getTime() - 2 * HOUR),
    atsType: "GREENHOUSE",
    applicationsToday: 0,
    applicationsToCompany: 0,
    ...overrides,
  };
}

describe("modeFor", () => {
  it("treats an ATS nobody configured as disabled (spec §18 unknown: false)", () => {
    expect(modeFor(rules(), "WORKDAY")).toBe("DISABLED");
    expect(modeFor(rules(), "GREENHOUSE")).toBe("AUTO");
  });
});

describe("decideAutoApply", () => {
  it("authorizes an application that clears every rule", () => {
    const decision = decideAutoApply(rules(), context(), NOW);
    expect(decision.verdict).toBe("auto");
    expect(decision.reasons).toHaveLength(1);
  });

  it("blocks an ineligible job", () => {
    const decision = decideAutoApply(
      rules(),
      context({ eligibility: "ineligible" }),
      NOW,
    );
    expect(decision.verdict).toBe("blocked");
    expect(decision.reasons[0]).toContain("hard eligibility");
  });

  it("blocks a job that has come off its board", () => {
    expect(decideAutoApply(rules(), context({ jobOpen: false }), NOW).verdict).toBe(
      "blocked",
    );
  });

  it("blocks a posting older than the age limit", () => {
    const old = context({ firstSeenAt: new Date(NOW.getTime() - 100 * HOUR) });
    const decision = decideAutoApply(rules({ maximumPostingAgeHours: 72 }), old, NOW);
    expect(decision.verdict).toBe("blocked");
    expect(decision.reasons[0]).toContain("100h old");
  });

  it("blocks at the daily limit, not one past it", () => {
    const atLimit = decideAutoApply(
      rules({ dailyApplicationLimit: 5 }),
      context({ applicationsToday: 5 }),
      NOW,
    );
    const underLimit = decideAutoApply(
      rules({ dailyApplicationLimit: 5 }),
      context({ applicationsToday: 4 }),
      NOW,
    );
    expect(atLimit.verdict).toBe("blocked");
    expect(underLimit.verdict).toBe("auto");
  });

  it("blocks too many applications to one company", () => {
    const decision = decideAutoApply(
      rules({ maxApplicationsPerCompany: 3 }),
      context({ applicationsToCompany: 3 }),
      NOW,
    );
    expect(decision.verdict).toBe("blocked");
  });

  it("blocks an ATS that was never enabled", () => {
    const decision = decideAutoApply(rules(), context({ atsType: "WORKDAY" }), NOW);
    expect(decision.verdict).toBe("blocked");
    expect(decision.reasons[0]).toContain("WORKDAY");
  });

  it("blocks a fit score below the floor rather than asking about it", () => {
    // Spec §18: below minimum_fit_score, never queued "auto or otherwise".
    const decision = decideAutoApply(rules(), context({ fitScore: 40 }), NOW);
    expect(decision.verdict).toBe("blocked");
  });

  it("collects every blocking reason, not just the first", () => {
    const decision = decideAutoApply(
      rules(),
      context({
        eligibility: "ineligible",
        jobOpen: false,
        atsType: "WORKDAY",
      }),
      NOW,
    );
    expect(decision.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("asks a person when eligibility is merely unconfirmed", () => {
    const decision = decideAutoApply(
      rules(),
      context({ eligibility: "unconfirmed" }),
      NOW,
    );
    expect(decision.verdict).toBe("review");
  });

  it("never auto-applies on an unknown confidence", () => {
    const decision = decideAutoApply(
      rules(),
      context({ applicationConfidence: null }),
      NOW,
    );
    expect(decision.verdict).toBe("review");
    expect(decision.reasons[0]).toContain("not been parsed");
  });

  it("asks when confidence is below the minimum", () => {
    const decision = decideAutoApply(
      rules({ minimumApplicationConfidence: 95 }),
      context({ applicationConfidence: 80 }),
      NOW,
    );
    expect(decision.verdict).toBe("review");
  });

  it("asks whenever the fit score is unknown, minimum set or not", () => {
    const withMinimum = decideAutoApply(
      rules({ minimumFitScore: 80 }),
      context({ fitScore: null }),
      NOW,
    );
    expect(withMinimum.verdict).toBe("review");

    // This used to return "auto": with no minimum set there was supposedly
    // nothing for a missing score to fail. That reasoning only held while a
    // missing score was near-impossible. Fit scoring now withholds a number
    // whenever too little of the profile could be compared, so "unknown"
    // reaches this gate on ordinary jobs — and the default minimum is 0.
    // An unjudged job must never apply to itself.
    const withoutMinimum = decideAutoApply(
      rules({ minimumFitScore: 0 }),
      context({ fitScore: null }),
      NOW,
    );
    expect(withoutMinimum.verdict).toBe("review");
    expect(withoutMinimum.reasons.join(" ")).toContain("fit score");
  });

  it("routes a review-mode ATS to review even when everything else passes", () => {
    const decision = decideAutoApply(rules(), context({ atsType: "ASHBY" }), NOW);
    expect(decision.verdict).toBe("review");
    expect(decision.reasons[0]).toContain("ASHBY");
  });

  it("prefers blocking over asking when both apply", () => {
    const decision = decideAutoApply(
      rules(),
      context({ eligibility: "unconfirmed", jobOpen: false }),
      NOW,
    );
    expect(decision.verdict).toBe("blocked");
  });
});

describe("readAtsModes", () => {
  it("keeps the modes it recognizes", () => {
    expect(readAtsModes({ GREENHOUSE: "AUTO", ASHBY: "REVIEW" })).toEqual({
      GREENHOUSE: "AUTO",
      ASHBY: "REVIEW",
    });
  });

  it("drops anything it does not recognize rather than trusting it", () => {
    expect(readAtsModes({ GREENHOUSE: "yes", LEVER: true, ASHBY: "AUTO" })).toEqual({
      ASHBY: "AUTO",
    });
  });

  it("returns an empty map for junk, which means nothing is auto-enabled", () => {
    expect(readAtsModes(null)).toEqual({});
    expect(readAtsModes("AUTO")).toEqual({});
    expect(readAtsModes(["AUTO"])).toEqual({});
  });
});
