/**
 * Tests for the questionnaire sheet itself.
 *
 * Mostly structural — GROUP_ORDER and GROUP_META must stay in sync with
 * whatever groups QUESTIONNAIRE actually uses, because the page renders by
 * walking GROUP_ORDER and looks up GROUP_META[group] unconditionally
 * (src/app/answers/questionnaire.tsx). A question in a group missing from
 * either would either never render or crash the page.
 */

import { describe, it, expect } from "vitest";
import { conceptOf } from "./concepts";
import { GROUP_META, GROUP_ORDER, QUESTIONNAIRE, fieldNameFor } from "./questionnaire";

describe("GROUP_ORDER / GROUP_META", () => {
  it("has a GROUP_META entry for every group in GROUP_ORDER", () => {
    for (const group of GROUP_ORDER) {
      expect(GROUP_META[group]).toBeDefined();
    }
  });

  it("has a group for every question in QUESTIONNAIRE", () => {
    const known = new Set(GROUP_ORDER);
    for (const item of QUESTIONNAIRE) {
      expect(known.has(item.group)).toBe(true);
    }
  });

  it("includes the new acknowledgements group between eligibility and logistics", () => {
    // Not load-bearing on the exact position, but it should sit with the
    // other legal/consent-adjacent material rather than after the voluntary
    // demographic block, which is deliberately last.
    const order = GROUP_ORDER;
    expect(order).toContain("acknowledgements");
    expect(order.indexOf("acknowledgements")).toBeGreaterThan(order.indexOf("eligibility"));
    expect(order.indexOf("acknowledgements")).toBeLessThan(order.indexOf("demographic"));
  });
});

describe("fieldNameFor", () => {
  it("gives every question a distinct, stable field name", () => {
    const names = QUESTIONNAIRE.map((_, index) => fieldNameFor(index));
    expect(new Set(names).size).toBe(QUESTIONNAIRE.length);
  });
});

describe("the acknowledgement questions added for the Coinbase gap", () => {
  const acknowledgements = QUESTIONNAIRE.filter((item) => item.group === "acknowledgements");

  it("added exactly the acknowledgement/consent questions that generalize", () => {
    // Privacy notice, arbitration agreement, AI-use disclosure, AI-usage
    // habits, and the truthfulness certification. "before September 2028"
    // and the job-country work-authorization variant are deliberately absent
    // — see the questionnaire.ts group comment and the final report.
    expect(acknowledgements).toHaveLength(5);
  });

  it("is recognised by a concept, so it can match an employer's own wording", () => {
    // A stored question that conceptOf cannot name would only ever match
    // itself verbatim — pointless for a field meant to travel between ATS
    // platforms that all word it differently.
    for (const item of acknowledgements) {
      expect(conceptOf(item.question)).not.toBeNull();
    }
  });

  it("marks every acknowledgement as legal except the AI-usage self-report", () => {
    // The self-report ("how do you use AI tools") is a preference, not a
    // claim about the candidate that could be false — the other four are
    // consents or certifications and must never be silently reworded.
    const nonLegal = acknowledgements.filter((item) => !item.isLegal);
    expect(nonLegal).toHaveLength(1);
    expect(nonLegal[0]?.question).toMatch(/describes how you use/);
  });

  it("does not word any acknowledgement around one employer's name or posting", () => {
    const employerNames = ["coinbase", "stripe", "datadog"];
    for (const item of acknowledgements) {
      const text = item.question.toLowerCase();
      for (const name of employerNames) {
        expect(text.includes(name)).toBe(false);
      }
      // No posting-specific date, which is what made the "before September
      // 2028" field un-generalizable in the first place.
      expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
    }
  });
});

describe("the government-official questions added for the Coinbase gap", () => {
  it("added both as separate eligibility questions", () => {
    const status = QUESTIONNAIRE.find((item) =>
      conceptOf(item.question) === "government-official-status",
    );
    const relative = QUESTIONNAIRE.find((item) =>
      conceptOf(item.question) === "government-official-relative",
    );
    expect(status?.group).toBe("eligibility");
    expect(relative?.group).toBe("eligibility");
    expect(status?.isLegal).toBe(true);
    expect(relative?.isLegal).toBe(true);
  });
});
