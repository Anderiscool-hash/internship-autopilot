/**
 * Tests for the hard eligibility engine (spec §11).
 *
 * The property under test throughout: silence never fails. A posting that did
 * not state a requirement, or a profile that did not state a fact, produces
 * "unknown" — never "fail". Failing on silence would hide jobs the candidate
 * could have applied to, and they would never find out.
 */

import { describe, it, expect } from "vitest";
import { checkEligibility, inferEducationLevel, type EligibilityProfile } from "./engine";
import { NO_REQUIREMENTS, type JobRequirements } from "./requirements";

/** A profile that satisfies everything, so each test can break one thing. */
function profile(overrides: Partial<EligibilityProfile> = {}): EligibilityProfile {
  return {
    degree: "BS Computer Science",
    graduationDate: new Date("2028-05-01T00:00:00.000Z"),
    needsSponsorship: false,
    citizenship: "United States",
    workAuthorization: "US Citizen",
    certifications: [],
    ...overrides,
  };
}

function requirements(overrides: Partial<JobRequirements> = {}): JobRequirements {
  return { ...NO_REQUIREMENTS, ...overrides };
}

/** Pull one check out of a result by its label. */
function check(result: ReturnType<typeof checkEligibility>, label: string) {
  const found = result.checks.find((item) => item.label === label);
  if (!found) throw new Error(`no check labelled ${label}`);
  return found;
}

describe("inferEducationLevel", () => {
  it("reads the ways people write their degree", () => {
    expect(inferEducationLevel("BS Computer Science")).toBe("bachelors");
    expect(inferEducationLevel("B.A. Economics")).toBe("bachelors");
    expect(inferEducationLevel("Bachelor of Science")).toBe("bachelors");
    expect(inferEducationLevel("MS Data Science")).toBe("masters");
    expect(inferEducationLevel("PhD Physics")).toBe("phd");
    expect(inferEducationLevel("Associate's in IT")).toBe("associates");
  });

  it("returns null rather than guessing", () => {
    expect(inferEducationLevel(null)).toBeNull();
    expect(inferEducationLevel("Computer Science")).toBeNull();
  });
});

