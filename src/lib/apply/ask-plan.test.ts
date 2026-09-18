/**
 * Tests for which questions get put to the candidate.
 *
 * Two judgements matter here. Asking about every optional field would turn a
 * two-minute task into an interrogation, so only required ones are raised. And
 * storing an answer that names the employer would put last week's answer on
 * this week's form — the exact failure this codebase exists to avoid.
 */

import { describe, it, expect } from "vitest";
import { questionsToAsk, unansweredSuggestions, worthStoring } from "./ask-plan";
import { findAnswer, SUGGESTED_QUESTIONS, type AnswerEntry } from "../answers/match";
import type { FillableField } from "./fill-plan";
import type { FieldOutcome } from "./shadow-types";

function field(overrides: Partial<FillableField> = {}): FillableField {
  return {
    label: "Company name",
    kind: "custom",
    required: true,
    elementId: "company",
    name: "",
    inputType: "text",
    options: [],
    ...overrides,
  };
}

function outcome(label: string, status: FieldOutcome["status"], detail = ""): FieldOutcome {
  return { label, status, detail, source: "none" };
}

describe("questionsToAsk", () => {
  it("asks about a required field nothing could fill", () => {
    const fields = [field()];
    const asked = questionsToAsk(fields, [outcome("Company name", "skipped")]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.question).toBe("Company name");
  });

  it("does not ask about anything already filled", () => {
    const fields = [field()];
    expect(questionsToAsk(fields, [outcome("Company name", "filled", "Acme")])).toEqual([]);
    expect(questionsToAsk(fields, [outcome("Company name", "chosen", "Acme")])).toEqual([]);
  });

  it("leaves optional fields alone", () => {
    const fields = [field({ required: false })];
    expect(questionsToAsk(fields, [outcome("Company name", "skipped")])).toEqual([]);
  });

  it("never asks someone to type a file", () => {
    const fields = [field({ label: "Resume", kind: "file", inputType: "file" })];
    expect(questionsToAsk(fields, [outcome("Resume", "skipped")])).toEqual([]);
  });

  it("skips fields the parser could not describe", () => {
    // Asking "please answer: (unlabelled field)" helps nobody.
    const fields = [field({ kind: "unknown" })];
    expect(questionsToAsk(fields, [outcome("Company name", "skipped")])).toEqual([]);
  });

  it("carries the dropdown's options through, so the answer can be a real one", () => {
    const fields = [field({ inputType: "select", options: ["Yes", "No"] })];
    const asked = questionsToAsk(fields, [outcome("Company name", "failed", "no match")]);
    expect(asked[0]?.options).toEqual(["Yes", "No"]);
  });

  it("explains why it is asking, using the failure when there was one", () => {
    const fields = [field()];
    const asked = questionsToAsk(fields, [
      outcome("Company name", "failed", "Dropdown. Your answer matched none of its 3 options"),
    ]);
    expect(asked[0]?.reason).toContain("matched none");
  });
});

