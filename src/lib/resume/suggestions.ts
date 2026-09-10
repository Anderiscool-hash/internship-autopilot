/**
 * Deciding what actually goes in a profile field: the stored value, or a
 * suggestion read from an uploaded resume.
 *
 * One rule, and it only looks trivial: **a value the user already has always
 * wins**. Autofill must never overwrite something a person typed with
 * something a parser guessed.
 *
 * This lives in its own file, with tests, because getting it wrong is silent.
 * The first version used `defaultValue ?? suggestion.value`, which is correct
 * for every field whose empty state is `null` — and wrong for the one field
 * whose empty state is the empty string (the graduation date, which is
 * formatted for `<input type="month">` before it reaches the form). `??` only
 * falls through on null and undefined, so `""` counted as a real value and the
 * suggestion was dropped. It failed for exactly one field out of eleven, which
 * is precisely the kind of bug that ships.
 */

/** A value read from a resume, awaiting review. */
export interface Suggested<T> {
  value: T;
  /** The line of the resume it came from, or which model proposed it. */
  evidence: string;
  source: "pattern" | "ai";
}

/** Is this stored value actually absent? Null, undefined and blank all count. */
function isEmpty(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

/** What a text field should show, and whether that came from the resume. */
export function chooseFieldValue(
  stored: string | number | null | undefined,
  suggestion: Suggested<string> | undefined,
): { value: string; fromSuggestion: boolean } {
  if (!isEmpty(stored)) {
    return { value: String(stored), fromSuggestion: false };
  }
  if (suggestion) {
    return { value: suggestion.value, fromSuggestion: true };
  }
  return { value: "", fromSuggestion: false };
}

/** The same decision for a multi-value field. */
export function chooseListValue(
  stored: string[],
  suggestion: Suggested<string[]> | undefined,
): { values: string[]; fromSuggestion: boolean } {
  if (stored.length > 0) return { values: stored, fromSuggestion: false };
  if (suggestion) return { values: suggestion.value, fromSuggestion: true };
  return { values: [], fromSuggestion: false };
}
