/**
 * Filling the employment and education blocks.
 *
 * A live run against Coinbase left "Company name", "Title", "Current role" and
 * "Discipline" empty — not because the matching was wrong but because there
 * was nowhere to store the answers. These are the rules for using them once
 * there is.
 */

import { describe, expect, it } from "vitest";
import { currentWork, profileValueFor, type FillProfile } from "./fill-plan";
import { classifyFieldLabel } from "./classify-field";

const BASE: FillProfile = {
  name: "Ander Ayala",
  email: "a@example.com",
  phone: null,
  address: null,
  school: "CUNY - John Jay College",
  degree: "Bachelor's Degree",
  graduationDate: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
};

const WITH_HISTORY: FillProfile = {
  ...BASE,
  work: [
    { company: "Acme Labs", title: "Software Intern", location: "Brooklyn, NY", isCurrent: true },
    { company: "Older Co", title: "Helpdesk", location: null, isCurrent: false },
  ],
  education: [
    { school: "CUNY - John Jay College", degree: "Bachelor's Degree", fieldOfStudy: "Computer Science" },
  ],
};

describe("currentWork", () => {
  it("prefers the current job over an earlier one", () => {
    expect(currentWork(WITH_HISTORY)?.company).toBe("Acme Labs");
  });

  it("falls back to the most recent when none is marked current", () => {
    const past: FillProfile = {
      ...BASE,
      work: [
        { company: "Recent Co", title: "Analyst", location: null, isCurrent: false },
        { company: "Older Co", title: "Helpdesk", location: null, isCurrent: false },
      ],
    };
    expect(currentWork(past)?.company).toBe("Recent Co");
  });

  it("is null when nothing is on file", () => {
    expect(currentWork(BASE)).toBeNull();
  });
});

describe("profileValueFor — employment", () => {
  it("fills company and title from the current job", () => {
    expect(profileValueFor("Company name", WITH_HISTORY)).toBe("Acme Labs");
    expect(profileValueFor("Title", WITH_HISTORY)).toBe("Software Intern");
  });

  it("leaves them empty when there is no work history", () => {
    // The point of the whole exercise: no invented employer.
    expect(profileValueFor("Company name", BASE)).toBeNull();
    expect(profileValueFor("Title", BASE)).toBeNull();
  });

  // A live measurement run against the real Coinbase form handed this
  // checkbox the job-TITLE string ("Software Intern" / "Security Manager" in
  // different runs) because it used to share a regex with the title rule
  // above. "Current role" is a boolean — "I still work here" — never a job
  // title, and the box's own options never contain one, so that string could
  // only ever fail to match. Answered from isCurrent instead.
  it("answers 'Current role' from isCurrent, never with the job title", () => {
    expect(profileValueFor("Current role", WITH_HISTORY)).toBe("Yes");
    expect(profileValueFor("Current position", WITH_HISTORY)).toBe("Yes");
    expect(profileValueFor("I currently work here", WITH_HISTORY)).toBe("Yes");
  });

  it("leaves 'Current role' unticked when the most recent job has already ended", () => {
    const pastJobOnly: FillProfile = {
      ...BASE,
      work: [{ company: "Older Co", title: "Helpdesk", location: null, isCurrent: false }],
    };
    // Not a gap to report — an unticked box IS the correct answer here.
    expect(profileValueFor("Current role", pastJobOnly)).toBeNull();
  });

  it("leaves 'Current role' empty when there is no work history at all", () => {
    expect(profileValueFor("Current role", BASE)).toBeNull();
  });

  // Answering these with the candidate's own employer would be actively wrong.
  it("never answers a question about THIS employer with the candidate's", () => {
    expect(profileValueFor("Have you previously been employed by Coinbase?", WITH_HISTORY)).toBeNull();
    expect(profileValueFor("Why do you want to work at our company?", WITH_HISTORY)).toBeNull();
    expect(profileValueFor("Have you ever worked at this company?", WITH_HISTORY)).toBeNull();
  });

  it("does not treat a salutation or a publication as a job title", () => {
    expect(profileValueFor("Title (Mr/Ms/Dr)", WITH_HISTORY)).toBeNull();
    expect(profileValueFor("Salutation / Title", WITH_HISTORY)).toBeNull();
    expect(profileValueFor("Publication title", WITH_HISTORY)).toBeNull();
  });
});

describe("profileValueFor — discipline", () => {
  it("fills discipline from the education entry", () => {
    expect(profileValueFor("Discipline", WITH_HISTORY)).toBe("Computer Science");
    expect(profileValueFor("Major", WITH_HISTORY)).toBe("Computer Science");
    expect(profileValueFor("Field of Study", WITH_HISTORY)).toBe("Computer Science");
  });

  // The degree string is "Bachelor's Degree" — not a discipline. Filling both
  // from it looked right in an earlier live run and was not.
  it("stays empty when no field of study is recorded", () => {
    expect(profileValueFor("Discipline", BASE)).toBeNull();
  });

  it("still keeps degree and discipline separate", () => {
    expect(profileValueFor("Degree", WITH_HISTORY)).toBe("Bachelor's Degree");
  });
});

describe("classification of the employment block", () => {
  it("treats the employment fields as profile questions", () => {
    // Before work history was stored these fell through to the answer bank,
    // where nothing could ever match them, so they sat unanswered every run.
    expect(classifyFieldLabel("Company name")).toBe("standard");
    expect(classifyFieldLabel("Current role")).toBe("standard");
    expect(classifyFieldLabel("Title")).toBe("standard");
    expect(classifyFieldLabel("Job title")).toBe("standard");
  });

  // These are the candidate's to answer and must stay with the answer bank.
  it("leaves questions about the employer to the answer bank", () => {
    expect(classifyFieldLabel("Have you previously been employed by Coinbase in any capacity?")).not.toBe("standard");
    expect(classifyFieldLabel("Why do you want to work at our company?")).not.toBe("standard");
  });
});
