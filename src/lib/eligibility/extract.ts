/**
 * Reading hard requirements out of a job description (spec §10).
 *
 * This is the deterministic half of requirement extraction: patterns that
 * employers write almost verbatim, every time. "We are unable to provide
 * sponsorship", "must be a U.S. citizen", "active security clearance",
 * "graduating in 2027". Those phrasings are stable enough that a regex reads
 * them more reliably — and far more cheaply — than a language model would.
 *
 * The fuzzy half (skills required vs preferred, role category, responsibility
 * summaries) is genuinely a language problem and belongs to the AI pass in
 * Phase 3. Nothing here tries to do that job.
 *
 * The governing rule is spec §3's second half: if the posting did not say it,
 * we do not record it. Every pattern below only ever turns "unknown" into a
 * stated fact, never the other way round, and anything ambiguous stays null.
 */

import {
  educationRank,
  NO_REQUIREMENTS,
  type EducationLevel,
  type GraduationWindow,
  type JobRequirements,
  type SponsorshipStance,
} from "./requirements";

/**
 * Strip HTML and collapse whitespace.
 *
 * Descriptions arrive as HTML from every ATS, and a requirement sentence is
 * routinely split across tags — "<li>Must be a U.S.<b>citizen</b></li>". Tags
 * become spaces rather than being deleted, so words on either side of one do
 * not get glued together into something that matches nothing.
 */
export function toPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does the posting say it will not sponsor?
 *
 * Phrasings seen in the wild, all of which mean the same thing:
 *   "we are unable to provide visa sponsorship"
 *   "this position is not eligible for sponsorship"
 *   "must be authorized to work in the US without sponsorship"
 *   "we do not sponsor employment visas"
 */
function extractSponsorship(text: string): SponsorshipStance {
  const refuses =
    /(?:unable|not able|cannot|can't|do(?:es)? not|will not|won't)\s+(?:to\s+)?(?:provide|offer|sponsor|support)[^.]{0,60}(?:sponsor|visa)/i.test(
      text,
    ) ||
    /not\s+(?:be\s+)?eligible\s+for[^.]{0,30}sponsorship/i.test(text) ||
    /without\s+(?:the\s+)?(?:need\s+for\s+)?(?:visa\s+)?sponsorship/i.test(text) ||
    /no\s+(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|provided|offered)/i.test(text);

  if (refuses) return "none";

  const offers =
    /(?:will|can|do|does|are\s+able\s+to)\s+(?:provide|offer|consider)?\s*(?:visa\s+)?sponsor/i.test(
      text,
    ) || /sponsorship\s+(?:is\s+)?(?:available|provided|offered)/i.test(text);

  return offers ? "available" : "unknown";
}

/**
 * Which citizenship the posting demands, if it demands one.
 *
 * Returns the country as written, not a normalized code — this is quoted back
 * to the reader as the reason a job was ruled out, and their own words are
 * clearer than an ISO code.
 */
function extractCitizenship(text: string): string | null {
  const patterns: RegExp[] = [
    /must\s+be\s+a\s+(?:U\.?S\.?|United\s+States)\s+citizen/i,
    /(?:U\.?S\.?|United\s+States)\s+citizenship\s+(?:is\s+)?required/i,
    /restricted\s+to\s+(?:U\.?S\.?|United\s+States)\s+citizens/i,
    /only\s+(?:U\.?S\.?|United\s+States)\s+citizens/i,
  ];
  return patterns.some((pattern) => pattern.test(text)) ? "United States" : null;
}

/** Does the posting require an existing security clearance? */
function extractClearance(text: string): boolean {
  return (
    /\b(?:active|current|existing)\s+(?:security\s+)?clearance\b/i.test(text) ||
    /\bsecurity\s+clearance\s+(?:is\s+)?(?:required|mandatory)\b/i.test(text) ||
    /\b(?:TS\/SCI|Top\s+Secret)\b/i.test(text)
  );
}

/**
 * The lowest degree the posting demands.
 *
 * Only counted when the posting ties the degree to a requirement word.
 * "Currently pursuing a Bachelor's degree" states what you must be enrolled
 * in; "our team includes PhDs" does not state anything you must hold, and a
 * naive search for "PhD" would wrongly rule the job out for everyone.
 */
