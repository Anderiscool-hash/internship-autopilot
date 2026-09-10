/**
 * Matching an application form's question to an answer you have already given
 * (spec §16).
 *
 * The rule that governs this file is the last line of spec §16: "unknown
 * answers should pause automation rather than being invented." So matching is
 * deliberately conservative. A question that does not clearly correspond to a
 * stored answer returns null, the autofill worker stops, and a person decides.
 * The failure mode of a loose matcher here is not a wasted minute — it is a
 * wrong answer submitted to a real employer under the candidate's name.
 *
 * Pure functions; the stored entries are passed in.
 */

/** The stored answer, as much of it as matching needs. */
export interface AnswerEntry {
  id: string;
  question: string;
  answer: string;
  /** Legal/eligibility answers, which are never paraphrased (spec §16). */
  isLegal: boolean;
}

/** A question matched to an answer, with how sure the match is. */
export interface AnswerMatch {
  entry: AnswerEntry;
  /** 0-1. How closely the asked question matches the stored one. */
  score: number;
  /** True when the two questions are the same once normalized. */
  exact: boolean;
}

/**
 * How close a match has to be before it counts.
 *
 * Set high on purpose. At 0.6 you get "Why are you interested in this role?"
 * matching "Why are you interested in working remotely?" — questions sharing
 * most of their words and none of their meaning. Pausing for a person is
 * cheap; a confidently wrong answer on a real application is not.
 */
export const MATCH_THRESHOLD = 0.8;

/** Words that carry no meaning when comparing two questions. */
const STOP_WORDS = new Set([
  "a", "an", "the", "of", "for", "in", "on", "at", "to", "with", "and", "or",
  "is", "are", "do", "does", "did", "you", "your", "yours", "please", "we",
  "this", "that", "these", "those", "be", "been", "can", "could",
  "would", "will", "if", "any", "have", "has", "it", "our",
]);

// Note what is NOT in that list: "us". It reads like the pronoun, but in an
// application form it is nearly always the country — "authorized to work in
// the US" — and dropping it makes that question indistinguishable from
// "authorized to work", which is a different question with a different answer.

/**
 * Reduce a question to comparable words.
 *
 * Punctuation, casing and the trailing question mark all vary between ATS
 * platforms asking the identical question, so none of them survive.
 */
export function normalizeQuestion(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

/**
 * How similar two questions are, 0-1.
 *
 * Jaccard similarity over the meaningful words: shared words divided by all
 * distinct words. Chosen over a plain overlap count because overlap alone
 * rates a short question against a long one far too highly — "sponsorship?"
 * would match every sentence containing the word.
 */
export function questionSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeQuestion(a));
  const wordsB = new Set(normalizeQuestion(b));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;

  const union = wordsA.size + wordsB.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Find the stored answer for a question the form is asking.
 *
 * Returns null when nothing clears the threshold — which the caller must treat
 * as "stop and ask the human", never as "answer it some other way".
 */
export function findAnswer(
  question: string,
  entries: AnswerEntry[],
  threshold: number = MATCH_THRESHOLD,
): AnswerMatch | null {
  let best: AnswerMatch | null = null;

  for (const entry of entries) {
    const score = questionSimilarity(question, entry.question);
    if (best === null || score > best.score) {
      best = { entry, score, exact: score === 1 };
    }
  }

  if (best === null || best.score < threshold) return null;
  return best;
}

/**
 * The questions worth having an answer ready for, from spec §16.
 *
 * Offered as prompts on the answer bank screen. They are the questions nearly
 * every application asks, and having them answered in advance is the
 * difference between an apply run that completes and one that stops halfway
 * to ask.
 */
export const SUGGESTED_QUESTIONS: { question: string; isLegal: boolean }[] = [
  { question: "Are you authorized to work in the US?", isLegal: true },
  { question: "Will you now or in the future require sponsorship?", isLegal: true },
  { question: "Why are you interested in this role?", isLegal: false },
  { question: "Describe a project you are proud of.", isLegal: false },
  { question: "Why this company?", isLegal: false },
  { question: "Preferred location", isLegal: false },
  { question: "Salary expectations", isLegal: false },
];
