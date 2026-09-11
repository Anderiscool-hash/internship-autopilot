/**
 * Tests for which questions get put to the candidate.
 *
 * Two judgements matter here. Asking about every optional field would turn a
 * two-minute task into an interrogation, so only required ones are raised. And
 * storing an answer that names the employer would put last week's answer on
 * this week's form — the exact failure this codebase exists to avoid.
 */

import { describe, it, expect } from "vitest";
import { questionsToAsk, worthStoring } from "./ask-plan";
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
});
