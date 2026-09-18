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
import { ambiguousLabelReason, looksLikeFieldId } from "./ambiguous-labels";

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

/**
 * Tests for "this is not a question, it is a form's field id".
 *
 * The positive cases are the four real rows sitting in this candidate's
 * answer bank — saved when the form reader could find no visible label and
 * fell back to the input's `name` attribute. The negative cases are real
 * stored questions from the same bank: if any of those were caught, this
 * predicate would be deleting a person's own answers off the screen, which is
 * far worse than the bug it exists to fix.
 */
describe("looksLikeFieldId", () => {
  it("catches the four machine ids actually stored in the answer bank", () => {
    expect(looksLikeFieldId("cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]")).toBe(true);
    expect(looksLikeFieldId("cards[7736d0ea-6916-4d17-8895-c31776dbef15][field0]")).toBe(true);
    expect(looksLikeFieldId("cards[841c3f3c-3e6e-4665-9391-e360210fb5ee][field0]")).toBe(true);
    expect(looksLikeFieldId("cards[877379a1-2abf-4eab-9c51-81e7b5828b3e][field0]")).toBe(true);
  });

  it("catches the other bracket shapes an ATS submits fields under", () => {
    expect(looksLikeFieldId("job_application[answers][3]")).toBe(true);
    expect(looksLikeFieldId("job_application[answers_attributes][0][text_value]")).toBe(true);
    expect(looksLikeFieldId("  cards[abc][field0]  ")).toBe(true);
  });

  it("catches a bare numbered input", () => {
    expect(looksLikeFieldId("field0")).toBe(true);
    expect(looksLikeFieldId("input_2")).toBe(true);
    expect(looksLikeFieldId("question-7")).toBe(true);
    expect(looksLikeFieldId("answer.3")).toBe(true);
  });

  it("catches a bare uuid or a long hex id", () => {
    expect(looksLikeFieldId("026d7ce7-7ca4-44ed-9db6-1c7857707f0e")).toBe(true);
    expect(looksLikeFieldId("7736D0EA-6916-4D17-8895-C31776DBEF15")).toBe(true);
    expect(looksLikeFieldId("a1b2c3d4e5f60718")).toBe(true);
  });

  it("leaves real questions from the answer bank alone", () => {
    // Every one of these is a question a person was actually asked. A false
    // positive here hides their answer, so these are the cases that matter.
    expect(looksLikeFieldId("Are you legally authorized to work in the United States?")).toBe(
      false,
    );
    expect(
      looksLikeFieldId("Will you now or in the future require sponsorship for employment visa status?"),
    ).toBe(false);
    expect(looksLikeFieldId("Start date month")).toBe(false);
    expect(looksLikeFieldId("How did you hear about us?")).toBe(false);
    expect(looksLikeFieldId("Why are you interested in this role?")).toBe(false);
    expect(looksLikeFieldId("Salary expectations")).toBe(false);
  });

  it("leaves short and oddly-worded labels alone rather than guessing", () => {
    // Anything doubtful is let through on purpose — see the file's SCOPE
    // note. A one-word label is a label; a word that merely contains digits
    // is not an id either.
    expect(looksLikeFieldId("Email")).toBe(false);
    expect(looksLikeFieldId("field")).toBe(false);
    expect(looksLikeFieldId("question")).toBe(false);
    expect(looksLikeFieldId("COVID-19 vaccination status")).toBe(false);
    expect(looksLikeFieldId("Web3 experience")).toBe(false);
    expect(looksLikeFieldId("")).toBe(false);
    expect(looksLikeFieldId("   ")).toBe(false);
  });
});
