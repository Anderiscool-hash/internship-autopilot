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
  if (demandsPhd) return "phd";

  const demandsMasters =
    /(?:require[sd]?|must\s+(?:have|hold|be)|pursuing|enrolled\s+in|working\s+toward)[^.]{0,60}\b(?:master'?s?|M\.?S\.?c?\.?|MBA)\b/i.test(
      text,
    ) || /\bmaster'?s?\s+degree\s+(?:is\s+)?required\b/i.test(text);
  if (demandsMasters) return "masters";

  const demandsBachelors =
    /(?:require[sd]?|must\s+(?:have|hold|be)|pursuing|enrolled\s+in|working\s+toward)[^.]{0,60}\b(?:bachelor'?s?|B\.?S\.?c?\.?|B\.?A\.?|undergraduate)\b/i.test(
      text,
    ) || /\bbachelor'?s?\s+degree\s+(?:is\s+)?required\b/i.test(text);
  if (demandsBachelors) return "bachelors";

  return null;
}

/** Plausible graduation years — wide enough to be useless as a filter is worse than none. */
const EARLIEST_YEAR = 2000;
const LATEST_YEAR = 2100;

/**
 * The graduation years the posting accepts.
 *
 * Handles "graduating between 2027 and 2028", "graduating in 2027", "class of
 * 2026", "December 2027 graduation". A single year becomes a window of one.
 */
function extractGraduationWindow(text: string): GraduationWindow | null {
  const range =
    /graduat\w*[^.]{0,40}?\b(20\d{2})\s*(?:-|–|—|to|and|through|\/)\s*(20\d{2})\b/i.exec(
      text,
    );
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
 * Years of experience demanded.
 *
 * Takes the smallest number the posting mentions, because a description
 * listing "2+ years required" and "5+ years preferred" is only *requiring*
 * two. Ranges like "3-5 years" are read as three for the same reason.
 */
function extractExperienceYears(text: string): number | null {
  const pattern = /\b(\d{1,2})\s*(?:\+|-|–|to)?\s*(?:\d{1,2})?\s*years?\b[^.]{0,40}?experience/gi;
  let smallest: number | null = null;

  for (const match of text.matchAll(pattern)) {
    const years = Number(match[1]);
    // 40 is not a requirement, it is a typo or a sentence about the company.
    if (!Number.isFinite(years) || years > 40) continue;
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
