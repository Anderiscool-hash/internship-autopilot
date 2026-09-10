/**
 * Application confidence (spec §17).
 *
 * Deliberately separate from job fit, as the spec insists. Fit asks "is this a
 * good job for you?"; confidence asks "how sure is the bot that it filled this
 * form in correctly?" A 94% match to a form the parser only half understood is
 * not something to submit, and collapsing the two numbers would hide exactly
 * that case.
 *
 * Spec §17's weights, used as given:
 *
 *   Known standard fields    30%
 *   Legal/profile answers    20%
 *   Form parsing             20%
 *   Custom question answers  15%
 *   Document readiness       10%
 *   Submission reliability    5%
 *
 * Pure arithmetic over a parsed form. Nothing here touches a browser.
 */

/** Spec §17's weights, as fractions. */
export const CONFIDENCE_WEIGHTS = {
  standardFields: 0.3,
  legalAnswers: 0.2,
  formParsing: 0.2,
  customAnswers: 0.15,
  documents: 0.1,
  submission: 0.05,
} as const;

export type ConfidenceComponentName = keyof typeof CONFIDENCE_WEIGHTS;

/** What the form asks for, once parsed. */
export interface ParsedForm {
  /** Every field the parser found. */
  fields: ParsedField[];
  /** Fields the parser saw but could not classify — the honest unknown count. */
  unrecognizedFields: number;
  /** A CAPTCHA was present. Spec §22: pause, never work around. */
  captcha: boolean;
  /** The form required a login before it could be read. */
  loginRequired: boolean;
  /** Whether a resume upload is required. */
  resumeRequired: boolean;
  /** Whether a cover letter upload is required. */
  coverLetterRequired: boolean;
}

/** One field on an application form. */
export interface ParsedField {
  label: string;
  /** Broad kind, as far as the parser could tell. */
  kind: "standard" | "legal" | "custom" | "file" | "unknown";
  required: boolean;
  /** True when the profile or answer bank already has a value for it. */
  answered: boolean;
}

/** What the candidate has ready to submit. */
export interface MaterialsState {
  resumeReady: boolean;
  coverLetterReady: boolean;
}

/** One weighted component of the confidence score. */
export interface ConfidenceComponent {
  name: ConfidenceComponentName;
  score: number;
  detail: string;
}

export interface ConfidenceResult {
  /** 0-100. */
  score: number;
  components: ConfidenceComponent[];
  /** Required fields with no answer — spec §16 says these must pause the run. */
  unanswered: string[];
  /**
   * Reasons the score is a hard zero rather than an average.
   *
   * Empty on a normal scoring run. Non-empty means the form could not be
   * understood at all, and no amount of the other components can compensate.
   */
  blockers: string[];
}

/**
 * How reliable submission is on this ATS (spec §17's last 5%, and §21's
 * adapter trust levels).
 *
 * These are judgments about adapters, not measurements — and until an apply
 * worker exists and has actually submitted anything, they cannot be anything
 * else. Written down here so they are visible and arguable rather than
 * buried in a score.
 */
export const SUBMISSION_RELIABILITY: Record<string, number> = {
  GREENHOUSE: 0.9,
  LEVER: 0.8,
  ASHBY: 0.7,
};

/** Fraction of a list that satisfies a predicate; 1 for an empty list. */
function fraction(total: number, satisfied: number): number {
  return total === 0 ? 1 : satisfied / total;
}

/**
 * Score how confident we are that this form can be filled in correctly.
 *
 * A CAPTCHA or a login wall scores zero outright rather than being folded into
 * an average: both mean the run cannot proceed unattended at all (spec §22),
 * and a 70% on a form behind a login would be a number that invites a bad
 * decision.
 */
export function scoreConfidence(
  form: ParsedForm,
  materials: MaterialsState,
  atsType: string,
): ConfidenceResult {
  const unanswered = form.fields
    .filter((field) => field.required && !field.answered && field.kind !== "file")
    .map((field) => field.label);

  // Hard zeroes, not low averages. Each of these means the run cannot proceed
  // unattended, and a partial score would be a number that invites someone to
  // press submit anyway.
  const blockers: string[] = [];
  if (form.captcha) blockers.push("A CAPTCHA is present (spec §22: pause, never solve).");
  if (form.loginRequired) blockers.push("The form is behind a login.");
  // An application form with no fields is not a form we understood — it is a
  // read that failed. Scoring it 100% ("nothing was missing!") is the single
  // most dangerous thing this function could do, because every other signal
  // would agree with it.
  if (form.fields.length === 0) {
    blockers.push("No form fields were found — the page did not parse as an application form.");
  }

  if (blockers.length > 0) {
    return { score: 0, components: [], unanswered, blockers };
  }

  const standard = form.fields.filter((field) => field.kind === "standard");
  const legal = form.fields.filter((field) => field.kind === "legal");
  const custom = form.fields.filter((field) => field.kind === "custom");

  const components: ConfidenceComponent[] = [
    {
      name: "standardFields",
      score: fraction(standard.length, standard.filter((f) => f.answered).length),
      detail: `${standard.filter((f) => f.answered).length}/${standard.length} standard fields have a value.`,
    },
    {
      name: "legalAnswers",
      score: fraction(legal.length, legal.filter((f) => f.answered).length),
      detail: `${legal.filter((f) => f.answered).length}/${legal.length} legal/eligibility questions answered.`,
    },
    {
      name: "formParsing",
      // How much of the form we actually understood. Unrecognized fields are
      // counted against us: a field nobody classified is a field nobody can
      // fill in correctly.
      score: fraction(
        form.fields.length + form.unrecognizedFields,
        form.fields.filter((field) => field.kind !== "unknown").length,
      ),
      detail: `${form.unrecognizedFields} field${form.unrecognizedFields === 1 ? "" : "s"} the parser could not classify.`,
    },
    {
      name: "customAnswers",
      score: fraction(custom.length, custom.filter((f) => f.answered).length),
      detail: `${custom.filter((f) => f.answered).length}/${custom.length} custom questions have a stored answer.`,
    },
    {
      name: "documents",
      score: documentsScore(form, materials),
      detail: documentsDetail(form, materials),
    },
    {
      name: "submission",
      score: SUBMISSION_RELIABILITY[atsType] ?? 0,
      detail:
        SUBMISSION_RELIABILITY[atsType] === undefined
          ? `No apply adapter exists for ${atsType}.`
          : `${atsType} adapter reliability.`,
    },
  ];

  const weighted = components.reduce(
    (sum, component) => sum + component.score * CONFIDENCE_WEIGHTS[component.name],
    0,
  );

  return { score: Math.round(weighted * 100), components, unanswered, blockers: [] };
}

/** Are the documents this form demands actually ready? */
function documentsScore(form: ParsedForm, materials: MaterialsState): number {
  const needed: boolean[] = [];
  if (form.resumeRequired) needed.push(materials.resumeReady);
  if (form.coverLetterRequired) needed.push(materials.coverLetterReady);
  return fraction(needed.length, needed.filter(Boolean).length);
}

function documentsDetail(form: ParsedForm, materials: MaterialsState): string {
  if (!form.resumeRequired && !form.coverLetterRequired) {
    return "No documents required.";
  }
  const parts: string[] = [];
  if (form.resumeRequired) {
    parts.push(materials.resumeReady ? "resume ready" : "resume MISSING");
  }
  if (form.coverLetterRequired) {
    parts.push(
      materials.coverLetterReady ? "cover letter ready" : "cover letter MISSING",
    );
  }
  return parts.join(", ") + ".";
}
