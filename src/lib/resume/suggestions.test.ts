/**
 * Tests for the stored-value-vs-suggestion decision.
 *
 * The empty-string case is the one that already broke in a live run: the
 * graduation date's empty state is "" rather than null, so `??` treated it as
 * a real value and silently discarded the suggestion. One field out of eleven,
 * no error, nothing in the logs.
 */

import { describe, it, expect } from "vitest";
import { chooseFieldValue, chooseListValue, type Suggested } from "./suggestions";

const suggestion: Suggested<string> = {
  value: "2027-05",
  evidence: "BS Computer Science, expected May 2027",
  source: "pattern",
};

describe("chooseFieldValue", () => {
  it("uses a suggestion when the stored value is an empty string", () => {
    // The regression: <input type="month"> is fed "" when there is no date.
    expect(chooseFieldValue("", suggestion)).toEqual({
      value: "2027-05",
      fromSuggestion: true,
    });
  });

  it("uses a suggestion when the stored value is null or undefined", () => {
    expect(chooseFieldValue(null, suggestion).fromSuggestion).toBe(true);
    expect(chooseFieldValue(undefined, suggestion).fromSuggestion).toBe(true);
  });

  it("never overwrites a value the user already has", () => {
    expect(chooseFieldValue("2026-12", suggestion)).toEqual({
      value: "2026-12",
      fromSuggestion: false,
    });
  });

  it("treats whitespace as absent", () => {
    expect(chooseFieldValue("   ", suggestion).fromSuggestion).toBe(true);
  });

  it("keeps a stored zero, which is a real value", () => {
    expect(chooseFieldValue(0, undefined)).toEqual({ value: "0", fromSuggestion: false });
  });

  it("returns empty when there is neither a value nor a suggestion", () => {
    expect(chooseFieldValue(null, undefined)).toEqual({ value: "", fromSuggestion: false });
    expect(chooseFieldValue("", undefined)).toEqual({ value: "", fromSuggestion: false });
  });
});

describe("chooseListValue", () => {
  const skills: Suggested<string[]> = {
    value: ["Python", "TypeScript"],
    evidence: "suggested by a model",
    source: "ai",
  };

  it("uses a suggestion for an empty list", () => {
    expect(chooseListValue([], skills)).toEqual({
      values: ["Python", "TypeScript"],
      fromSuggestion: true,
    });
  });

  it("never overwrites skills the user already listed", () => {
    expect(chooseListValue(["Rust"], skills)).toEqual({
      values: ["Rust"],
      fromSuggestion: false,
    });
  });

  it("returns empty when there is nothing on either side", () => {
    expect(chooseListValue([], undefined)).toEqual({ values: [], fromSuggestion: false });
  });
});
