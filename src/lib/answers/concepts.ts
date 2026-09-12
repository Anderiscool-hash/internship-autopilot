/**
 * Recognising that two differently-worded questions are the same question.
 *
 * Word-overlap matching has a specific, predictable failure: it punishes the
 * longer phrasing. A live shadow run hit it exactly —
 *
 *   stored: "Will you now or in the future require sponsorship?"
 *   asked:  "Will you require sponsorship for employment visa status now or in
 *            the future?"
 *
 * — which is unmistakably the same question and scored 0.57 against a 0.8 bar,
 * so a stored answer sat unused while the field was left blank.
 *
 * Application forms ask from a small, stable vocabulary. Naming those concepts
 * outright is more reliable than any amount of similarity tuning, and it can
 * explain itself: "both of these are the sponsorship question" is a reason a
 * person can check.
 *
 * WHAT THIS FILE REFUSES TO DO IS AS IMPORTANT AS WHAT IT DOES. The same run
 * also produced:
 *
 *   stored: "Are you authorized to work in the US?"
 *   asked:  "Are you legally authorized to work in the country where this
 *            position is located?"
 *
 * Same concept, different scope — that posting might be in London. Answering
 * "yes" there is a false legal claim on a real application, so a concept match
 * is refused whenever one side names a place and the other does not.
 */

/** The question concepts worth recognising by name. */
export type QuestionConcept =
  | "work-authorization"
  | "sponsorship"
  | "age-18"
  | "security-clearance"
  | "criminal-record"
  | "previously-employed"
  | "government-official-relative"
  | "government-official-status"
  | "referral-source"
  | "eeo-gender"
  | "eeo-race"
  | "eeo-veteran"
  | "eeo-disability"
  | "privacy-notice-ack"
  | "arbitration-agreement-ack"
  | "ai-usage-habits"
  | "ai-use-disclosure"
  | "certification-of-truthfulness";

/**
 * Patterns that identify each concept.
 *
 * Order matters, and each case below exists because a real question would
 * otherwise be caught by a broader pattern first:
 *
 *   - sponsorship is tested before work authorization, because "will you
 *     require sponsorship to work in the US" contains both and is a
 *     sponsorship question.
 *   - government-official-relative is tested before government-official-status,
 *     because "a close relative of a government official" contains the literal
 *     phrase "government official" and would otherwise be read as the person
 *     themselves being one.
 *   - ai-usage-habits is tested before ai-use-disclosure for the same reason:
 *     "describes how you use AI tools" and "may use AI tools to assist" share
 *     the phrase "AI tools" and nothing else should decide between them.
 */
const CONCEPT_PATTERNS: [QuestionConcept, RegExp][] = [
  ["sponsorship", /\bsponsor/i],
  ["security-clearance", /\bclearance\b|\bts\/sci\b/i],
  ["age-18", /\b(18 years|age of 18|at least 18)\b/i],
  ["criminal-record", /\b(felony|conviction|convicted|criminal record)\b/i],
  ["previously-employed", /\b(previously|formerly|ever been)\b[^?]*\bemploy/i],
  [
    "government-official-relative",
    /\brelative\b[^?]*\bgovernment official\b|\bgovernment official\b[^?]*\brelative\b/i,
  ],
  [
    "government-official-status",
    /\bgovernment official\b|\bcivil service\b|\bgovernment[- ]owned\b|\bgovernment[- ]controlled\b/i,
  ],
  ["referral-source", /\bhow did you (hear|find out)\b|\bwhere did you hear\b/i],
  ["eeo-gender", /\bgender\b|\bsex\b/i],
  ["eeo-race", /\b(race|ethnicity|hispanic|latino)\b/i],
  ["eeo-veteran", /\bveteran\b|\bprotected veteran\b/i],
  ["eeo-disability", /\bdisability\b|\bdisabled\b/i],
  // "Please confirm receipt of the above linked Global Data Privacy Notice and
  // US Arbitration Agreement" (the real Coinbase field) contains both of the
  // next two concepts. Privacy is tested first, so a bundled acknowledgement
  // resolves to the privacy-notice answer — the two are usually answered the
  // same way ("yes") in practice, so this is a reasonable default rather than
  // a real loss of information.
  ["privacy-notice-ack", /\bprivacy (notice|policy)\b|\bdata privacy notice\b/i],
  ["arbitration-agreement-ack", /\barbitration agreement\b|\barbitration\b/i],
  [
    "ai-usage-habits",
    /\bdescribes how you use\b|\bhow (do |would )?you use AI\b|\bhow you use AI tools\b/i,
  ],
  [
    "ai-use-disclosure",
    /\bAI (tools?|technology)\b.*\b(assist|application|interview|hiring|recruit)/i,
  ],
  [
    "certification-of-truthfulness",
    /\btrue and correct\b|\bcertify that the information\b/i,
  ],
  ["work-authorization", /\bauthoriz/i, ],
];

