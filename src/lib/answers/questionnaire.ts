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
export type QuestionGroup =
  | "eligibility"
  | "acknowledgements"
  | "logistics"
  | "about-you"
  | "demographic";

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
  {
    question:
      "Are you a current government official, or have you been a government official within the last five years (for example, an employee of a government agency or government-owned company, a holder of public office, or a civil service position)?",
    group: "eligibility",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint:
      "A standard anti-corruption screening question used by regulated employers (banks, government contractors, and similar). Rare, but genuinely the same question everywhere it appears.",
  },
  {
    question:
      "Are you a close relative of a government official (for example: child or step-child, spouse or partner, parent or guardian, aunt or uncle, first cousin, or in-law)?",
    group: "eligibility",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint: "Paired with the question above and asked by the same category of employer.",
  },

  // ── Acknowledgements & consents ──────────────────────────────────────
  // The checkbox questions a form makes you tick before it lets you submit.
  // Worded generally on purpose — an employer's own privacy notice, AI-use
  // notice, or certification text is specific to them, but the fact of being
  // asked to acknowledge one is not. See concepts.ts for how a compound field
  // like Coinbase's ("the above linked Global Data Privacy Notice and US
  // Arbitration Agreement") resolves to one of these.
  {
    question:
      "I confirm that I have received and reviewed this company's data privacy notice.",
    group: "acknowledgements",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint: "Asked by nearly every employer now, in some wording, before a form will submit.",
  },
  {
    question: "I have read and agree to this company's arbitration agreement.",
    group: "acknowledgements",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint:
      "A binding legal agreement, not just an acknowledgement, and its actual terms differ by employer. Leave blank if you would rather read each one before agreeing.",
  },
  {
    question:
      "I understand that this employer may use AI tools to assist in the application and interview process.",
    group: "acknowledgements",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint: "An acknowledgement that the employer may use AI, not a statement about how you use it — that's the next question.",
  },
  {
    question:
      "Which of the following best describes how you use AI tools in your work today?",
    group: "acknowledgements",
    input: "choice",
    options: [
      "I do not currently use AI tools",
      "I use AI tools occasionally, for specific tasks",
      "I use AI tools regularly, as part of my normal workflow",
      "I use AI tools extensively; they are central to how I work",
      "I don't wish to answer",
    ],
    hint: "Increasingly asked as part of an employer's AI-in-hiring disclosure. A self-report, not a legal claim.",
  },
  {
    question:
      "I certify that the information I have provided in this application is true and correct to the best of my knowledge, and I understand that false statements or omissions may affect my candidacy or employment.",
    group: "acknowledgements",
    input: "choice",
    options: YES_NO,
    isLegal: true,
    hint:
      "A claim about the application you are actually submitting, not a blanket promise — only store \"yes\" if you intend to keep every application accurate, since a stored answer here is replayed automatically.",
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
  acknowledgements: {
    title: "Acknowledgements & consents",
    blurb:
      "The checkbox questions a form makes you tick before it lets you submit — privacy notices, arbitration agreements, AI-use disclosures, and the like. Worded generally so one answer covers every employer's version.",
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
  "acknowledgements",
  "logistics",
  "about-you",
  "demographic",
];

/** A stable form field name for one question. */
export function fieldNameFor(index: number): string {
  return `q${index}`;
}
