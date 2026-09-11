/**
 * Deciding which questions to put to the candidate after the automatic pass.
 *
 * Shadow mode fills what it can from the profile and the answer bank. What is
 * left is, by definition, something nobody has ever told this app — so it asks,
 * and remembers the answer for next time. That is the whole loop: every
 * application teaches it one more thing, and the fifth application at the same
 * ATS should need almost nothing.
 *
 * Pure. Which fields to raise, in what order, with what wording — all decided
 * here and tested without a browser.
 */

import { conceptOf } from "../answers/concepts";
import type { FieldOutcome } from "./shadow-types";
import type { FillableField } from "./fill-plan";

/** One question to put to the person, with everything needed to fill it after. */
export interface AskItem {
  field: FillableField;
  /** The question as the employer worded it. */
  question: string;
  /** Why it is being asked, shown under the question. */
  reason: string;
  /** Options to choose from, when the control is a fixed list. */
  options: string[];
  /** Whether the form will not submit without it. */
  required: boolean;
}

/**
 * Which unfilled fields are worth a person's time.
 *
 * Required fields always. Optional ones are skipped: an application form has a
 * long tail of optional questions, and stopping on each one turns a two-minute
 * task into an interrogation. The point is to get the form submittable and
 * learn something durable, not to achieve a hundred percent fill rate.
 *
 * File uploads are never asked about — there is nothing to type, and the
 * person attaches the document themselves in the window.
 */
export function questionsToAsk(
  fields: FillableField[],
  outcomes: FieldOutcome[],
): AskItem[] {
  const byLabel = new Map(outcomes.map((outcome) => [outcome.label, outcome]));

  return fields
    .filter((field) => {
      const outcome = byLabel.get(field.label);
      if (!outcome) return false;
      if (outcome.status === "filled" || outcome.status === "chosen") return false;
      if (field.kind === "file" || field.inputType === "file") return false;
      if (field.kind === "unknown") return false;
      return field.required;
    })
    .map((field) => {
      const outcome = byLabel.get(field.label);
      return {
        field,
        question: field.label,
        reason:
          outcome?.status === "failed"
            ? (outcome.detail ?? "")
            : "Nothing in your profile or saved answers covers this.",
        options: field.options,
        required: field.required,
      };
    });
}

/**
 * Should this answer be kept for future applications?
 *
 * Most should: "are you at least 18", "how did you hear about us" and the rest
 * are asked by everyone, and answering them once is the point of the exercise.
 *
 * Two kinds are not worth storing, because reusing them would be wrong rather
 * than merely useless:
 *
 *   - anything naming this employer ("Have you worked at Coinbase before?"),
 *     which has a different answer at the next company
 *   - one-off details of this specific application ("Which team?", "Start date
 *     for this role")
 *
 * Storing those would quietly put last week's answer on this week's form,
 * which is the failure this whole codebase is built to avoid.
 */
export function worthStoring(question: string, companyName: string): boolean {
  const text = question.toLowerCase();
  const company = companyName.toLowerCase().trim();

  // Names this employer: the answer is about them, not about the candidate.
  // "No" to "have you worked at Coinbase before" says nothing about Stripe.
  if (company.length > 2 && text.includes(company)) return false;

  // One of the standard questions every form asks. These are the whole point
  // of a saved answer, and a phrase like "this job" inside one of them — "how
  // did you hear about this job?" — is just how the question is worded, not a
  // sign that the answer is single-use.
  if (conceptOf(question) !== null) return true;

  // Otherwise wording tied to this specific posting means a single-use answer.
  if (/\bthis (role|position|job|team|opening)\b/.test(text)) {
    // Except the reusable prose ones: "why are you interested in this role?"
    // is asked everywhere and a candidate's answer usually travels.
    return /\bwhy\b|\binterest/.test(text);
  }

  return true;
}
