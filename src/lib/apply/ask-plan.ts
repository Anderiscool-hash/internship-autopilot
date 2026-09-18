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

import { ambiguousLabelReason, looksLikeFieldId } from "../answers/ambiguous-labels";
import { conceptOf } from "../answers/concepts";
import { findAnswer, SUGGESTED_QUESTIONS, type AnswerEntry } from "../answers/match";
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
 * Four kinds are not worth storing, because reusing them would be wrong
 * rather than merely useless:
 *
 *   - anything naming this employer ("Have you worked at Coinbase before?"),
 *     which has a different answer at the next company
 *   - one-off details of this specific application ("Which team?", "Start date
 *     for this role")
 *   - a label proven to be reused with a different meaning in different
 *     sections of a form (see ../answers/ambiguous-labels.ts)
 *   - a "question" that is really the form's own field id, because the form
 *     had no readable label to read (same file)
 *
 * Storing those would quietly put last week's answer on this week's form,
 * which is the failure this whole codebase is built to avoid.
 */
export function worthStoring(question: string, companyName: string): boolean {
  const text = question.toLowerCase();
  const company = companyName.toLowerCase().trim();

  // Not a question at all — the form gave no readable label, so what reached
  // here is the input's `name` attribute: `cards[026d7ce7-…][field0]`. Unlike
  // the cases below, this one is not a risk of a *wrong* answer; it is a row
  // that can never be a right one. Matching keys on question text, and those
  // ids are regenerated per form, so the next form's version of this same
  // field carries a different id and the stored row can never match again.
  // It would also be shown to the person on /answers exactly as written,
  // asking them `cards[026d7ce7-…][field0]` as if that were a question. A row
  // that cannot pay off and can only confuse is not worth writing — see
  // looksLikeFieldId for what it does and does not catch.
  if (looksLikeFieldId(question)) return false;

  // A label already proven to collide across sections ("Start date month"
  // meaning an employment date on one employer's form and an education date
  // on another's — see ambiguousLabelReason's own evidence). buildFillPlan
  // refuses to ever reuse an answer-bank entry under one of these labels, so
  // storing it here cannot recreate the original corruption at the point
  // where a value gets typed onto a form — that path is already closed.
  // But it is refused anyway, on purpose: this app has exactly one place to
  // put an answer, `AnswerBankEntry.question`, with no column for which
  // section it came from. A row saved here would silently mix an employment
  // date and an education date under one flat key — the exact shape of the
  // stored data that caused the real corruption this file's whole design is
  // reacting to (see the findings doc's "concrete failure": a person read
  // that flat row and reasonably assumed it meant one specific thing, and
  // was wrong). Leaving the row unwritten means the person retypes this
  // question on every application until section-scoped storage exists (the
  // findings doc's proposed next step) — a real, ongoing annoyance, but a
  // misleading row in a system nothing can safely interpret is worse than an
  // honest gap.
  if (ambiguousLabelReason(question) !== null) return false;

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

/** A standard question with no answer stored under any wording. */
export interface UnansweredSuggestion {
  question: string;
  /** Legal/eligibility answers, which are never paraphrased. */
  isLegal: boolean;
}

/**
 * Which of the standard questions would still stop an apply run.
 *
 * Lives here rather than on the page because "will this run stop and ask?" is
 * an ask-plan question, and because the answer must be computed the SAME way
 * the run computes it. The rule is `findAnswer` — the matcher the autofill
 * itself uses — and nothing else.
 *
 * WHY NOT EXACT TEXT: the obvious version of this ("is this exact sentence a
 * key in the bank?") disagrees with the rest of the app. Most stored answers
 * were captured mid-application under the employer's own wording, so
 * "Are you authorized to work in the US?" is really sitting in the bank as
 * "Are you legally authorized to work in the United States?". Exact matching
 * calls that unanswered; `findAnswer` — and therefore the actual apply run —
 * does not. Listing it as missing would be telling the person to do work that
 * changes nothing, and contradicting the same page's own display of their
 * answer a few inches higher up.
 *
 * So: differently worded but covered is NOT missing. Missing means the run
 * really will stop.
 */
export function unansweredSuggestions(entries: AnswerEntry[]): UnansweredSuggestion[] {
  return SUGGESTED_QUESTIONS.filter((suggestion) => {
    const match = findAnswer(suggestion.question, entries);
    // A match to a row holding an empty answer is not an answer. Nothing
    // should be able to store one, but a blank here would fill a form with
    // nothing rather than pausing, so it is checked rather than assumed.
    return match === null || match.entry.answer.trim().length === 0;
  });
}
