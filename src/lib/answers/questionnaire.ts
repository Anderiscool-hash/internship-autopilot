/**
 * The questions worth answering before you ever open an application.
 *
 * A live shadow run against a real Greenhouse form filled 19 of 36 fields and
 * left 16 for the person — almost all of them questions that every employer
 * asks in slightly different words. Answering them once, here, is what turns
 * that 19 into most of the form.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS UNDER
 *
 * Every question here is asked, never assumed. There is no default answer to
 * any of them — not to work authorization, not to sponsorship, not to the
 * demographic questions. A blank stays blank, and a blank means "nobody has
 * told this app", which is the one honest state an unanswered question has.
 *
 * The demographic block is voluntary in the legal sense: an employer must
 * offer "I don't wish to answer", and so does this. Skipping it costs nothing
 * and is a perfectly normal choice.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** How the answer is collected. */
export type QuestionInput = "text" | "long-text" | "choice";

/** Where a question sits on the page. */
export type QuestionGroup = "eligibility" | "logistics" | "about-you" | "demographic";

export interface QuestionnaireItem {
  /**
   * The question as it is STORED, which is what the matcher compares against.
   * Worded the way employers most often word it, so concept matching and word
   * overlap both have the best chance on a form we have not seen.
   */
  question: string;
  /** Shown to the person, when the stored wording reads oddly out of context. */
  label?: string;
  group: QuestionGroup;
  input: QuestionInput;
  /** For a choice question, the options an employer typically offers. */
  options?: string[];
  /**
   * A legal or eligibility claim. Never reworded downstream (spec §16),
   * because a paraphrase of "yes, I am authorized" is a different claim.
   */
  isLegal?: boolean;
  /** Why this is being asked, shown under the field. */
  hint?: string;
}

/** Yes/no, offered the way forms offer it. */
const YES_NO = ["Yes", "No"];

export const QUESTIONNAIRE: QuestionnaireItem[] = [
  // ── Eligibility ───────────────────────────────────────────────────────
  // These gate whether an application is worth making at all (spec §11), and
  // they are the ones it is most important never to guess.
  {
    question: "Are you legally authorized to work in the United States?",
    group: "eligibility",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint: "Asked by nearly every US employer, in many different wordings.",
  },
  {
    question:
      "Will you now or in the future require sponsorship for employment visa status?",
    group: "eligibility",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint: "Note the double negative some forms use — read the employer's wording before trusting this one.",
  },
  {
    question: "Are you at least 18 years of age?",
    group: "eligibility",
    input: "choice",
    options: YES_NO,
    isLegal: true,
  },
  {
    question: "Do you have or are you able to obtain a security clearance?",
    group: "eligibility",
    input: "choice",
    options: [...YES_NO, "I already hold one"],
    isLegal: true,
    hint: "Only asked for defence and government-adjacent roles. Leave blank if it never applies to you.",
  },
  {
    question: "Have you ever been convicted of a felony?",
    group: "eligibility",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint: "Illegal to ask before an offer in several states. Leave blank if you would rather answer it in context.",
  },
  {
    question: "Have you previously been employed by this company?",
    group: "eligibility",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint: "Stored as a general answer. If it is ever yes for one employer, change it on that form.",
  },

  // ── Logistics ─────────────────────────────────────────────────────────
  {
    question: "How did you hear about this job?",
    group: "logistics",
    input: "text",
    hint: "A dropdown on most forms — your answer is matched to whichever option is closest.",
  },
  {
    question: "What is your desired salary?",
    group: "logistics",
    input: "text",
    hint: "A number, a range, or \"negotiable\". Blank means the field is left for you.",
  },
  {
    question: "When are you available to start?",
    group: "logistics",
    input: "text",
  },
  {
    question: "What is your preferred work location?",
    group: "logistics",
    input: "text",
  },
  {
    question: "Are you willing to relocate?",
    group: "logistics",
    input: "choice",
    options: [...YES_NO, "Depends on the location"],
  },
  {
    question: "Are you comfortable working in a hybrid or on-site environment?",
    group: "logistics",
    input: "choice",
    options: [...YES_NO, "Remote only"],
  },
  {
    question: "Do you have any scheduling restrictions?",
    group: "logistics",
    input: "text",
  },

  // ── About you ─────────────────────────────────────────────────────────
  // The prose questions. These are the ones an AI provider could draft from
  // the Truth Ledger later (spec §14/§15) — until then they are yours to write.
  {
    question: "Why are you interested in this role?",
    group: "about-you",
    input: "long-text",
    hint: "Write it once, generally enough to travel. Anything naming one employer is not reused.",
  },
  {
    question: "Why do you want to work here?",
    group: "about-you",
    input: "long-text",
  },
  {
    question: "Describe a project you are proud of.",
    group: "about-you",
    input: "long-text",
  },
  {
    question: "What are your greatest strengths?",
    group: "about-you",
    input: "long-text",
  },
  {
    question: "Which programming languages do you have experience with?",
    group: "about-you",
    input: "text",
  },
  {
    question: "Do you have a portfolio or personal website?",
    group: "about-you",
    input: "text",
  },
  {
    question: "Is there anything else you would like us to know?",
    group: "about-you",
    input: "long-text",
  },

  // ── Voluntary demographic questions ───────────────────────────────────
  // Asked because leaving them blank means stopping on them mid-application.
  // Every one offers a decline option, because every employer must.
  {
    question: "What is your gender?",
    group: "demographic",
    input: "choice",
    options: ["Male", "Female", "Non-binary", "I don't wish to answer"],
  },
  {
    question: "What is your race or ethnicity?",
    group: "demographic",
    input: "choice",
    options: [
      "American Indian or Alaska Native",
      "Asian",
      "Black or African American",
      "Hispanic or Latino",
      "Native Hawaiian or Other Pacific Islander",
      "White",
      "Two or More Races",
      "I don't wish to answer",
    ],
  },
  {
    question: "Are you a protected veteran?",
    group: "demographic",
    input: "choice",
    options: [
      "I am not a protected veteran",
      "I identify as one or more of the classifications of a protected veteran",
      "I don't wish to answer",
    ],
  },
  {
    question: "Do you have a disability?",
    group: "demographic",
    input: "choice",
    options: [
      "No, I do not have a disability",
      "Yes, I have a disability, or have had one in the past",
      "I do not want to answer",
    ],
  },
];

/** Human headings and the reason each block exists. */
export const GROUP_META: Record<QuestionGroup, { title: string; blurb: string }> = {
  eligibility: {
    title: "Eligibility",
    blurb:
      "The questions that decide whether a job is worth applying to at all. Nothing here is ever assumed — a blank stays blank and stops the run rather than being guessed.",
  },
  logistics: {
    title: "Logistics",
    blurb: "Asked by most employers, and rarely different between them.",
  },
  "about-you": {
    title: "About you",
    blurb:
      "The written answers. Keep them general enough to travel between applications — anything naming one employer is used once and discarded.",
  },
  demographic: {
    title: "Voluntary self-identification",
    blurb:
      "Every employer must let you decline these, and so does this page. Leaving the whole block blank is a normal choice; it only means an application stops here for you to answer in person.",
  },
};

/** The groups, in the order they are shown. */
export const GROUP_ORDER: QuestionGroup[] = [
  "eligibility",
  "logistics",
  "about-you",
  "demographic",
];

/** A stable form field name for one question. */
export function fieldNameFor(index: number): string {
  return `q${index}`;
}
