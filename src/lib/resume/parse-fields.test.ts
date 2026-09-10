/**
 * Tests for rule-based resume parsing.
 *
 * The bias throughout: a field the parser is unsure about must come back
 * absent, not guessed. These suggestions are shown next to a "save" button for
 * someone's real profile, and a wrong graduation year silently accepted is a
 * wrong eligibility answer on every job afterwards.
 */

import { describe, it, expect } from "vitest";
import { parseResumeFields } from "./parse-fields";

const RESUME = `
Ander Ayala
New York, NY | ander@example.com | (555) 213-4400
linkedin.com/in/anderayala | github.com/anderayala

EDUCATION
Rutgers University, New Brunswick, NJ
BS Computer Science, expected May 2028
GPA 3.7

EXPERIENCE
Uniqlo — Seasonal Sales Associate (2024)
Handled inventory and restocking for 50 units/day.
`;

describe("parseResumeFields", () => {
  it("reads the fields that have reliable shapes", () => {
    const found = parseResumeFields(RESUME);

    expect(found.email?.value).toBe("ander@example.com");
    expect(found.phone?.value).toBe("(555) 213-4400");
    expect(found.linkedinUrl?.value).toBe("https://linkedin.com/in/anderayala");
    expect(found.githubUrl?.value).toBe("https://github.com/anderayala");
    expect(found.school?.value).toContain("Rutgers University");
    expect(found.degree?.value).toContain("BS Computer Science");
    expect(found.graduationDate?.value).toBe("2028-05");
  });

  it("attaches the line each value came from, as evidence", () => {
    const found = parseResumeFields(RESUME);
    expect(found.email?.evidence).toContain("ander@example.com");
    expect(found.graduationDate?.evidence.toLowerCase()).toContain("expected");
    for (const suggestion of Object.values(found)) {
      expect(suggestion.source).toBe("pattern");
    }
  });

  it("does not guess a name or skills — those are left to the AI pass", () => {
    const found = parseResumeFields(RESUME);
    expect(found.name).toBeUndefined();
    expect(found.skills).toBeUndefined();
  });

  it("suggests nothing at all from text with none of these fields", () => {
    expect(parseResumeFields("Just some prose with no contact details.")).toEqual({});
  });

  it("does not mistake an unlabelled year for a graduation year", () => {
    // Employment dates and project years are everywhere in a resume.
    const text = "EXPERIENCE\nAcme Corp, 2023 - 2024\nBuilt a thing in 2022.";
    expect(parseResumeFields(text).graduationDate).toBeUndefined();
  });

  it("reads a graduation year with no month as just the year", () => {
    const found = parseResumeFields("BS Computer Science, graduating 2027");
    expect(found.graduationDate?.value).toBe("2027");
  });

  it("does not mistake a plain run of digits for a phone number", () => {
    // Student IDs and zip+4 are the usual false positives.
    expect(parseResumeFields("Student ID 1234567890").phone).toBeUndefined();
    expect(parseResumeFields("New York, NY 100121234").phone).toBeUndefined();
  });

  it("accepts the common phone formats", () => {
    expect(parseResumeFields("Call 555-213-4400").phone?.value).toBe("555-213-4400");
    expect(parseResumeFields("+1 555.213.4400").phone?.value).toBe("+1 555.213.4400");
  });

  it("reads a masters or PhD as well as a bachelors", () => {
    expect(parseResumeFields("MS Data Science, 2026").degree?.value).toContain("MS");
    expect(parseResumeFields("PhD in Physics").degree?.value).toContain("PhD");
  });

  it("strips a trailing location from the school line", () => {
    const found = parseResumeFields("Rutgers University, New Brunswick, NJ");
    expect(found.school?.value).toBe("Rutgers University, New Brunswick");
  });
});