function extractEducationLevel(text: string): EducationLevel | null {
  const demandsPhd =
    /(?:require[sd]?|must\s+(?:have|hold|be)|pursuing|enrolled\s+in|working\s+toward)[^.]{0,60}\b(?:Ph\.?D\.?|doctoral|doctorate)\b/i.test(
      text,
    ) || /\b(?:Ph\.?D\.?|doctorate)\s+(?:is\s+)?required\b/i.test(text);

  const demandsMasters =
    /(?:require[sd]?|must\s+(?:have|hold|be)|pursuing|enrolled\s+in|working\s+toward)[^.]{0,60}\b(?:master'?s?|M\.?S\.?c?\.?|MBA)\b/i.test(
      text,
    ) || /\bmaster'?s?\s+degree\s+(?:is\s+)?required\b/i.test(text);

  const demandsBachelors =
    /(?:require[sd]?|must\s+(?:have|hold|be)|pursuing|enrolled\s+in|working\s+toward)[^.]{0,60}\b(?:bachelor'?s?|B\.?S\.?c?\.?|B\.?A\.?|undergraduate)\b/i.test(
      text,
    ) || /\bbachelor'?s?\s+degree\s+(?:is\s+)?required\b/i.test(text);

  // JUDGMENT CALL: when a posting names more than one degree, we record the
  // LOWEST one, because that is the one it actually demands.
  //
  // The three patterns above are deliberately loose — each one only needs a
  // requirement word somewhere in the sixty characters before the degree — so
  // a single sentence sets off several of them at once. A real posting (a
  // Coinbase credit-risk internship) reads:
  //
  //   "Currently pursuing a bachelor's or master's degree in finance,
  //    economics, mathematics, or a related quantitative discipline"
  //
  // Both `demandsBachelors` and `demandsMasters` fire on that sentence. It is
  // an internship open to undergraduates; a master's is merely also accepted.
  // Recording "masters" invents a requirement, and an invented requirement
  // hides the posting from the very student it was written for — the
  // unrecoverable failure described at the top of this file. Taking the lowest
  // can only err in the recoverable direction: showing a job we might have
  // ruled out, which the reader can still judge for themselves.
  const demanded: EducationLevel[] = [];
  if (demandsBachelors) demanded.push("bachelors");
  if (demandsMasters) demanded.push("masters");
  if (demandsPhd) demanded.push("phd");

  if (demanded.length === 0) return null;

  // `educationRank` orders the levels (associates < bachelors < masters < phd),
  // so the smallest rank is the least the posting will settle for.
  return demanded.reduce((lowest, level) =>
    educationRank(level) < educationRank(lowest) ? level : lowest,
  );
}

/**
 * Plausible graduation years — wide enough to be useless as a filter is worse
 * than none. They double as the open end of a one-sided window: "2027 or
 * later" has no upper bound the posting is willing to name, so we use the
 * widest year we consider plausible rather than inventing a cutoff.
 */
export const EARLIEST_YEAR = 2000;
export const LATEST_YEAR = 2100;

/**
 * Month names as postings write them, spelled out or abbreviated.
 *
 * Needed because a range routinely carries a month on each end — "graduating
 * between December 2026 and May 2027" — and without this the "May " sitting
 * between the separator and the second year broke the match entirely.
 * No trailing "." is allowed: the surrounding patterns treat a period as the
 * end of the sentence, so "Dec. 2027" is out of scope here by design.
 */
const MONTH_NAME =
  "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";

/**
 * The graduation years the posting accepts.
 *
 * Handles "graduating between 2027 and 2028", "graduating 2026 or 2027",
 * "graduating between December 2026 and May 2027", "graduating in 2027",
 * "class of 2026", "December 2027 graduation", and the one-sided forms
 * "December 2027 or later" / "2026 or earlier". A single year becomes a window
 * of one.
 */
