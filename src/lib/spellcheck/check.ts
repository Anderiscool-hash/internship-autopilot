/**
 * Finding probable typos in the candidate's own stored text.
 *
 * ============================================================================
 * THIS MODULE NEVER CHANGES THE TEXT. It returns suggestions and nothing else.
 * ============================================================================
 *
 * That is a rule, not an implementation detail. Everything the candidate typed
 * is a candidate fact, and this codebase does not let software invent or alter
 * candidate facts - the resume autofill goes out of its way to present
 * *reviewable suggestions with evidence* and to let a stored value always beat
 * a guessed one (see src/lib/resume/suggestions.ts). "Correcting" a spelling
 * on the way into an employer's form would be the same mistake wearing a
 * friendlier hat: the person would never see it happen, and the checker is
 * sometimes wrong. So: suggestions out, no mutation, a human decides.
 *
 * Why this exists at all: a live shadow run typed "Computer Science & Cyber
 * Secuirty" and "108 autum ave" from the stored profile straight onto a real
 * Greenhouse application. Those went to an employer. A report that catches
 * them before the next run is worth a lot; a silent auto-fix is worth nothing,
 * because the candidate would never learn their profile is wrong.
 *
 * How it decides (deliberately timid):
 *   - only words of 4+ letters are examined,
 *   - anything that smells like code, a URL, an email, a path or an acronym is
 *     skipped untouched,
 *   - a word is flagged ONLY when one dictionary word is closest to it. Two
 *     words tied for closest means silence. An ambiguous suggestion is worse
 *     than no suggestion: it invites a wrong "fix" and it trains the reader to
 *     ignore the report.
 */

import { CANONICAL, DICTIONARY, canonicalSpelling } from "./dictionary";

/** One probable typo, and what it is probably meant to be. */
export interface SpellSuggestion {
  /** The word exactly as it appears in the text, original casing kept. */
  word: string;
  /** The dictionary spelling, cased the way it should be written. */
  suggestion: string;
  /** Index of the first character of `word` in the text that was checked. */
  offset: number;
}

/** Words shorter than this are never examined. See the header. */
const MIN_WORD_LENGTH = 4;

/**
 * A word this long or longer is allowed a distance-2 suggestion.
 *
 * JUDGMENT CALL: short words sit one edit away from each other constantly
 * ("form"/"from"/"farm"), so for them only a single edit counts. Long words
 * are the opposite - two edits still leave them nearly unique - and the real
 * typos that prompted this file are long ("Secuirty", "Kurbenetes"). Note
 * that the ambiguity rule does the heavy lifting either way: a wider radius
 * mostly produces *more ties*, and ties produce silence.
 */
const LONG_WORD_LENGTH = 8;

/**
 * Edit distance that counts a swap of two neighbouring letters as ONE edit.
 *
 * This is the whole reason the checker works on the real data. "Secuirty" is
 * "Security" with the `i` and `r` swapped - the single most common way a fast
 * typist misspells a word. Plain Levenshtein has to describe that swap as two
 * separate substitutions, scoring it 2, so at a distance-1 threshold it would
 * be missed entirely. Counting the transposition as one edit finds it.
 *
 * This is the "optimal string alignment" variant: each pair of letters may be
 * swapped at most once, and a swapped pair cannot then be edited again. That
 * is enough for typing mistakes and it is much easier to read than the full
 * Damerau algorithm.
 *
 * Worked example, "ab" vs "ba": plain Levenshtein says 2, this says 1.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;

  // One flat array instead of an array-of-arrays: the same grid, but with no
  // nested indexing to get wrong. Cell (i, j) = distance between the first i
  // letters of `a` and the first j letters of `b`.
  const grid = new Array<number>(rows * cols).fill(0);
  const at = (i: number, j: number): number => grid[i * cols + j] ?? 0;
  const put = (i: number, j: number, value: number): void => {
    grid[i * cols + j] = value;
  };

  // Turning "" into the first i letters of `a` costs i deletions, and the
  // mirror for `b`. That is the edge of the grid.
  for (let i = 0; i < rows; i += 1) put(i, 0, i);
  for (let j = 0; j < cols; j += 1) put(0, j, j);

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const sameLetter = a[i - 1] === b[j - 1];
      const substitutionCost = sameLetter ? 0 : 1;

      let best = Math.min(
        at(i - 1, j) + 1, // delete a letter from `a`
        at(i, j - 1) + 1, // insert a letter from `b`
        at(i - 1, j - 1) + substitutionCost, // replace (or keep) a letter
      );

      // The transposition case: the last two letters are each other's, the
      // wrong way round. One edit, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }

      put(i, j, best);
    }
  }

  return at(a.length, b.length);
}

/**
 * Endings the checker strips before deciding a word is unknown.
 *
 * JUDGMENT CALL: without this, "skills" would be reported as a typo of
 * "skill" - a confident, wrong, and very annoying suggestion, repeated for
 * every plural and every past tense in the profile. Rather than listing every
 * inflected form in the dictionary (hundreds of entries, all of them a chance
 * to introduce a near-collision), the checker just understands a handful of
 * ordinary English endings.
 */
