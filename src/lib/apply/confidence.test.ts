/**
 * Tests for application confidence (spec §17).
 *
 * The scores that matter are the zeroes. A CAPTCHA or a login wall means the
 * run cannot proceed unattended at all, and a partial score in either case
 * would be a number that invites someone to press submit anyway.
 */

import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_WEIGHTS,
  scoreConfidence,
  answeredFromOutcomes,
  type MaterialsState,
  type ParsedField,
  type ParsedForm,
} from "./confidence";

const READY: MaterialsState = { resumeReady: true, coverLetterReady: true };

function field(overrides: Partial<ParsedField> = {}): ParsedField {
  return { label: "Full name", kind: "standard", required: true, answered: true, ...overrides };
}

function form(overrides: Partial<ParsedForm> = {}): ParsedForm {
  return {
    fields: [
      field({ label: "Full name" }),
      field({ label: "Email" }),
      field({ label: "Authorized to work in the US?", kind: "legal" }),
      field({ label: "Why this company?", kind: "custom" }),
    ],
    unrecognizedFields: 0,
    captcha: false,
    loginRequired: false,
    resumeRequired: true,
    coverLetterRequired: false,
    ...overrides,
  };
}

describe("scoreConfidence", () => {
  it("scores a fully understood, fully answered form highly", () => {
    const result = scoreConfidence(form(), READY, 0.9);
    expect(result.score).toBeGreaterThan(90);
    expect(result.unanswered).toEqual([]);
  });

  it("scores zero on a CAPTCHA, whatever else is true", () => {
    const result = scoreConfidence(form({ captcha: true }), READY, 0.9);
    expect(result.score).toBe(0);
  });

  it("scores zero when a login is required", () => {
    const result = scoreConfidence(form({ loginRequired: true }), READY, 0.9);
    expect(result.score).toBe(0);
  });

  it("lists required fields with no answer", () => {
    const result = scoreConfidence(
      form({
        fields: [
          field({ label: "Full name" }),
          field({ label: "Why us?", kind: "custom", answered: false }),
          field({ label: "Optional extra", answered: false, required: false }),
        ],
      }),
      READY,
      0.9,
    );
    expect(result.unanswered).toEqual(["Why us?"]);
  });

  it("counts fields the parser could not classify against it", () => {
    const understood = scoreConfidence(form(), READY, 0.9);
    const confused = scoreConfidence(form({ unrecognizedFields: 4 }), READY, 0.9);
    expect(confused.score).toBeLessThan(understood.score);
  });

  it("drops the score when a required document is missing", () => {
    const withResume = scoreConfidence(form({ resumeRequired: true }), READY, 0.9);
    const without = scoreConfidence(
      form({ resumeRequired: true }),
      { resumeReady: false, coverLetterReady: true },
      0.9,
    );
    expect(without.score).toBeLessThan(withResume.score);
  });

  it("gives no submission credit to an ATS with no adapter", () => {
    const result = scoreConfidence(form(), READY, 0);
    const submission = result.components.find((c) => c.name === "submission");
    expect(submission?.score).toBe(0);
    expect(submission?.detail).toContain("No apply adapter");
  });

  it("treats a form section with no fields as satisfied rather than failed", () => {
    // A form with no custom questions has not failed the custom-answer check;
    // there was nothing to answer.
    const result = scoreConfidence(
      form({ fields: [field({ label: "Full name" })] }),
      READY,
      0.9,
    );
    const custom = result.components.find((c) => c.name === "customAnswers");
    expect(custom?.score).toBe(1);
  });

  it("uses exactly spec §17's weights, summing to 1", () => {
    const total = Object.values(CONFIDENCE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(CONFIDENCE_WEIGHTS.standardFields).toBe(0.3);
    expect(CONFIDENCE_WEIGHTS.legalAnswers).toBe(0.2);
    expect(CONFIDENCE_WEIGHTS.formParsing).toBe(0.2);
    expect(CONFIDENCE_WEIGHTS.customAnswers).toBe(0.15);
    expect(CONFIDENCE_WEIGHTS.documents).toBe(0.1);
    expect(CONFIDENCE_WEIGHTS.submission).toBe(0.05);
  });
});

describe("an empty parse", () => {
  it("scores zero rather than 100 — a form with no fields is a failed read", () => {
    // This is the bug the first live preflight run exposed: nothing was found,
    // every "did we miss anything?" component answered no, and the result was
    // a confident 100%.
    const result = scoreConfidence(
      form({ fields: [], resumeRequired: false, coverLetterRequired: false }),
      READY,
      0.9,
    );
    expect(result.score).toBe(0);
    expect(result.blockers[0]).toContain("No form fields");
  });

  it("names the reason for every hard zero", () => {
    expect(scoreConfidence(form({ captcha: true }), READY, 0.9).blockers[0]).toContain(
      "CAPTCHA",
    );
    expect(
      scoreConfidence(form({ loginRequired: true }), READY, 0.9).blockers[0],
    ).toContain("login");
  });

  it("leaves blockers empty on a normal run", () => {
    expect(scoreConfidence(form(), READY, 0.9).blockers).toEqual([]);
  });
});

describe("submission reliability", () => {
  it("scores a more reliable adapter above a less reliable one", () => {
    const trusted = scoreConfidence(form(), READY, 0.95);
    const shaky = scoreConfidence(form(), READY, 0.25);
    expect(trusted.score).toBeGreaterThan(shaky.score);
  });

  it("says plainly when no adapter exists at all", () => {
    const submission = scoreConfidence(form(), READY, 0).components.find(
      (c) => c.name === "submission",
    );
    expect(submission?.score).toBe(0);
    expect(submission?.detail).toContain("No apply adapter");
  });
});

describe("answeredFromOutcomes", () => {
  it("marks a field answered only when the run actually resolved it", () => {
    // A failed fill is not an answer, and neither is silence: a field the run
    // never recorded an outcome for is a field nobody filled in.
    const result = answeredFromOutcomes(
      [
        { label: "Full name", kind: "standard", required: true },
        { label: "School", kind: "standard", required: true },
        { label: "Why us?", kind: "custom", required: false },
      ],
      [
        { label: "Full name", status: "filled" },
        { label: "School", status: "failed" },
      ],
    );
    expect(result.map((f) => f.answered)).toEqual([true, false, false]);
  });

  it("treats filled, chosen, attached and answered alike", () => {
    const result = answeredFromOutcomes(
      [
        { label: "Full name", kind: "standard", required: true },
        { label: "Work authorization", kind: "legal", required: true },
        { label: "Resume", kind: "file", required: true },
        { label: "Why us?", kind: "custom", required: true },
        { label: "Cover letter", kind: "file", required: false },
      ],
      [
        { label: "Full name", status: "filled" },
        { label: "Work authorization", status: "chosen" },
        { label: "Resume", status: "attached" },
        { label: "Why us?", status: "answered" },
        { label: "Cover letter", status: "skipped" },
      ],
    );
    expect(result.map((f) => f.answered)).toEqual([true, true, true, true, false]);
  });

  it("carries label, kind and required through unchanged", () => {
    const result = answeredFromOutcomes(
      [{ label: "Full name", kind: "standard", required: true }],
      [{ label: "Full name", status: "filled" }],
    );
    expect(result[0]).toEqual({
      label: "Full name",
      kind: "standard",
      required: true,
      answered: true,
    });
  });
});
