/**
 * Tests for requirement extraction (spec §10).
 *
 * Two failure modes matter, and they are not symmetric:
 *
 *   - a missed requirement means a job is shown that should have been ruled
 *     out. Annoying; the reader still sees the posting and can judge.
 *   - an invented requirement means a job is hidden that the candidate could
 *     have had. That one is unrecoverable — they never learn it existed.
 *
 * So most of these tests are about NOT extracting things: prose that mentions
 * a PhD, a year, or sponsorship without requiring anything must come back
 * unknown.
 */

import { describe, it, expect } from "vitest";
import { EARLIEST_YEAR, LATEST_YEAR, extractRequirements, toPlainText } from "./extract";

describe("toPlainText", () => {
  it("turns tags into spaces so words are not glued together", () => {
    expect(toPlainText("<li>Must be a U.S.<b>citizen</b></li>")).toBe(
      "Must be a U.S. citizen",
    );
  });

  it("decodes the entities ATS descriptions actually contain", () => {
    expect(toPlainText("R&amp;D&nbsp;team")).toBe("R&D team");
  });
});

describe("sponsorship", () => {
  it("reads a refusal, however it is phrased", () => {
    const phrasings = [
      "We are unable to provide visa sponsorship for this role.",
      "This position is not eligible for sponsorship.",
      "Candidates must be authorized to work in the US without sponsorship.",
      "We do not sponsor employment visas at this time.",
      "No visa sponsorship is available.",
    ];
    for (const text of phrasings) {
      expect(extractRequirements(text).sponsorship, text).toBe("none");
    }
  });

  it("reads an offer of sponsorship", () => {
    expect(extractRequirements("We will sponsor visas for this role.").sponsorship).toBe(
      "available",
    );
    expect(extractRequirements("Visa sponsorship is available.").sponsorship).toBe(
      "available",
    );
  });

  it("stays unknown when the posting never mentions it", () => {
    expect(
      extractRequirements("Join our team building payment infrastructure.").sponsorship,
    ).toBe("unknown");
  });
});

describe("citizenship", () => {
  it("catches the standard phrasings", () => {
    expect(extractRequirements("Must be a U.S. citizen.").citizenshipRequired).toBe(
      "United States",
    );
    expect(
      extractRequirements("US citizenship is required for this position.")
        .citizenshipRequired,
    ).toBe("United States");
  });

  it("does not fire on a job that merely mentions the United States", () => {
    expect(
      extractRequirements("Our United States offices are in NYC and Seattle.")
        .citizenshipRequired,
    ).toBeNull();
  });
});

describe("clearance", () => {
  it("catches an existing-clearance requirement", () => {
    expect(extractRequirements("Active security clearance required.").clearanceRequired).toBe(
      true,
    );
    expect(extractRequirements("Must hold a TS/SCI clearance.").clearanceRequired).toBe(
      true,
    );
  });

  it("does not fire on a job that offers to sponsor a clearance later", () => {
    expect(
      extractRequirements("You will be eligible to obtain a clearance after joining.")
        .clearanceRequired,
    ).toBe(false);
  });
});

describe("education level", () => {
  it("reads a demanded degree", () => {
    expect(
      extractRequirements("Requires a Master's degree in Computer Science.")
        .educationLevel,
    ).toBe("masters");
    expect(
      extractRequirements("Currently pursuing a Bachelor's degree.").educationLevel,
    ).toBe("bachelors");
    expect(extractRequirements("PhD is required for this role.").educationLevel).toBe(
      "phd",
    );
  });

  it("takes the lowest demanded level when several are named", () => {
    expect(
      extractRequirements("Must have a Bachelor's degree; PhD is required for the research track.")
        .educationLevel,
    ).toBe("bachelors");
  });

  it("reads 'a bachelor's or master's degree' as a bachelor's, not a master's", () => {
    // Real wording from a Coinbase credit-risk internship. Reading this as a
    // master's requirement hid the posting from the undergraduates it was
    // written for.
    expect(
      extractRequirements(
        "Currently pursuing a bachelor's or master's degree in finance, economics, mathematics, or a related quantitative discipline.",
      ).educationLevel,
    ).toBe("bachelors");
  });

  it("does not turn a mention into a requirement", () => {
    expect(
      extractRequirements("Our team includes PhDs from top programs.").educationLevel,
    ).toBeNull();
    expect(
      extractRequirements("You will work alongside masters students.").educationLevel,
    ).toBeNull();
  });
});

