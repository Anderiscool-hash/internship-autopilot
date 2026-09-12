/**
 * Tests for the answer-bank label denylist.
 *
 * The cases here are the real evidence, not made-up examples — see the file
 * comment on ambiguous-labels.ts and docs/findings/answer-bank-label-
 * collisions.md. The same four labels ("Start date month/year", "End date
 * month/year") sit in the EMPLOYMENT block on Coinbase's real Greenhouse
 * form and in the EDUCATION block on Datadog's and Stripe's, and a live
 * measurement run confirmed a stored education date actually landed on
 * Coinbase's employment fields through this exact collision.
 */

import { describe, it, expect } from "vitest";
import { ambiguousLabelReason } from "./ambiguous-labels";

describe("ambiguousLabelReason", () => {
  it("refuses the four labels proven to collide across sections", () => {
    for (const label of ["Start date month", "Start date year", "End date month", "End date year"]) {
      expect(ambiguousLabelReason(label)).not.toBeNull();
    }
  });

  it("matches case-insensitively and after trimming, the way a real DOM label varies", () => {
    expect(ambiguousLabelReason("  start date month  ")).not.toBeNull();
    expect(ambiguousLabelReason("START DATE MONTH")).not.toBeNull();
  });

  it("explains itself — a human reading the reason should understand why", () => {
    const reason = ambiguousLabelReason("Start date month");
    expect(reason).toMatch(/employment/i);
    expect(reason).toMatch(/education/i);
  });

  it("does not swallow a differently-worded question that happens to share words", () => {
    // Stripe's own phrasing — "What is your current or previous job title?" —
    // is answerable unambiguously from the profile's work history and must
    // stay that way. A denylist matched as a substring rather than a whole
    // label would wrongly catch this.
    expect(ambiguousLabelReason("What is your current or previous job title?")).toBeNull();
    expect(ambiguousLabelReason("When is your graduation date (actual or expected)?")).toBeNull();
  });

  it("leaves unrelated and not-yet-proven-ambiguous labels alone", () => {
    // Company name / Title / School / Degree are flagged in the findings doc
    // as generic enough to collide someday, but were not observed colliding
    // in the evidence available when this was written, so they are
    // deliberately NOT on this list yet — see the file's own "SCOPE" note.
    expect(ambiguousLabelReason("Company name")).toBeNull();
    expect(ambiguousLabelReason("Title")).toBeNull();
    expect(ambiguousLabelReason("School")).toBeNull();
    expect(ambiguousLabelReason("Degree")).toBeNull();
    expect(ambiguousLabelReason("Email")).toBeNull();
  });
});
