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

  it("does not generalize a posting-specific date into a concept", () => {
    // From the same shadow run: "I am available to begin a potential
    // full-time role before September 2028." The date is specific to one
    // posting, so this deliberately stays outside the vocabulary — a stored
    // "yes" here would still be wrong the moment another posting names a
    // different deadline. worthStoring's fallback rules (ask-plan.ts) are
    // what would otherwise decide this, and only conceptOf recognising it
    // would make it look like a general, reusable answer.
    expect(
      conceptOf("I am available to begin a potential full-time role before September 2028"),
    ).toBeNull();
  });

  // Every wording below is quoted verbatim from a live shadow run against
  // Coinbase's Greenhouse form — the 8 acknowledgement/consent fields that
  // application had no stored answer for.
  it("names the acknowledgement concepts from the Coinbase shadow run", () => {
    expect(
      conceptOf(
        "Please confirm receipt of the above linked Global Data Privacy Notice and US Arbitration Agreement.",
      ),
    ).toBe("privacy-notice-ack");
    expect(
      conceptOf(
        "I understand that Coinbase may use AI tools to assist in the application and interview process.",
      ),
    ).toBe("ai-use-disclosure");
    expect(
      conceptOf("Which of the following best describes how you use AI tools today?"),
    ).toBe("ai-usage-habits");
    expect(
      conceptOf(
        "I certify that the information provided in this application is true and correct to the best of my knowledge. I understand that any false statements or omissions may result in disqualification from employment consideration or, if employed, in termination.",
      ),
    ).toBe("certification-of-truthfulness");
    expect(
      conceptOf(
        "Are you a current government official or were you a government official in the last five years (e.g., employee of a government agency or a government owned/controlled company, holder of public office or a civil service position)?",
      ),
    ).toBe("government-official-status");
    expect(
      conceptOf(
        "Are you a close relative of a government official (i.e., child/step-child, spouse/partner, parent/guardian, aunt/uncle, first cousin, in-law)?",
      ),
    ).toBe("government-official-relative");
  });

  it("reads a lone arbitration mention as the arbitration concept, not privacy", () => {
    // Coinbase's field bundles both into one checkbox, which privacy-notice-ack
    // wins (tested above) — but an employer that asks for arbitration alone
    // must not be read as a privacy-notice question.
    expect(conceptOf("I have read and agree to the Arbitration Agreement.")).toBe(
      "arbitration-agreement-ack",
    );
  });

  it("does not read 'a government official's relative' as the official themselves", () => {
    // The literal phrase "government official" appears in both questions.
    // Without testing the relative pattern first, this would be misread as
    // the candidate claiming to BE the official — a materially different,
    // and wrong, answer.
    expect(
      conceptOf("Is a relative of yours currently serving as a government official?"),
    ).toBe("government-official-relative");
  });

  it("does not read the AI-usage survey as the AI-use disclosure, or the reverse", () => {
    // Both share the words "AI tools". "describes how you use" and "assist in
    // the application process" are what actually tell them apart.
    expect(conceptOf("How do you use AI tools in your day-to-day work?")).toBe(
      "ai-usage-habits",
    );
    expect(
      conceptOf("This employer may use AI tools to assist in the hiring process."),
    ).toBe("ai-use-disclosure");
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

  it("matches Coinbase's bundled privacy/arbitration field to the general privacy answer", () => {
    expect(
      sameQuestion(
        "Please confirm receipt of the above linked Global Data Privacy Notice and US Arbitration Agreement.",
        "I confirm that I have received and reviewed this company's data privacy notice.",
      ),
    ).toBe(true);
  });

  it("still matches an arbitration question naming a country in the document's own title", () => {
    // The document is called "US Arbitration Agreement" — the literal "US"
    // would otherwise be read by scopeMarkers as a work-country scope and
    // refuse a match against the unscoped stored version, the same failure
    // scope-checking exists to prevent, just triggered by a false positive.
    // Only work-authorization and sponsorship are scope-sensitive; this
    // concept is not, so the stray "US" must not block the match.
    expect(
      sameQuestion(
        "I agree to the US Arbitration Agreement.",
        "I have read and agree to this company's arbitration agreement.",
      ),
    ).toBe(true);
  });

  it("does not let a privacy-notice acknowledgement match an arbitration-agreement question", () => {
    // The two are stored as separate answers (spec: don't over-collapse).
    // A person may accept a privacy notice without having read or agreed to
    // arbitrate disputes — conflating them would misrepresent a real consent.
    expect(
      sameQuestion(
        "I acknowledge the company's Privacy Notice.",
        "I have read and agree to this company's arbitration agreement.",
      ),
    ).toBe(false);
  });

  it("does not let a work-authorization question match the AI-in-hiring disclosure", () => {
    // Precedent hazard: the existing work-authorization/sponsorship confusion
    // proved two "yes/no legal-sounding" questions can collide if the matcher
    // is loose. Same shape of risk here, different pair.
    expect(
      sameQuestion(
        "Are you legally authorized to work in the United States?",
        "I understand that this employer may use AI tools to assist in the application and interview process.",
      ),
    ).toBe(false);
  });

  it("does not let the government-official question match the close-relative question", () => {
    // Same hazard as work-authorization vs sponsorship: both are legal
    // yes/no questions sharing most of their vocabulary ("government
    // official"), but "are you one" and "are you related to one" have
    // different, non-interchangeable answers.
    expect(
      sameQuestion(
        "Are you a current government official or were you a government official in the last five years?",
        "Are you a close relative of a government official (i.e., child/step-child, spouse/partner, parent/guardian, aunt/uncle, first cousin, in-law)?",
      ),
    ).toBe(false);
  });

  it("does not let the AI-usage survey match the AI-in-hiring disclosure", () => {
    // Both mention "AI tools"; only one is a statement about the candidate's
    // own habits and only the other is an acknowledgement about the employer.
    // Answering one with the stored answer for the other would submit the
    // wrong claim.
    expect(
      sameQuestion(
        "Which of the following best describes how you use AI tools today?",
        "I understand that this employer may use AI tools to assist in the application and interview process.",
      ),
    ).toBe(false);
  });

  it("does not let the certification match a nearby eligibility question", () => {
    expect(
      sameQuestion(
        "I certify that the information provided in this application is true and correct to the best of my knowledge.",
        "Have you ever been convicted of a felony?",
      ),
    ).toBe(false);
  });
});