describe("graduation window", () => {
  it("reads a range", () => {
    expect(
      extractRequirements("For students graduating between 2027 and 2028.")
        .graduationWindow,
    ).toEqual({ from: 2027, to: 2028 });
  });

  it("reads a range written with 'or' rather than 'and'", () => {
    // This used to fall through to the single-year fallback and come back as
    // {2026, 2026}, which hid the job from every 2027 graduate.
    expect(extractRequirements("Graduating 2026 or 2027.").graduationWindow).toEqual({
      from: 2026,
      to: 2027,
    });
  });

  it("reads a range that has a month attached to each end", () => {
    expect(
      extractRequirements("For students graduating between December 2026 and May 2027.")
        .graduationWindow,
    ).toEqual({ from: 2026, to: 2027 });
  });

  it("leaves the upper end open when the posting says 'or later'", () => {
    // Real posting wording. The stated year is the EARLIEST accepted, not the
    // only one — closing the window at 2027 ruled out a 2029 graduate who
    // qualified.
    expect(
      extractRequirements("Expected graduation date of December 2027 or later.")
        .graduationWindow,
    ).toEqual({ from: 2027, to: LATEST_YEAR });
  });

  it("leaves the lower end open when the posting says 'or earlier'", () => {
    expect(
      extractRequirements("Open to students graduating in 2026 or earlier.")
        .graduationWindow,
    ).toEqual({ from: EARLIEST_YEAR, to: 2026 });
  });

  it("reads a single year as a window of one", () => {
    expect(extractRequirements("Graduating in 2027.").graduationWindow).toEqual({
      from: 2027,
      to: 2027,
    });
    expect(extractRequirements("Open to the class of 2026.").graduationWindow).toEqual({
      from: 2026,
      to: 2026,
    });
  });

  it("stays null when no graduation year is stated", () => {
    expect(
      extractRequirements("Founded in 2019, we now serve 2000 customers.")
        .graduationWindow,
    ).toBeNull();
  });
});

describe("experience", () => {
  it("reads the requirement", () => {
    expect(
      extractRequirements("3+ years of professional experience required.")
        .minimumExperienceYears,
    ).toBe(3);
  });

  it("takes the smallest stated number, since that is what is required", () => {
    expect(
      extractRequirements(
        "2+ years of experience required. 5+ years of experience preferred.",
      ).minimumExperienceYears,
    ).toBe(2);
  });

  it("does not treat a preference as a minimum", () => {
    // "is a plus" used to become a hard three-year minimum, which hides the
    // job from every student.
    expect(
      extractRequirements("3+ years of experience is a plus.").minimumExperienceYears,
    ).toBeNull();
  });

  it("ignores every phrasing employers use for a wish rather than a rule", () => {
    const phrasings = [
      "5+ years of relevant experience preferred.",
      "Ideally 2 years of experience in a similar role.",
      "3 years of experience with distributed systems is a nice-to-have.",
      "4+ years of experience is a bonus.",
      "2 years of experience is desirable.",
      "We'd love 6 years of experience in payments.",
    ];
    for (const text of phrasings) {
      expect(extractRequirements(text).minimumExperienceYears, text).toBeNull();
    }
  });

  it("reads a range as its lower bound", () => {
    expect(
      extractRequirements("3-5 years experience in a similar role.")
        .minimumExperienceYears,
    ).toBe(3);
  });

  it("stays null when no experience requirement is stated", () => {
    expect(
      extractRequirements("No prior industry background needed.").minimumExperienceYears,
    ).toBeNull();
  });
});

describe("extractRequirements", () => {
  it("returns all-unknown for an empty description", () => {
    const requirements = extractRequirements("");
    expect(requirements).toEqual({
      educationLevel: null,
      graduationWindow: null,
      minimumExperienceYears: null,
      sponsorship: "unknown",
      citizenshipRequired: null,
      clearanceRequired: false,
    });
  });

  it("reads a realistic posting whole", () => {
    const description = `
      <h3>Software Engineering Intern — Summer 2027</h3>
      <p>We are looking for students currently pursuing a Bachelor's degree in
      Computer Science, graduating between 2027 and 2028.</p>
      <ul>
        <li>0-1 years of experience</li>
        <li>Applicants must be authorized to work in the US without sponsorship.</li>
      </ul>
    `;
    expect(extractRequirements(description)).toEqual({
      educationLevel: "bachelors",
      graduationWindow: { from: 2027, to: 2028 },
      minimumExperienceYears: 0,
      sponsorship: "none",
      citizenshipRequired: null,
      clearanceRequired: false,
    });
  });
});
