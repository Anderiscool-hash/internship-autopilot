/**
 * Tests for form-field classification.
 *
 * The one that matters: a legal question must never be mistaken for a standard
 * profile field. "Are you legally authorized to work in the country of the
 * job's location?" contains the word "location", and treating it as an address
 * field would put a city into an answer about work authorization.
 */

import { describe, it, expect } from "vitest";
import {
  classifyFieldLabel,
  cleanLabel,
  GENERIC_CONTROL_LABEL,
  humanizeIdentifier,
  looksRequired,
} from "./classify-field";

describe("classifyFieldLabel", () => {
  it("recognizes standard profile fields, however they are written", () => {
    for (const label of [
      "First Name",
      "Last name *",
      "Email Address",
      "E-mail",
      "Phone",
      "LinkedIn Profile",
      "School",
      "Degree",
      "Expected graduation date",
    ]) {
      expect(classifyFieldLabel(label), label).toBe("standard");
    }
  });

  it("recognizes legal and eligibility questions", () => {
    for (const label of [
      "Are you legally authorized to work in the United States?",
      "Will you now or in the future require sponsorship?",
      "Do you hold an active security clearance?",
      "Are you a US citizen?",
      "Voluntary Self-Identification of Disability",
      "Gender",
    ]) {
      expect(classifyFieldLabel(label), label).toBe("legal");
    }
  });

  it("does not let a legal question be read as an address field", () => {
    expect(
      classifyFieldLabel(
        "Are you legally authorized to work in the country of the job's location?",
      ),
    ).toBe("legal");
  });

  it("recognizes document uploads by label or by input type", () => {
    expect(classifyFieldLabel("Resume/CV")).toBe("file");
    expect(classifyFieldLabel("Cover Letter")).toBe("file");
    expect(classifyFieldLabel("Anything at all", "file")).toBe("file");
  });

  it("treats an unrecognized question as custom, not as understood", () => {
    expect(classifyFieldLabel("What excites you about this team?")).toBe("custom");
    expect(classifyFieldLabel("Tell us about a project", "textarea")).toBe("custom");
  });

  it("returns unknown only when there is no readable label", () => {
    expect(classifyFieldLabel("")).toBe("unknown");
    expect(classifyFieldLabel("   ")).toBe("unknown");
  });

  it("calls a readable but unfamiliar question custom, not unknown", () => {
    // "custom" says the answer bank must supply this; "unknown" says we cannot
    // describe the field at all. Real Greenhouse forms are full of the former.
    expect(classifyFieldLabel("Company name")).toBe("custom");
    expect(classifyFieldLabel("Current role")).toBe("custom");
    expect(
      classifyFieldLabel("I am available to begin a full-time role before September 2028."),
    ).toBe("custom");
  });
});

describe("cleanLabel", () => {
  it("strips the decoration around required fields", () => {
    expect(cleanLabel("First Name *")).toBe("First Name");
    expect(cleanLabel("Email  (required)")).toBe("Email");
    expect(cleanLabel("Phone (optional)")).toBe("Phone");
    expect(cleanLabel("  Full   Name  ")).toBe("Full Name");
  });
});

describe("looksRequired", () => {
  it("believes aria-required over the label text", () => {
    expect(looksRequired("Phone", "true")).toBe(true);
  });

  it("reads the conventional asterisk", () => {
    expect(looksRequired("First Name *")).toBe(true);
    expect(looksRequired("First Name (required)")).toBe(true);
    expect(looksRequired("Phone")).toBe(false);
  });
});

describe("humanizeIdentifier", () => {
  it("turns a control id into the question it stands for", () => {
    // Greenhouse's file inputs show "Attach" and carry id="resume".
    expect(humanizeIdentifier("resume")).toBe("Resume");
    expect(humanizeIdentifier("cover_letter")).toBe("Cover letter");
    expect(humanizeIdentifier("first-name")).toBe("First name");
    expect(humanizeIdentifier("phoneNumber")).toBe("Phone number");
  });

  it("returns nothing for an empty id rather than inventing a label", () => {
    expect(humanizeIdentifier("")).toBe("");
    expect(humanizeIdentifier("   ")).toBe("");
  });
});

describe("GENERIC_CONTROL_LABEL", () => {
  it("matches control names, not questions", () => {
    expect(GENERIC_CONTROL_LABEL.test("Attach")).toBe(true);
    expect(GENERIC_CONTROL_LABEL.test("Upload")).toBe(true);
    expect(GENERIC_CONTROL_LABEL.test("Resume/CV")).toBe(false);
    expect(GENERIC_CONTROL_LABEL.test("Why this company?")).toBe(false);
  });
});
