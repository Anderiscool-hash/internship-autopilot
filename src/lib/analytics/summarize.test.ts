/**
 * Tests for search analytics (spec §29).
 *
 * The property being defended: a rate over a tiny sample is not reported at
 * all. "1 interview from 3 applications" is not a 33% interview rate, and a
 * dashboard that prints one teaches its reader something false about how their
 * search is going.
 */

import { describe, it, expect } from "vitest";
import { ApplicationOutcome } from "@prisma/client";
import {
  breakdownBy,
  MIN_SAMPLE,
  rate,
  summarize,
  type AnalyticsApplication,
} from "./summarize";

const APPLIED_AT = new Date("2026-09-01T00:00:00.000Z");

function application(
  overrides: Partial<AnalyticsApplication> = {},
): AnalyticsApplication {
  return {
    appliedAt: APPLIED_AT,
    outcome: null,
    fitScore: 80,
    companyName: "Stripe",
    atsType: "GREENHOUSE",
    ...overrides,
  };
}

/** n applications, the first `withOutcome` of them carrying an outcome. */
function many(
  n: number,
  outcome: ApplicationOutcome | null = null,
  withOutcome = n,
): AnalyticsApplication[] {
  return Array.from({ length: n }, (_, index) =>
    application({ outcome: index < withOutcome ? outcome : null }),
  );
}

describe("rate", () => {
  it("refuses to state a percentage on too small a sample", () => {
    const small = rate(1, MIN_SAMPLE - 1);
    expect(small.percent).toBeNull();
    expect(small.numerator).toBe(1);
    expect(small.denominator).toBe(MIN_SAMPLE - 1);
  });

  it("states one once the sample is big enough", () => {
    expect(rate(5, 10).percent).toBe(50);
  });

  it("does not divide by zero", () => {
    expect(rate(0, 0).percent).toBeNull();
  });
});

describe("summarize", () => {
  it("counts nothing for an empty tracker", () => {
    const summary = summarize([]);
    expect(summary.tracked).toBe(0);
    expect(summary.applied).toBe(0);
    expect(summary.responseRate.percent).toBeNull();
    expect(summary.averageFitApplied).toBeNull();
  });

  it("only counts applications that were actually submitted", () => {
    const summary = summarize([
      application({ appliedAt: null }),
      application({ appliedAt: null }),
      application(),
    ]);
    expect(summary.tracked).toBe(3);
    expect(summary.applied).toBe(1);
  });

  it("treats a rejection as a response but ghosting as silence", () => {
    const applications = [
      ...many(4, ApplicationOutcome.REJECTED),
      ...many(4, ApplicationOutcome.GHOSTED),
      ...many(2, ApplicationOutcome.INTERVIEW),
    ];
    const summary = summarize(applications);

    expect(summary.applied).toBe(10);
    expect(summary.responses).toBe(6);
    expect(summary.ghosted).toBe(4);
    expect(summary.responseRate.percent).toBe(60);
  });

  it("counts a final round and an offer as interviews too", () => {
    const summary = summarize([
      ...many(3, ApplicationOutcome.INTERVIEW),
      ...many(1, ApplicationOutcome.FINAL_ROUND),
      ...many(1, ApplicationOutcome.OFFER),
      ...many(5, ApplicationOutcome.REJECTED),
    ]);
    expect(summary.interviews).toBe(5);
    expect(summary.offers).toBe(1);
    expect(summary.interviewRate.percent).toBe(50);
  });

  it("averages fit only over applications that had a score", () => {
    const summary = summarize([
      application({ fitScore: 90 }),
      application({ fitScore: 70 }),
      application({ fitScore: null }),
    ]);
    expect(summary.averageFitApplied).toBe(80);
  });
});

describe("breakdownBy", () => {
  it("groups submitted applications and sorts by volume", () => {
    const rows = breakdownBy(
      [
        ...Array.from({ length: 3 }, () => application({ companyName: "Stripe" })),
        ...Array.from({ length: 6 }, () => application({ companyName: "Figma" })),
      ],
      (item) => item.companyName,
    );

    expect(rows.map((row) => row.key)).toEqual(["Figma", "Stripe"]);
    expect(rows[0]?.applied).toBe(6);
  });

  it("ignores rows that were never submitted", () => {
    const rows = breakdownBy(
      [application({ appliedAt: null }), application()],
      (item) => item.companyName,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.applied).toBe(1);
  });

  it("withholds a per-group rate until that group has enough applications", () => {
    const rows = breakdownBy(
      [
        ...Array.from({ length: 2 }, () =>
          application({ companyName: "Small", outcome: ApplicationOutcome.INTERVIEW }),
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          application({
            companyName: "Big",
            outcome: index < 4 ? ApplicationOutcome.INTERVIEW : null,
          }),
        ),
      ],
      (item) => item.companyName,
    );

    const small = rows.find((row) => row.key === "Small");
    const big = rows.find((row) => row.key === "Big");
    expect(small?.interviewRate.percent).toBeNull();
    expect(small?.interviews).toBe(2);
    expect(big?.interviewRate.percent).toBe(40);
  });

  it("can group by ATS as well as company", () => {
    const rows = breakdownBy(
      [
        application({ atsType: "GREENHOUSE" }),
        application({ atsType: "LEVER" }),
        application({ atsType: "GREENHOUSE" }),
      ],
      (item) => item.atsType,
    );
    expect(rows[0]).toMatchObject({ key: "GREENHOUSE", applied: 2 });
  });
});
