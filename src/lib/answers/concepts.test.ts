/**
 * Tests for concept matching.
 *
 * Both headline cases come from one live shadow run against Coinbase's form:
 * the sponsorship pair that should match and did not, and the work
 * authorization pair that must not match and would have, had concept matching
 * been added without a scope rule.
 */

import { describe, it, expect } from "vitest";
import { conceptOf, sameQuestion, scopeMarkers } from "./concepts";

describe("conceptOf", () => {
  it("names the concepts application forms actually ask about", () => {
    expect(conceptOf("Will you require sponsorship for employment visa status?")).toBe("sponsorship");
    expect(conceptOf("Are you legally authorized to work in the US?")).toBe("work-authorization");
    expect(conceptOf("Are you at least 18 years of age?")).toBe("age-18");
    expect(conceptOf("Do you hold an active security clearance?")).toBe("security-clearance");
    expect(conceptOf("Have you ever been convicted of a felony?")).toBe("criminal-record");
    expect(conceptOf("Have you previously been employed by Coinbase?")).toBe("previously-employed");
    expect(conceptOf("How did you hear about this job?")).toBe("referral-source");
  });

  it("reads a question mentioning both as the sponsorship one", () => {
    // "Will you require sponsorship to work in the US" is about sponsorship,
    // even though it also contains the authorization vocabulary.
    expect(
      conceptOf("Will you require sponsorship to be authorized to work in the US?"),
    ).toBe("sponsorship");
  });

  it("returns null for a question outside the standard vocabulary", () => {
    expect(conceptOf("Describe a project you are proud of.")).toBeNull();
    expect(conceptOf("Why this company?")).toBeNull();
  });
});

describe("scopeMarkers", () => {
  it("finds a named country", () => {
    expect(scopeMarkers("authorized to work in the US?")).toContain("united-states");
    expect(scopeMarkers("authorized to work in Canada?")).toContain("canada");
    // Spellings of one place must reduce to one scope, or a good answer goes
    // unused for the same reason word overlap missed the sponsorship pair.
    expect(scopeMarkers("authorized to work in the United States?")).toEqual(
      scopeMarkers("authorized to work in the U.S.?"),
    );
  });

  it("treats 'the country where this position is located' as a scope", () => {
    expect(
      scopeMarkers("authorized to work in the country where this position is located"),
    ).toContain("job-country");
  });

  it("finds nothing in an unscoped question", () => {
    expect(scopeMarkers("Will you now or in the future require sponsorship?")).toEqual([]);
  });
});

describe("sameQuestion", () => {
  it("matches the sponsorship pair that word overlap missed", () => {
    // The exact pair from the live run: scored 0.57 against a 0.8 threshold.
    expect(
      sameQuestion(
        "Will you now or in the future require sponsorship?",
        "Will you require sponsorship for employment visa status now or in the future?",
      ),
    ).toBe(true);
  });

  it("refuses a US answer for a question about the job's own country", () => {
    // Also from the live run. That posting could be in London; answering "yes"
    // would be a false legal claim on a real application.
    expect(
      sameQuestion(
        "Are you authorized to work in the US?",
        "Are you legally authorized to work in the country where this position is located?",
      ),
    ).toBe(false);
  });

  it("refuses to answer a scoped question from an unscoped one", () => {
    expect(
      sameQuestion("Are you authorized to work?", "Are you authorized to work in Canada?"),
    ).toBe(false);
  });

  it("matches when both name the same country", () => {
    expect(
      sameQuestion(
        "Are you authorized to work in the US?",
        "Are you legally authorized to work in the United States?",
      ),
    ).toBe(true);
  });

  it("refuses when they name different countries", () => {
    expect(
      sameQuestion(
        "Are you authorized to work in the US?",
        "Are you authorized to work in Canada?",
      ),
    ).toBe(false);
  });

  it("does not match two different concepts", () => {
    expect(
      sameQuestion(
        "Will you require sponsorship?",
        "Are you at least 18 years of age?",
      ),
    ).toBe(false);
  });

  it("does not match questions outside the vocabulary, however similar", () => {
    // Two open questions can only be matched by wording, which is the other
    // matcher's job.
    expect(
      sameQuestion("Why this company?", "Why do you want to work here?"),
    ).toBe(false);
  });
});