describe("worthStoring", () => {
  it("keeps answers that every employer asks", () => {
    expect(worthStoring("Are you at least 18 years of age?", "Coinbase")).toBe(true);
    expect(worthStoring("How did you hear about this job?", "Coinbase")).toBe(true);
    expect(worthStoring("Will you require sponsorship?", "Coinbase")).toBe(true);
  });

  it("refuses to store an answer about this particular employer", () => {
    // "No" at Coinbase is not an answer about Stripe.
    expect(
      worthStoring("Have you previously been employed by Coinbase in any capacity?", "Coinbase"),
    ).toBe(false);
  });

  it("refuses to store details tied to this one posting", () => {
    expect(worthStoring("Which team are you applying to for this role?", "Coinbase")).toBe(false);
    expect(worthStoring("Preferred start date for this position", "Coinbase")).toBe(false);
  });

  it("still keeps the reusable prose questions that mention the role", () => {
    // Everyone asks this and the answer is usually reusable.
    expect(worthStoring("Why are you interested in this role?", "Coinbase")).toBe(true);
  });

  // A label proven to be reused with a different meaning in different
  // sections of a form (src/lib/answers/ambiguous-labels.ts) is refused here
  // too, not just at fill time. buildFillPlan already refuses to reuse any
  // answer-bank entry under one of these labels regardless of what is
  // stored, so storing it cannot recreate the original wrong-value-on-a-form
  // failure — but it would still sit in the answer bank as one flat row
  // silently mixing an employment date with an education date, which is
  // exactly the shape of data that caused the real corruption this file's
  // design otherwise avoids. Decision: don't store it. The person retypes it
  // on every form until section-scoped storage exists — a real cost, but a
  // misleading stored row nothing can safely interpret is worse.
  it("refuses to store an answer under a label proven to collide across sections", () => {
    expect(worthStoring("Start date month", "Coinbase")).toBe(false);
    expect(worthStoring("Start date year", "Coinbase")).toBe(false);
    expect(worthStoring("End date month", "Coinbase")).toBe(false);
    expect(worthStoring("End date year", "Datadog")).toBe(false);
  });

  // A "question" that is really the form's own field id, because the form
  // offered no readable label and the reader fell back to the input's `name`.
  // Four of these are already in the answer bank, and they are the reason
  // /answers was asking the candidate `cards[026d7ce7-...][field0]`. Such a
  // row can never match a future form either — matching is on question text,
  // and those ids are regenerated per form — so it is pure dead weight.
  it("refuses to store a machine field id as though it were a question", () => {
    expect(worthStoring("cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]", "Coinbase")).toBe(
      false,
    );
    expect(worthStoring("job_application[answers][3]", "Stripe")).toBe(false);
    expect(worthStoring("field0", "Stripe")).toBe(false);
    expect(worthStoring("026d7ce7-7ca4-44ed-9db6-1c7857707f0e", "Stripe")).toBe(false);
  });

  it("keeps storing real questions that the field-id check must not swallow", () => {
    expect(worthStoring("Are you legally authorized to work in the United States?", "Stripe")).toBe(
      true,
    );
    expect(worthStoring("How did you hear about us?", "Stripe")).toBe(true);
  });
});

/**
 * Tests for the "still unanswered" list behind /answers.
 *
 * The bug this replaces: the page matched suggested questions to stored ones
 * by exact lowercase text, while displaying those same answers via
 * `findAnswer`. So it showed the candidate's sponsorship answer and, a few
 * inches lower, told them sponsorship was unanswered. The strings below are
 * the real ones — the suggestion wording on one side, the employer's wording
 * actually stored in the bank on the other.
 */
describe("unansweredSuggestions", () => {
  function stored(question: string, answer: string): AnswerEntry {
    return { id: question, question, answer, isLegal: false };
  }

  const questionsIn = (entries: AnswerEntry[]) =>
    unansweredSuggestions(entries).map((suggestion) => suggestion.question);

  it("lists every standard question when nothing is stored", () => {
    expect(unansweredSuggestions([])).toHaveLength(SUGGESTED_QUESTIONS.length);
  });

  it("does not call a question unanswered when the answer is stored in the employer's words", () => {
    // Both of these were being listed as missing while the same page showed
    // the answer. They are the same question; only the wording differs.
    const entries = [
      stored("Are you legally authorized to work in the United States?", "Yes"),
      stored("Will you now or in the future require sponsorship for employment visa status?", "No"),
    ];
    expect(questionsIn(entries)).not.toContain("Are you authorized to work in the US?");
    expect(questionsIn(entries)).not.toContain(
      "Will you now or in the future require sponsorship?",
    );
  });

  it("still lists the ones genuinely never answered", () => {
    const entries = [stored("Are you legally authorized to work in the United States?", "Yes")];
    // Nothing in the bank covers these, so an apply run really will stop.
    expect(questionsIn(entries)).toContain("Salary expectations");
    expect(questionsIn(entries)).toContain("Preferred location");
  });

  it("counts an answer stored under the exact suggested wording", () => {
    const entries = [stored("Salary expectations", "Open to the posted range")];
    expect(questionsIn(entries)).not.toContain("Salary expectations");
  });

  it("does not count a row holding a blank answer", () => {
    // A blank would fill the form with nothing instead of pausing, which is
    // the one outcome this list exists to predict.
    const entries = [stored("Salary expectations", "   ")];
    expect(questionsIn(entries)).toContain("Salary expectations");
  });

  it("agrees with the matcher the autofill uses, on every suggested question", () => {
    // The property that makes the page unable to contradict itself: a
    // suggestion is missing exactly when findAnswer finds nothing for it.
    const entries = [
      stored("Are you legally authorized to work in the United States?", "Yes"),
      stored("Why are you interested in this role?", "Because…"),
    ];
    for (const suggestion of SUGGESTED_QUESTIONS) {
      const found = findAnswer(suggestion.question, entries);
      const listed = questionsIn(entries).includes(suggestion.question);
      expect(listed).toBe(found === null);
    }
  });
});