describe("checkEligibility", () => {
  it("is eligible when the posting states nothing to fail", () => {
    const result = checkEligibility(profile(), requirements());
    expect(result.verdict).toBe("eligible");
    expect(result.blockers).toEqual([]);
  });

  it("fails a degree the candidate does not hold", () => {
    const result = checkEligibility(profile(), requirements({ educationLevel: "masters" }));
    expect(result.verdict).toBe("ineligible");
    expect(check(result, "Degree requirement").verdict).toBe("fail");
  });

  it("passes when the candidate exceeds the required degree", () => {
    const result = checkEligibility(
      profile({ degree: "MS Computer Science" }),
      requirements({ educationLevel: "bachelors" }),
    );
    expect(check(result, "Degree requirement").verdict).toBe("pass");
  });

  it("does not fail a degree requirement when the profile is blank", () => {
    const result = checkEligibility(
      profile({ degree: null }),
      requirements({ educationLevel: "masters" }),
    );
    expect(check(result, "Degree requirement").verdict).toBe("unknown");
    expect(result.verdict).toBe("unconfirmed");
  });

  it("fails a graduation year outside the posting's window", () => {
    const result = checkEligibility(
      profile({ graduationDate: new Date("2031-05-01T00:00:00.000Z") }),
      requirements({ graduationWindow: { from: 2027, to: 2028 } }),
    );
    expect(check(result, "Graduation requirement").verdict).toBe("fail");
    expect(check(result, "Graduation requirement").reason).toContain("2031");
  });

  it("passes a graduation year on the window's boundary", () => {
    const result = checkEligibility(
      profile({ graduationDate: new Date("2027-12-01T00:00:00.000Z") }),
      requirements({ graduationWindow: { from: 2027, to: 2028 } }),
    );
    expect(check(result, "Graduation requirement").verdict).toBe("pass");
  });

  it("does not fail a graduation window when no date is recorded", () => {
    const result = checkEligibility(
      profile({ graduationDate: null }),
      requirements({ graduationWindow: { from: 2027, to: 2028 } }),
    );
    expect(check(result, "Graduation requirement").verdict).toBe("unknown");
  });

  it("fails experience above the student threshold and passes at it", () => {
    const tooMuch = checkEligibility(
      profile(),
      requirements({ minimumExperienceYears: 5 }),
    );
    expect(check(tooMuch, "Experience requirement").verdict).toBe("fail");

    const fine = checkEligibility(profile(), requirements({ minimumExperienceYears: 2 }));
    expect(check(fine, "Experience requirement").verdict).toBe("pass");
  });

  it("honours a custom experience threshold", () => {
    const result = checkEligibility(
      profile(),
      requirements({ minimumExperienceYears: 4 }),
      { maxExperienceYears: 5 },
    );
    expect(check(result, "Experience requirement").verdict).toBe("pass");
  });

  it("fails sponsorship only when both sides state the conflict", () => {
    const conflict = checkEligibility(
      profile({ needsSponsorship: true }),
      requirements({ sponsorship: "none" }),
    );
    expect(check(conflict, "Work authorization").verdict).toBe("fail");

    const silent = checkEligibility(
      profile({ needsSponsorship: true }),
      requirements({ sponsorship: "unknown" }),
    );
    expect(check(silent, "Work authorization").verdict).toBe("unknown");

    const offered = checkEligibility(
      profile({ needsSponsorship: true }),
      requirements({ sponsorship: "available" }),
    );
    expect(check(offered, "Work authorization").verdict).toBe("pass");
  });

  it("ignores a no-sponsorship posting when the candidate needs none", () => {
    const result = checkEligibility(
      profile({ needsSponsorship: false }),
      requirements({ sponsorship: "none" }),
    );
    expect(check(result, "Work authorization").verdict).toBe("pass");
    expect(result.verdict).toBe("eligible");
  });

  it("fails a citizenship the candidate does not hold", () => {
    const result = checkEligibility(
      profile({ citizenship: "India" }),
      requirements({ citizenshipRequired: "United States" }),
    );
    expect(check(result, "Citizenship requirement").verdict).toBe("fail");
  });

  it("accepts the ways a US citizenship might be written", () => {
    for (const written of ["United States", "USA", "US", "American"]) {
      const result = checkEligibility(
        profile({ citizenship: written }),
        requirements({ citizenshipRequired: "United States" }),
      );
      expect(check(result, "Citizenship requirement").verdict, written).toBe("pass");
    }
  });

  it("does not fail a citizenship requirement when the profile is blank", () => {
    const result = checkEligibility(
      profile({ citizenship: null }),
      requirements({ citizenshipRequired: "United States" }),
    );
    expect(check(result, "Citizenship requirement").verdict).toBe("unknown");
  });

  it("fails a clearance requirement unless the profile records one", () => {
    const without = checkEligibility(profile(), requirements({ clearanceRequired: true }));
    expect(check(without, "Security clearance").verdict).toBe("fail");
    expect(check(without, "Security clearance").reason).toContain("certifications");

    const with_ = checkEligibility(
      profile({ certifications: ["Active TS/SCI clearance"] }),
      requirements({ clearanceRequired: true }),
    );
    expect(check(with_, "Security clearance").verdict).toBe("pass");
  });

  it("collects every blocker rather than stopping at the first", () => {
    const result = checkEligibility(
      profile({ needsSponsorship: true, citizenship: "India" }),
      requirements({
        educationLevel: "phd",
        sponsorship: "none",
        citizenshipRequired: "United States",
        clearanceRequired: true,
      }),
    );
    expect(result.verdict).toBe("ineligible");
    expect(result.blockers.map((blocker) => blocker.label).sort()).toEqual([
      "Citizenship requirement",
      "Degree requirement",
      "Security clearance",
      "Work authorization",
    ]);
  });

  it("always reports every check, so the reader sees the whole table", () => {
    const result = checkEligibility(profile(), requirements());
    expect(result.checks.map((item) => item.label)).toEqual([
      "Degree requirement",
      "Graduation requirement",
      "Experience requirement",
      "Work authorization",
      "Citizenship requirement",
      "Security clearance",
    ]);
  });
});
