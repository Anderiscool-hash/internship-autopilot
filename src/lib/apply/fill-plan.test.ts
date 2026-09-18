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
  cityFrom,
  matchOption,
  matchOptionForLabel,
  profileValueFor,
  type FillableField,
  type FillProfile,
  looksLikeProse,
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
    // A City field gets a city, not the whole address line.
    expect(profileValueFor("Location (City)", PROFILE)).toBe("Brooklyn");
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

  // With no documents passed, an upload is still skipped — but the reason now
  // tells the person what to do about it. See fill-plan-documents.test.ts for
  // the attaching side.
  it("skips a file upload when no document is saved, and says which one", () => {
    const plan = buildFillPlan(
      [field({ label: "Resume", kind: "file", inputType: "file" })],
      PROFILE,
      ANSWERS,
    );
    expect(plan.planned[0]?.action).toEqual({
      type: "skip",
      reason: "No resume is saved. Upload one on the profile screen.",
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

  // See src/lib/answers/ambiguous-labels.ts and
  // docs/findings/answer-bank-label-collisions.md for the evidence: real
  // Greenhouse forms reuse "Start date month" for an EMPLOYMENT date
  // (Coinbase) and for an EDUCATION date (Datadog, Stripe). A live
  // measurement run against the real Coinbase form confirmed this pulls a
  // stored degree date onto an employer's employment fields, so the stored
  // answer must never be reused here, however well the text matches.
  describe("the ambiguous-label denylist", () => {
    const DATE_ANSWERS: AnswerEntry[] = [
      { id: "sdm", question: "Start date month", answer: "08", isLegal: false },
    ];

    it("does not reuse a stored 'Start date month' answer", () => {
      const plan = buildFillPlan(
        [field({ label: "Start date month", kind: "standard", inputType: "select", options: ["January", "August"] })],
        PROFILE,
        DATE_ANSWERS,
      );
      expect(plan.planned[0]?.action.type).toBe("skip");
      expect(plan.planned[0]?.source).toBe("none");
    });

    it("explains why in the skip reason, not just that it skipped", () => {
      const plan = buildFillPlan(
        [field({ label: "Start date month", kind: "standard", inputType: "text" })],
        PROFILE,
        DATE_ANSWERS,
      );
      const action = plan.planned[0]?.action;
      expect(action?.type).toBe("skip");
      if (action?.type === "skip") {
        // A human reading this should understand WHY, not just "no value" —
        // the whole point of a denylist reason over the generic one.
        expect(action.reason).toMatch(/different/i);
        expect(action.reason.length).toBeGreaterThan(40);
      }
    });

    // The regression this could easily cause: PROFILE-sourced values must
    // stay untouched. "Company name" and "Title" fill correctly from stored
    // work history — unambiguous structured data — and the denylist must
    // never intercept that path.
    it("still fills 'Company name' and 'Title' from the profile", () => {
      const profileWithWork: FillProfile = {
        ...PROFILE,
        work: [{ company: "Acme Labs", title: "Software Intern", location: null, isCurrent: true }],
      };
      const plan = buildFillPlan(
        [
          field({ label: "Company name", kind: "standard" }),
          field({ label: "Title", kind: "standard" }),
        ],
        profileWithWork,
        DATE_ANSWERS,
      );
      expect(plan.planned[0]?.action).toEqual({ type: "fill", value: "Acme Labs" });
      expect(plan.planned[0]?.source).toBe("profile");
      expect(plan.planned[1]?.action).toEqual({ type: "fill", value: "Software Intern" });
      expect(plan.planned[1]?.source).toBe("profile");
    });

    // The denylist must not quietly disable the answer bank in general — an
    // unambiguous custom label with a stored answer still fills normally.
    it("still fills an unambiguous custom label from the answer bank", () => {
      const plan = buildFillPlan(
        [field({ label: "Why are you interested in this role?", kind: "custom", inputType: "textarea" })],
        PROFILE,
        ANSWERS,
      );
      expect(plan.planned[0]?.action).toEqual({
        type: "fill",
        value: "Because I have spent two years building payment tooling.",
      });
      expect(plan.planned[0]?.source).toBe("answer-bank");
    });
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

describe("cityFrom", () => {
  it("reads the city out of a full address", () => {
    expect(cityFrom("Brooklyn, NY")).toBe("Brooklyn");
    expect(cityFrom("108 Autumn Ave, Brooklyn, NY")).toBe("Brooklyn");
  });

  it("returns null when the address is just a street", () => {
    // From a live run: "108 autum ave" went into Coinbase's City field.
    expect(cityFrom("108 autum ave")).toBeNull();
    expect(cityFrom("108 autum ave, 11208")).toBeNull();
  });

  it("returns null for nothing", () => {
    expect(cityFrom(null)).toBeNull();
    expect(cityFrom("")).toBeNull();
  });
});

describe("matchOptionForLabel", () => {
  const SCHOOLS = ["Aalto University", "John Jay College of Criminal Justice", "Yale University"];
  const DEGREES = [
    "Associate's Degree",
    "Bachelor's Degree",
    "Master's Degree",
    "Doctor of Philosophy (Ph.D.)",
  ];

  it("ignores a parenthetical the list does not carry", () => {
    // From a live run: the profile says "(CUNY)", the dropdown does not.
    expect(
      matchOptionForLabel(
        "John Jay College of Criminal Justice (CUNY)",
        SCHOOLS,
        "School",
      ),
    ).toBe("John Jay College of Criminal Justice");
  });

  it("maps a written degree onto the list's fixed vocabulary", () => {
    // "B.S. in Computer Science & Cybersecurity" is not an option anywhere,
    // but the level it states is.
    expect(
      matchOptionForLabel("B.S. in Computer Science & Cybersecurity", DEGREES, "Degree"),
    ).toBe("Bachelor's Degree");
    expect(matchOptionForLabel("MS Data Science", DEGREES, "Degree")).toBe("Master's Degree");
    expect(matchOptionForLabel("PhD Physics", DEGREES, "Degree")).toBe(
      "Doctor of Philosophy (Ph.D.)",
    );
  });

  it("only maps degrees on a degree field", () => {
    // The same mapping on a "School" field would be nonsense.
    expect(matchOptionForLabel("BS Computer Science", DEGREES, "School")).toBeNull();
  });

  it("still refuses when nothing matches", () => {
    expect(matchOptionForLabel("Hogwarts", SCHOOLS, "School")).toBeNull();
    expect(matchOptionForLabel("Some certificate", DEGREES, "Degree")).toBeNull();
  });
});

describe("looksLikeProse", () => {
  // The live failure this guard exists for: a Duolingo essay prompt whose
  // wording happens to contain "college", which made the school rule fire and
  // typed the candidate's school name in as their proudest accomplishment.
  it("refuses the essay prompt that once got answered with a school name", () => {
    expect(
      looksLikeProse(
        "Share with us your proudest accomplishment. This can be pre-college.",
      ),
    ).toBe(true);
    expect(
      profileValueFor(
        "Share with us your proudest accomplishment. This can be pre-college.",
        PROFILE,
      ),
    ).toBeNull();
  });

  it("recognises the other ways a form asks for prose", () => {
    for (const prompt of [
      "Why are you interested in Duolingo?",
      "Tell us about your experience in computer science. Why did you choose it?",
      "Describe a time you disagreed with a teammate.",
      "How will your personal experiences make an impact at Duolingo?",
      "In your own words, what drew you to this role?",
    ]) {
      expect(looksLikeProse(prompt), prompt).toBe(true);
    }
  });

  it("leaves real field labels alone", () => {
    for (const label of [
      "School",
      "University",
      "Preferred First Name",
      "LinkedIn Profile",
      "Degree",
      "Undergraduate GPA",
      "Company name",
      "Start date month",
      "Website",
      "Are you authorized to work lawfully in the United States?",
    ]) {
      expect(looksLikeProse(label), label).toBe(false);
    }
  });

  it("still answers a genuine school field", () => {
    expect(profileValueFor("School", PROFILE)).toBe(PROFILE.school);
    expect(profileValueFor("College or University", PROFILE)).toBe(PROFILE.school);
  });
});
