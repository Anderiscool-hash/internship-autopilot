/**
 * Tests for what shadow mode would type into a real employer's form.
 *
 * Almost every test here is about NOT filling something. A blank field is a
 * thing the candidate notices and fixes; a confidently wrong answer submitted
 * under their name is not retractable, and on a work-authorization question it
 * is a false legal claim. So the bias is heavily towards skipping, and these
 * tests are what hold that bias in place.
 */

import { describe, it, expect } from "vitest";
import type { AnswerEntry } from "../answers/match";
import {
  buildFillPlan,
  matchOption,
  profileValueFor,
  type FillableField,
  type FillProfile,
} from "./fill-plan";

const PROFILE: FillProfile = {
  name: "Jordan Rivera",
  email: "jordan@example.com",
  phone: "(555) 481-2200",
  address: "Brooklyn, NY",
  school: "Stony Brook University",
  degree: "BS Computer Science",
  graduationDate: new Date("2027-05-01T00:00:00.000Z"),
  linkedinUrl: "https://linkedin.com/in/jordanrivera",
  githubUrl: "https://github.com/jrivera",
  portfolioUrl: null,
};

const ANSWERS: AnswerEntry[] = [
  {
    id: "auth",
    question: "Are you legally authorized to work in the United States?",
    answer: "Yes",
    isLegal: true,
  },
  {
    id: "why",
    question: "Why are you interested in this role?",
    answer: "Because I have spent two years building payment tooling.",
    isLegal: false,
  },
];

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

describe("profileValueFor", () => {
  it("splits a full name for separate first/last fields", () => {
    expect(profileValueFor("First Name", PROFILE)).toBe("Jordan");
    expect(profileValueFor("Last Name", PROFILE)).toBe("Rivera");
    expect(profileValueFor("Full name", PROFILE)).toBe("Jordan Rivera");
  });

  it("formats a graduation date the way a month input expects", () => {
    expect(profileValueFor("Expected graduation", PROFILE)).toBe("2027-05");
  });

  it("does not put a street address into a Country field", () => {
    // Found by a live shadow run against Coinbase: the location rule matched
    // "Country" and filled it with "108 autumn ave". A plausible wrong value
    // is worse than a blank one, because nobody re-reads it.
    expect(profileValueFor("Country", PROFILE)).toBeNull();
    expect(profileValueFor("Location (City)", PROFILE)).toBe("Brooklyn, NY");
  });

  it("does not answer Discipline with the whole degree string", () => {
    // Same run: Degree and Discipline both got "BS Computer Science". They are
    // different questions and the profile stores one string.
    expect(profileValueFor("Degree", PROFILE)).toBe("BS Computer Science");
    expect(profileValueFor("Discipline", PROFILE)).toBeNull();
  });

  it("returns null for anything the profile does not hold", () => {
    expect(profileValueFor("Portfolio", PROFILE)).toBeNull();
    expect(profileValueFor("Favourite language", PROFILE)).toBeNull();
  });
});

describe("matchOption", () => {
  it("matches exactly and case-insensitively", () => {
    expect(matchOption("Yes", ["Yes", "No"])).toBe("Yes");
    expect(matchOption("yes", ["Yes", "No"])).toBe("Yes");
  });

  it("matches a prefix when it is unambiguous", () => {
    expect(matchOption("Yes", ["Yes, I am authorized", "No"])).toBe(
      "Yes, I am authorized",
    );
  });

  it("takes an exact option even when a longer one also starts with it", () => {
    // "Yes" is not ambiguous when "Yes" is literally on offer.
    expect(matchOption("Yes", ["Yes", "Yes, with conditions"])).toBe("Yes");
  });

  it("refuses to guess between two prefix matches with no exact one", () => {
    // Picking either would be inventing an answer to a legal question.
    expect(
      matchOption("Yes", ["Yes, I am authorized", "Yes, with conditions"]),
    ).toBeNull();
  });

  it("returns null rather than the nearest option", () => {
    expect(matchOption("Maybe", ["Yes", "No"])).toBeNull();
    expect(matchOption("", ["Yes"])).toBeNull();
  });
});

describe("buildFillPlan", () => {
  it("fills standard fields from the profile", () => {
    const plan = buildFillPlan([field({ label: "Email", inputType: "email" })], PROFILE, []);
    expect(plan.planned[0]?.action).toEqual({ type: "fill", value: "jordan@example.com" });
    expect(plan.planned[0]?.source).toBe("profile");
  });

  it("answers a legal question only from the answer bank", () => {
    const plan = buildFillPlan(
      [
        field({
          label: "Are you legally authorized to work in the United States?",
          kind: "legal",
          inputType: "radio",
          options: ["Yes", "No"],
        }),
      ],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action).toEqual({ type: "choose", value: "Yes", option: "Yes" });
    expect(plan.planned[0]?.source).toBe("answer-bank");
  });

  it("skips a question with no stored answer instead of guessing", () => {
    const plan = buildFillPlan(
      [field({ label: "Describe a time you failed.", kind: "custom", inputType: "textarea" })],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action.type).toBe("skip");
    expect(plan.planned[0]?.source).toBe("none");
  });

  it("never fills a legal question from a profile field that sounds similar", () => {
    // The profile knows about sponsorship. That is not the same claim as
    // whatever wording this employer used, so it is not used here.
    const plan = buildFillPlan(
      [
        field({
          label: "Will you require sponsorship for employment visa status?",
          kind: "legal",
          inputType: "radio",
          options: ["Yes", "No"],
        }),
      ],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action.type).toBe("skip");
  });

  it("always skips file uploads", () => {
    const plan = buildFillPlan(
      [field({ label: "Resume", kind: "file", inputType: "file" })],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action).toEqual({
      type: "skip",
      reason: "Document uploads are not built yet — attach this yourself.",
    });
  });

  it("skips a field the parser could not identify", () => {
    const plan = buildFillPlan(
      [field({ label: "(unlabelled field)", kind: "unknown" })],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action.type).toBe("skip");
  });

  it("skips when the stored answer is not one of the offered options", () => {
    const plan = buildFillPlan(
      [
        field({
          label: "Are you legally authorized to work in the United States?",
          kind: "legal",
          inputType: "select",
          options: ["Authorized", "Not authorized"],
        }),
      ],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action.type).toBe("skip");
  });

  it("reports required fields it had to leave empty", () => {
    const plan = buildFillPlan(
      [
        field({ label: "Email", inputType: "email" }),
        field({ label: "Resume", kind: "file", inputType: "file", required: true }),
        field({
          label: "Describe a project",
          kind: "custom",
          inputType: "textarea",
          required: true,
        }),
        field({ label: "Optional note", kind: "custom", required: false }),
      ],
      PROFILE,
      ANSWERS,
    );

    expect(plan.fillCount).toBe(1);
    expect(plan.blockingGaps).toEqual(["Resume", "Describe a project"]);
  });

  it("does not try to fill a control type it does not understand", () => {
    const plan = buildFillPlan(
      [field({ label: "Full name", inputType: "color" })],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action.type).toBe("skip");
  });
});
