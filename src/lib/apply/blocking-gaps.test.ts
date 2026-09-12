/**
 * Tests for the corrected blocking-gaps list (see blocking-gaps.ts for why
 * this exists instead of just trusting FillPlan.blockingGaps).
 *
 * The motivating bug: a live run planned to fill the required "School"
 * dropdown, that fill failed once it met the real page, and the run's
 * blocking-gaps count stayed at 3 when a person looking at the form would
 * have counted 4. These tests hold that fix in place.
 */

import { describe, it, expect } from "vitest";
import type { FillableField, PlannedField } from "./fill-plan";
import type { FieldOutcome } from "./shadow-types";
import { computeBlockingGaps } from "./blocking-gaps";

function field(overrides: Partial<FillableField> = {}): FillableField {
  return {
    label: "Full name",
    kind: "standard",
    required: true,
    elementId: "name",
    name: "name",
    inputType: "text",
    options: [],
    ...overrides,
  };
}

function planned(overrides: Partial<PlannedField> = {}): PlannedField {
  return {
    field: field(),
    action: { type: "fill", value: "Jordan Rivera" },
    source: "profile",
    ...overrides,
  };
}

function outcome(overrides: Partial<FieldOutcome> = {}): FieldOutcome {
  return {
    label: "Full name",
    status: "filled",
    detail: "Jordan Rivera",
    source: "profile",
    ...overrides,
  };
}

describe("computeBlockingGaps", () => {
  it("reports a required field the plan skipped, same as FillPlan.blockingGaps would", () => {
    const items = [
      planned({
        field: field({ label: "Phone", required: true }),
        action: { type: "skip", reason: "Your profile has no value for this." },
        source: "none",
      }),
    ];
    const outcomes = [
      outcome({ label: "Phone", status: "skipped", detail: "Your profile has no value for this.", source: "none" }),
    ];

    expect(computeBlockingGaps(items, outcomes)).toEqual(["Phone"]);
  });

  it("reports a required field that was PLANNED to fill but FAILED at runtime — the School regression", () => {
    const items = [
      planned({
        field: field({ label: "School", required: true, isCombobox: true }),
        action: { type: "fill", value: "John Jay College of Criminal Justice (CUNY)" },
        source: "profile",
      }),
    ];
    const outcomes = [
      outcome({
        label: "School",
        status: "failed",
        detail: 'Dropdown. Your answer ("John Jay College of Criminal Justice (CUNY)") matched none of its 100 options',
        source: "profile",
      }),
    ];

    // FillPlan.blockingGaps would have missed this entirely, because the
    // planned action was "fill", not "skip". computeBlockingGaps must not.
    expect(computeBlockingGaps(items, outcomes)).toEqual(["School"]);
  });

  it("does not report a required field that filled successfully", () => {
    const items = [planned({ field: field({ label: "Full name", required: true }) })];
    const outcomes = [outcome({ label: "Full name", status: "filled" })];

    expect(computeBlockingGaps(items, outcomes)).toEqual([]);
  });

  it("does not report an optional field left empty or failed", () => {
    const items = [
      planned({
        field: field({ label: "Portfolio URL", required: false }),
        action: { type: "skip", reason: "Your profile has no value for this." },
        source: "none",
      }),
    ];
    const outcomes = [
      outcome({ label: "Portfolio URL", status: "skipped", detail: "no value", source: "none" }),
    ];

    expect(computeBlockingGaps(items, outcomes)).toEqual([]);
  });

  it("treats a required field with no recorded outcome at all as blocking", () => {
    const items = [planned({ field: field({ label: "Resume", required: true }) })];

    expect(computeBlockingGaps(items, [])).toEqual(["Resume"]);
  });

  it("does not double-count a field whose planned skip and final outcome are the same gap", () => {
    const items = [
      planned({
        field: field({ label: "Cover letter", required: true, kind: "file", inputType: "file" }),
        action: { type: "skip", reason: "No cover letter is saved." },
        source: "none",
      }),
    ];
    const outcomes = [
      outcome({ label: "Cover letter", status: "skipped", detail: "No cover letter is saved.", source: "none" }),
    ];

    const gaps = computeBlockingGaps(items, outcomes);
    expect(gaps).toEqual(["Cover letter"]);
    expect(gaps.filter((label) => label === "Cover letter")).toHaveLength(1);
  });

  it("treats attached/chosen outcomes as resolved, same as filled", () => {
    const items = [
      planned({ field: field({ label: "Resume", required: true, kind: "file", inputType: "file" }) }),
      planned({ field: field({ label: "Work authorization", required: true, inputType: "radio" }) }),
    ];
    const outcomes = [
      outcome({ label: "Resume", status: "attached", detail: "resume.pdf" }),
      outcome({ label: "Work authorization", status: "chosen", detail: "Yes" }),
    ];

    expect(computeBlockingGaps(items, outcomes)).toEqual([]);
  });

  it("mixes a planned-skip gap and a runtime-failure gap without losing either", () => {
    const items = [
      planned({
        field: field({ label: "Phone", required: true }),
        action: { type: "skip", reason: "no value" },
        source: "none",
      }),
      planned({
        field: field({ label: "School", required: true, isCombobox: true }),
        action: { type: "fill", value: "John Jay College of Criminal Justice (CUNY)" },
        source: "profile",
      }),
      planned({ field: field({ label: "Full name", required: true }) }),
    ];
    const outcomes = [
      outcome({ label: "Phone", status: "skipped", detail: "no value", source: "none" }),
      outcome({ label: "School", status: "failed", detail: "matched none of its options" }),
      outcome({ label: "Full name", status: "filled" }),
    ];

    expect(computeBlockingGaps(items, outcomes)).toEqual(["Phone", "School"]);
  });
});
