/**
 * Tests for profile and Truth Ledger parsing.
 *
 * Two properties are load-bearing for the whole system:
 *
 *   - blank stays null (the eligibility engine must never read a default that
 *     nobody typed — spec §11 acts on these fields)
 *   - a metric with no number is refused (spec §3: quantify only when a real
 *     number exists)
 */

import { describe, it, expect } from "vitest";
import { RemotePreference, TruthFactCategory } from "@prisma/client";
import {
  checkbox,
  date,
  list,
  parseProfile,
  parseTruthFact,
  text,
  wholeNumber,
  type FormValues,
} from "./parse";

/** The minimum a profile form must contain to be valid. */
const MINIMAL: FormValues = { name: "Ander", email: "ander@example.com" };

describe("text", () => {
  it("trims, and treats blank as absent", () => {
    expect(text({ a: "  hi  " }, "a")).toBe("hi");
    expect(text({ a: "   " }, "a")).toBeNull();
    expect(text({}, "a")).toBeNull();
  });
});

describe("list", () => {
  it("splits on commas and newlines", () => {
    expect(list({ a: "NYC, Boston\nRemote" }, "a")).toEqual(["NYC", "Boston", "Remote"]);
  });

  it("drops blanks and exact duplicates", () => {
    expect(list({ a: "Python, , Python,\n" }, "a")).toEqual(["Python"]);
  });

  it("returns an empty list for a missing field", () => {
    expect(list({}, "a")).toEqual([]);
  });
});

describe("checkbox", () => {
  it("reads what a browser actually submits", () => {
    expect(checkbox({ a: "on" }, "a")).toBe(true);
    expect(checkbox({}, "a")).toBe(false);
    expect(checkbox({ a: "off" }, "a")).toBe(false);
  });
});

describe("wholeNumber", () => {
  it("distinguishes blank from unparseable", () => {
    expect(wholeNumber({}, "a")).toBeNull();
    expect(wholeNumber({ a: "  " }, "a")).toBeNull();
    expect(wholeNumber({ a: "abc" }, "a")).toBeUndefined();
    expect(wholeNumber({ a: "-5" }, "a")).toBeUndefined();
  });

  it("accepts the separators people type into a salary box", () => {
    expect(wholeNumber({ a: "45,000" }, "a")).toBe(45000);
    expect(wholeNumber({ a: "45000" }, "a")).toBe(45000);
    expect(wholeNumber({ a: "30.7" }, "a")).toBe(30);
  });
});

describe("date", () => {
  it("accepts a full date and a bare month", () => {
    expect(date({ a: "2027-05-15" }, "a")).toEqual(new Date("2027-05-15T00:00:00.000Z"));
    expect(date({ a: "2027-05" }, "a")).toEqual(new Date("2027-05-01T00:00:00.000Z"));
  });

  it("separates blank from malformed", () => {
    expect(date({}, "a")).toBeNull();
    expect(date({ a: "May 2027" }, "a")).toBeUndefined();
    expect(date({ a: "2027/05/15" }, "a")).toBeUndefined();
  });

  it("rejects a day that does not exist instead of rolling it forward", () => {
    expect(date({ a: "2026-02-31" }, "a")).toBeUndefined();
  });
});

describe("parseProfile", () => {
  it("requires a name and a plausible email", () => {
    const noName = parseProfile({ email: "a@b.com" });
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.errors).toContain("Name is required.");

    const badEmail = parseProfile({ name: "Ander", email: "not-an-email" });
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.errors[0]).toContain("is not an email address");
  });

  it("leaves every optional field null when the form is blank", () => {
    const result = parseProfile(MINIMAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.school).toBeNull();
    expect(result.value.workAuthorization).toBeNull();
    expect(result.value.citizenship).toBeNull();
    expect(result.value.graduationDate).toBeNull();
    expect(result.value.minimumSalary).toBeNull();
    expect(result.value.skills).toEqual([]);
  });

  it("defaults remote preference to ANY rather than picking one", () => {
    const blank = parseProfile(MINIMAL);
    const junk = parseProfile({ ...MINIMAL, remotePreference: "banana" });
    if (blank.ok) expect(blank.value.remotePreference).toBe(RemotePreference.ANY);
    if (junk.ok) expect(junk.value.remotePreference).toBe(RemotePreference.ANY);
  });

  it("reads a full form", () => {
    const result = parseProfile({
      ...MINIMAL,
      phone: "555-0100",
      school: "Rutgers",
      degree: "BS Computer Science",
      graduationDate: "2028-05",
      workAuthorization: "US Citizen",
      needsSponsorship: "on",
      preferredLocations: "NYC, Remote",
      remotePreference: "HYBRID",
      minimumSalary: "25",
      skills: "Python\nTypeScript",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.graduationDate).toEqual(new Date("2028-05-01T00:00:00.000Z"));
    expect(result.value.needsSponsorship).toBe(true);
    expect(result.value.remotePreference).toBe(RemotePreference.HYBRID);
    expect(result.value.minimumSalary).toBe(25);
    expect(result.value.preferredLocations).toEqual(["NYC", "Remote"]);
    expect(result.value.skills).toEqual(["Python", "TypeScript"]);
  });

  it("reports every problem at once rather than one per submit", () => {
    const result = parseProfile({
      email: "nope",
      graduationDate: "next spring",
      minimumSalary: "lots",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseTruthFact", () => {
  const FACT: FormValues = {
    category: "EXPERIENCE",
    statement: "Uniqlo — Seasonal Sales Associate — inventory and restocking",
  };

  it("needs a category and a statement", () => {
    expect(parseTruthFact({}).ok).toBe(false);
    expect(parseTruthFact({ statement: "x" }).ok).toBe(false);
    expect(parseTruthFact({ category: "EXPERIENCE" }).ok).toBe(false);
    expect(parseTruthFact(FACT).ok).toBe(true);
  });

  it("rejects a category that is not one of the ledger's own", () => {
    expect(parseTruthFact({ ...FACT, category: "MADE_UP" }).ok).toBe(false);
  });

  it("refuses a metric with no number in it (spec §3)", () => {
    const vague = parseTruthFact({ ...FACT, metric: "lots of units" });
    expect(vague.ok).toBe(false);
    if (!vague.ok) expect(vague.errors[0]).toContain("real number");

    const real = parseTruthFact({ ...FACT, metric: "50 units/day" });
    expect(real.ok).toBe(true);
    if (real.ok) expect(real.value.metric).toBe("50 units/day");
  });

  it("keeps a blank metric null rather than empty string", () => {
    const result = parseTruthFact({ ...FACT, metric: "  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.metric).toBeNull();
  });

  it("parses the optional structured fields", () => {
    const result = parseTruthFact({
      ...FACT,
      category: "PROJECT",
      technology: "TypeScript",
      sourceDate: "2026-06",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.category).toBe(TruthFactCategory.PROJECT);
    expect(result.value.technology).toBe("TypeScript");
    expect(result.value.sourceDate).toEqual(new Date("2026-06-01T00:00:00.000Z"));
  });
});
