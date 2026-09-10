/**
 * Tests for reading the stored requirements JSON.
 *
 * The column is unvalidated JSON as far as the database is concerned, so the
 * job of this parser is to never turn junk into a confident answer about
 * someone's eligibility.
 */

import { describe, it, expect } from "vitest";
import { extractRequirements } from "./extract";
import { readStoredRequirements } from "./stored";
import { NO_REQUIREMENTS } from "./requirements";

describe("readStoredRequirements", () => {
  it("round-trips what the extractor produces", () => {
    const extracted = extractRequirements(
      "Pursuing a Bachelor's degree, graduating in 2027. No visa sponsorship is available.",
    );
    const stored = JSON.parse(JSON.stringify(extracted));
    expect(readStoredRequirements(stored)).toEqual(extracted);
  });

  it("returns null for a column that was never populated", () => {
    expect(readStoredRequirements(null)).toBeNull();
    expect(readStoredRequirements(undefined)).toBeNull();
    expect(readStoredRequirements("not an object")).toBeNull();
    expect(readStoredRequirements([1, 2, 3])).toBeNull();
  });

  it("degrades unrecognized values to unknown rather than trusting them", () => {
    const parsed = readStoredRequirements({
      educationLevel: "wizardry",
      graduationWindow: { from: "soon", to: 2028 },
      minimumExperienceYears: -4,
      sponsorship: "maybe",
      citizenshipRequired: "",
      clearanceRequired: "yes",
    });
    expect(parsed).toEqual(NO_REQUIREMENTS);
  });

  it("rejects a backwards graduation window", () => {
    const parsed = readStoredRequirements({ graduationWindow: { from: 2030, to: 2020 } });
    expect(parsed?.graduationWindow).toBeNull();
  });

  it("keeps the fields it does recognize when others are junk", () => {
    const parsed = readStoredRequirements({
      educationLevel: "masters",
      sponsorship: "nonsense",
      clearanceRequired: true,
    });
    expect(parsed?.educationLevel).toBe("masters");
    expect(parsed?.sponsorship).toBe("unknown");
    expect(parsed?.clearanceRequired).toBe(true);
  });
});