/** Which concept a question is asking about, if any. */
export function conceptOf(question: string): QuestionConcept | null {
  for (const [concept, pattern] of CONCEPT_PATTERNS) {
    if (pattern.test(question)) return concept;
  }
  return null;
}

/**
 * Place names and scope phrases that change what a question is asking.
 *
 * "Authorized to work in the US" and "authorized to work in Canada" are the
 * same concept and different questions. So is "in the country where this
 * position is located", which is a scope even though it names no country.
 */
const SCOPE_PATTERNS: RegExp[] = [
  /\b(u\.?s\.?a?|united states|america)\b/i,
  /\b(uk|united kingdom|britain|canada|ireland|australia|india|germany|france|singapore|japan|brazil|mexico)\b/i,
  /\bcountry where\b|\bcountry in which\b|\bcountry of\b|\bthis (country|location|position is located)\b/i,
  /\b(eu|european union|eea)\b/i,
];

/**
 * Different spellings of the same place.
 *
 * Without this, "the US" and "the United States" compare as different scopes
 * and a perfectly good stored answer goes unused — the same failure as the
 * word-overlap matcher, one level down.
 */
const SCOPE_ALIASES: [RegExp, string][] = [
  [/^(u\.?s\.?a?|united states|america)$/i, "united-states"],
  [/^(uk|united kingdom|britain)$/i, "united-kingdom"],
  [/^(eu|european union|eea)$/i, "european-union"],
];

/** Reduce a matched scope phrase to a canonical name. */
function canonicalScope(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/\./g, "").trim();
  for (const [pattern, canonical] of SCOPE_ALIASES) {
    if (pattern.test(cleaned)) return canonical;
  }
  // "the country where this position is located" and friends: a scope, but one
  // whose value depends on the job rather than on the wording.
  if (/country where|country in which|country of|this (country|location|position)/.test(cleaned)) {
    return "job-country";
  }
  return cleaned;
}

/** The scope markers a question carries, normalized for comparison. */
export function scopeMarkers(question: string): string[] {
  const found: string[] = [];
  for (const pattern of SCOPE_PATTERNS) {
    const match = pattern.exec(question);
    if (match) found.push(canonicalScope(match[0]));
  }
  return [...new Set(found)];
}

/**
 * Concepts whose legal truth actually changes with a named place — work
 * authorization and sponsorship depend on which country's law applies, so a
 * scope mismatch there is a different question with a different answer.
 *
 * Nowhere else does a place name change what is being asked. It surfaced with
 * "Please confirm receipt of the above linked Global Data Privacy Notice and
 * US Arbitration Agreement" — the literal text "US" in the document's proper
 * noun ("US Arbitration Agreement") reads as a work-country scope to
 * scopeMarkers, even though the question has nothing to do with which country
 * the candidate is authorized in. Without this allowlist, that stray "US"
 * would refuse a match against the generalized, unscoped stored version of
 * the same acknowledgement — the same failure mode scope-checking exists to
 * prevent, just triggered by a false positive instead of a missing check.
 */
const SCOPE_SENSITIVE_CONCEPTS = new Set<QuestionConcept>([
  "work-authorization",
  "sponsorship",
]);

/**
 * Do two questions ask the same thing?
 *
 * True only when they share a concept AND, for the concepts where a place
 * actually changes the answer, neither adds a scope the other lacks. Two
 * unscoped questions match; two questions naming the same place match; a
 * scoped and an unscoped one do not.
 */
export function sameQuestion(a: string, b: string): boolean {
  const conceptA = conceptOf(a);
  if (conceptA === null || conceptA !== conceptOf(b)) return false;

  if (!SCOPE_SENSITIVE_CONCEPTS.has(conceptA)) return true;

  const scopeA = scopeMarkers(a);
  const scopeB = scopeMarkers(b);

  // Neither is scoped: the concept alone settles it.
  if (scopeA.length === 0 && scopeB.length === 0) return true;

  // One is scoped and the other is not — the scoped one is asking something
  // narrower, and the stored answer may not hold there.
  if (scopeA.length === 0 || scopeB.length === 0) return false;

  // Both scoped: only a match if they name the same place. "US" and "the
  // country where this position is located" are not the same place; the second
  // depends on the job, which this function does not know.
  return scopeA.some((scope) => scopeB.includes(scope));
}