function extractGraduationWindow(text: string): GraduationWindow | null {
  // The one-sided forms are tested FIRST, before the range pattern below.
  // That ordering is load-bearing: the range separators now include "or", so
  // "December 2027 or later" reaching the range pattern first would be
  // mis-parsed rather than recognised for what it is.

  // "expected graduation date of December 2027 or later" — a real posting.
  // 2027 is the EARLIEST year accepted and the posting names no ceiling at
  // all. The old code closed the window at 2027, which ruled out a 2029
  // graduate the employer would happily have taken.
  const orLater =
    /graduat\w*[^.]{0,40}?\b(20\d{2})\s+or\s+(?:later|after|beyond|thereafter)\b/i.exec(
      text,
    );
  if (orLater) {
    const from = Number(orLater[1]);
    if (isPlausibleYear(from)) return { from, to: LATEST_YEAR };
  }

  // The mirror image, for postings aimed at students already near the end:
  // "graduating in December 2026 or earlier". Here 2026 is the ceiling and the
  // floor is unstated.
  const orEarlier =
    /graduat\w*[^.]{0,40}?\b(20\d{2})\s+or\s+(?:earlier|before|sooner|prior)\b/i.exec(
      text,
    );
  if (orEarlier) {
    const to = Number(orEarlier[1]);
    if (isPlausibleYear(to)) return { from: EARLIEST_YEAR, to };
  }

  // Two-year ranges. "or" is in the separator list for "Graduating 2026 or
  // 2027", which employers write as often as "2026 and 2027"; without it that
  // posting fell through to the single-year fallback below and came back as
  // {2026, 2026}, hiding the job from every 2027 graduate. The optional month
  // after the separator is for "between December 2026 and May 2027".
  const range = new RegExp(
    `graduat\\w*[^.]{0,40}?\\b(20\\d{2})\\s*(?:-|–|—|to|and|through|or|/)\\s*(?:${MONTH_NAME}\\s+)?(20\\d{2})\\b`,
    "i",
  ).exec(text);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (isPlausibleYear(from) && isPlausibleYear(to) && from <= to) return { from, to };
  }

  const single =
    /graduat\w*[^.]{0,40}?\b(20\d{2})\b/i.exec(text) ??
    /\bclass\s+of\s+(20\d{2})\b/i.exec(text) ??
    /\b(20\d{2})\s+grad(?:uate|uation)?\b/i.exec(text);
  if (single) {
    const year = Number(single[1]);
    if (isPlausibleYear(year)) return { from: year, to: year };
  }

  return null;
}

function isPlausibleYear(year: number): boolean {
  return year >= EARLIEST_YEAR && year <= LATEST_YEAR;
}

/**
 * Words that mark a sentence as describing what the employer would LIKE rather
 * than what it demands.
 *
 * Straight out of real postings: "3+ years of experience is a plus",
 * "5+ years preferred", "experience with Rust is a nice-to-have", "ideally
 * 2 years in a similar role".
 */
const PREFERENCE_WORDS =
  /\b(?:preferred|preferable|preferably|a plus|nice[-\s]?to[-\s]?have|bonus|ideally|desirable|we'd love)\b/i;

/**
 * The sentence a match sits inside.
 *
 * Found by scanning outward to the nearest "." on each side — crude, but a job
 * description after `toPlainText` is one long line and the period is the only
 * sentence boundary left to work with.
 */
function sentenceAround(text: string, index: number): string {
  const start = text.lastIndexOf(".", index) + 1;
  const nextDot = text.indexOf(".", index);
  return text.slice(start, nextDot === -1 ? text.length : nextDot);
}

/**
 * Years of experience demanded.
 *
 * Takes the smallest number the posting mentions, because a description
 * listing "2+ years required" and "5+ years preferred" is only *requiring*
 * two. Ranges like "3-5 years" are read as three for the same reason.
 *
 * Preferences are skipped entirely rather than merely losing to a smaller
 * number, because often there is no smaller number to lose to: "3+ years of
 * experience is a plus" used to become a hard three-year minimum, which is an
 * invented requirement that hides the posting from every student.
 */
function extractExperienceYears(text: string): number | null {
  const pattern = /\b(\d{1,2})\s*(?:\+|-|–|to)?\s*(?:\d{1,2})?\s*years?\b[^.]{0,40}?experience/gi;
  let smallest: number | null = null;

  for (const match of text.matchAll(pattern)) {
    const years = Number(match[1]);
    // 40 is not a requirement, it is a typo or a sentence about the company.
    if (!Number.isFinite(years) || years > 40) continue;
    // Judge each number by its own sentence, not by the posting as a whole:
    // "2+ years of experience required. 5+ years of experience preferred."
    // must still come back as 2, so the word "preferred" over in the second
    // sentence cannot be allowed to discard the first.
    if (PREFERENCE_WORDS.test(sentenceAround(text, match.index ?? 0))) continue;
    if (smallest === null || years < smallest) smallest = years;
  }

  return smallest;
}

/**
 * Extract everything checkable from a posting's description.
 *
 * Takes the raw description (HTML or plain), returns structured requirements
 * with unknowns left unknown.
 */
export function extractRequirements(description: string): JobRequirements {
  const text = toPlainText(description);
  if (text.length === 0) return { ...NO_REQUIREMENTS };

  return {
    educationLevel: extractEducationLevel(text),
    graduationWindow: extractGraduationWindow(text),
    minimumExperienceYears: extractExperienceYears(text),
    sponsorship: extractSponsorship(text),
    citizenshipRequired: extractCitizenship(text),
    clearanceRequired: extractClearance(text),
  };
}