const SUFFIXES: readonly string[] = [
  "s", "es", "ies", "ed", "ing", "ly", "er", "ers", "est", "ions", "ion",
];

/**
 * Is this word one the checker already accepts?
 *
 * True when it is in the dictionary outright, or when it is a plain
 * inflection of a dictionary word ("networks", "deployed", "monitoring").
 */
export function isKnownWord(word: string): boolean {
  const lower = word.toLowerCase();
  if (DICTIONARY.has(lower)) return true;

  for (const suffix of SUFFIXES) {
    if (!lower.endsWith(suffix) || lower.length <= suffix.length + 2) continue;
    const stem = lower.slice(0, lower.length - suffix.length);

    // "networks" -> "network"
    if (DICTIONARY.has(stem)) return true;
    // "coding" -> "cod" -> "code": an `e` dropped before the ending
    if (DICTIONARY.has(`${stem}e`)) return true;
    // "technologies" -> "technology"
    if (DICTIONARY.has(`${stem}y`)) return true;
    // "planned" -> "plan": a doubled final consonant before the ending
    if (stem.length > 1 && stem.at(-1) === stem.at(-2) && DICTIONARY.has(stem.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

/**
 * Should this whitespace-delimited chunk of text be left completely alone?
 *
 * Everything here is a place where a "misspelling" is almost certainly not a
 * misspelling: identifiers, acronyms, links and file paths. The checker would
 * rather miss a real typo inside one of these than tell the candidate their
 * GitHub URL is spelled wrong.
 */
function shouldSkipToken(token: string): boolean {
  // Anything with a digit: version numbers, house numbers, dates, "SOC2".
  if (/\d/.test(token)) return true;

  // Emails, links, and file paths of either slash persuasion.
  if (token.includes("@")) return true;
  if (token.includes("/") || token.includes("\\")) return true;
  if (/^(https?:|www\.)/i.test(token)) return true;

  // snake_case, kebab_case-ish identifiers, and anything with code punctuation.
  if (token.includes("_")) return true;

  // camelCase / PascalCase with an internal capital: "getUserName", "IAmAWord".
  // These are code, and code is the one place guessing is most likely wrong.
  // Note this also protects real product names like "JavaScript" from ever
  // being second-guessed, which is fine - they are in the dictionary anyway.
  if (/[a-z][A-Z]/.test(token)) return true;

  // ALLCAPS acronyms: AWS, SIEM, OSINT, CCNA. An unknown acronym is normal.
  const lettersOnly = token.replace(/[^A-Za-z]/g, "");
  if (lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase()) return true;

  return false;
}

/**
 * Restore sensible casing on a suggestion.
 *
 * The dictionary is the authority whenever it carries deliberate casing
 * ("Kubernetes", "PostgreSQL") - that casing is exactly what a suggestion is
 * for. For ordinary lowercase entries, the shape of the original word wins,
 * so "Secuirty" at the start of a phrase suggests "Security" and not a
 * lowercase word the candidate would have to re-capitalise by hand.
 */
function applyCasing(original: string, canonical: string): string {
  const dictionaryHasOpinion = canonical !== canonical.toLowerCase();
  if (dictionaryHasOpinion) return canonical;

  const first = original[0] ?? "";
  const startsUpper = first === first.toUpperCase() && first !== first.toLowerCase();
  if (startsUpper) return (canonical[0] ?? "").toUpperCase() + canonical.slice(1);

  return canonical;
}

/**
 * The one dictionary word closest to `word`, or null when that is not clear.
 *
 * Null covers three situations on purpose - nothing was close, two things
 * were equally close, or the word is fine as it is - because all three mean
 * "say nothing".
 *
 * The rule is: look only at dictionary words within the threshold, then take
 * the CLOSEST one, and stay silent if two are tied for closest.
 *
 * JUDGMENT CALL, and the live data decided it. The candidate's answer bank
 * contains "No prefrence". Within the distance-2 radius that a 9-letter word
 * gets, two dictionary words qualify: "preference" (one edit) and "reference"
 * (two edits). Refusing to answer whenever a second word is anywhere in the
 * radius would throw away a real, obvious typo because of a word that is
 * plainly further away. A genuine tie - two words at the SAME distance - is a
 * different thing, and that still produces silence, because there is no way
 * to pick between them and a coin-flip suggestion is worse than none.
 */
function findClosestSuggestion(word: string): string | null {
  const lower = word.toLowerCase();
  const threshold = lower.length >= LONG_WORD_LENGTH ? 2 : 1;

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tiedForBest = false;

  for (const entry of DICTIONARY) {
    // Cheap rejection first: two words whose lengths differ by more than the
    // threshold cannot possibly be within it, and this skips most of the list.
    if (Math.abs(entry.length - lower.length) > threshold) continue;

    const distance = damerauLevenshtein(lower, entry);
    if (distance > threshold) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
      tiedForBest = false;
    } else if (distance === bestDistance) {
      tiedForBest = true;
    }
  }

  if (best === null || tiedForBest) return null;
  return applyCasing(word, canonicalSpelling(best));
}

/**
 * Report the probable typos in a piece of text.
 *
 * The input is never modified - this function has no way to modify it and no
 * caller is given one. Offsets are into the string exactly as passed in, so a
 * reviewer can be shown the word in its original surroundings.
 */
export function checkText(text: string): SpellSuggestion[] {
  const found: SpellSuggestion[] = [];
  if (text.length === 0) return found;

  // Step one: walk whole whitespace-delimited chunks, because the decision
  // "this is a URL / a path / an identifier" can only be made on the whole
  // chunk. Splitting into letters first would turn "github.com/ander" into
  // two innocent-looking words.
  const tokenPattern = /\S+/g;
  let token: RegExpExecArray | null;

  while ((token = tokenPattern.exec(text)) !== null) {
    const chunk = token[0];
    if (shouldSkipToken(chunk)) continue;

    // Step two: inside a surviving chunk, look at runs of letters only. This
    // drops surrounding punctuation ("Security," -> "Security") and splits
    // hyphenated pairs ("cyber-security" -> "cyber", "security"), both of
    // which are words in their own right.
    const wordPattern = /[A-Za-z]+/g;
    let piece: RegExpExecArray | null;

    while ((piece = wordPattern.exec(chunk)) !== null) {
      const word = piece[0];
      if (word.length < MIN_WORD_LENGTH) continue;
      if (isKnownWord(word)) continue;

      const suggestion = findClosestSuggestion(word);
      if (suggestion === null) continue;
      // A "suggestion" identical to the word itself is not worth printing.
      if (suggestion === word) continue;

      found.push({ word, suggestion, offset: token.index + piece.index });
    }
  }

  return found;
}

// ===========================================================================
// THE MODEL SEAM - shape only, nothing wired up
// ===========================================================================
//
// The curated dictionary in dictionary.ts can only catch a typo in a word it
// already knows. It will never catch "I am very intrested in this oppurtunity
// becuase..." unless every one of those words happens to be listed, and it
// will never catch a real word used wrongly ("their" for "there"), because
// both are spelled correctly. General prose is exactly what a language model
// is good at and exactly what a word list is bad at.
//
// The user is setting up a LOCAL model on a separate always-on machine and
// will point /settings/ai at it later. When that exists, a second pass could
// be added behind this shape. The provider abstraction it would use already
// exists: `getProvider(db)` in src/lib/ai returns an `AiProvider | null`, and
// `extractJsonObject` / `readString` in src/lib/ai/json.ts already know how to
// get a structured answer back out of a chatty local model. Nothing is
// imported from there yet, because nothing here calls it yet.
//
// TODO (when the local model is reachable): implement a function of this
// shape, keep `checkText` exactly as it is, and merge the two result lists.
//
//   type ModelProsePass = (
//     text: string,
//     source: SpellCheckSource,
//   ) => Promise<SpellSuggestion[]>;
//
// What the model pass WOULD add:
//   - misspellings of ordinary words that are not in the curated list,
//   - real-word confusions the edit distance cannot see (their/there,
//     you're/your, complement/compliment),
//   - obviously duplicated or missing words in a long free-text answer.
//
// What it MUST NOT be allowed to do - these are hard limits, not preferences:
//   - never rewrite a legal or EEO answer (work authorization, sponsorship,
//     citizenship, clearance, veteran or disability status). A model that
//     "tidies" one of those has changed a legal declaration the candidate
//     signed. `AnswerBankEntry.isLegal` already marks these rows.
//   - never touch names, dates, email addresses, phone numbers or street
//     numbers. A "corrected" name or graduation date is a fabricated fact.
//   - never auto-apply anything. Output stays a suggestion with the original
//     text beside it, reviewed by a human, exactly like this module's output.
//   - never rewrite a whole sentence. One word at a time, with an offset, or
//     it cannot be reviewed - and an unreviewable suggestion gets rubber
//     stamped, which is the failure this design exists to prevent.
//
// ===========================================================================

/** Where a piece of checked text came from. Used by the report script. */
export type SpellCheckSource =
  | "address"
  | "school"
  | "degree"
  | "skill"
  | "certification"
  | "desiredRole"
  | "answerBank"
  | "truthFact";

/**
 * Fields a future model pass must never be allowed to rewrite.
 *
 * Kept next to the seam above so the rule travels with the code rather than
 * living only in a comment someone can miss. The report script prints this so
 * the limit is visible to whoever reads the output, too.
 */
export const MODEL_NEVER_REWRITE: readonly string[] = [
  "the candidate's name",
  "legal and EEO answers (work authorization, sponsorship, citizenship, clearance, veteran and disability status)",
  "dates of any kind, including graduation dates",
  "email addresses, phone numbers and street numbers",
];
