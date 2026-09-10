/**
 * Reading profile fields out of resume text, by rule.
 *
 * This runs with no AI at all, and it runs first. Email addresses, phone
 * numbers, LinkedIn and GitHub URLs, degrees and graduation dates have shapes
 * a regex reads reliably — asking a model to find an email address is slower,
 * costs more, and is less accurate than the pattern that defines what an email
 * address is.
 *
 * The AI pass (see `ai-parse.ts`) exists for what regexes genuinely cannot do:
 * deciding which line is the person's name, and pulling skills out of prose.
 *
 * THE RULE THAT GOVERNS THIS WHOLE FILE: nothing here writes to the profile.
 * It returns suggestions, each with the exact snippet of the resume it came
 * from, which the user reviews and edits before saving (spec §3 — the app does
 * not fabricate candidate facts, and a value lifted out of a document by a
 * regex is a guess until a human confirms it).
 */

/** One suggested field value, with its evidence. */
export interface FieldSuggestion<T = string> {
  value: T;
  /** The text this was taken from, so the user can judge it. */
  evidence: string;
  /** How it was found — shown as a badge next to the field. */
  source: "pattern" | "ai";
}

/** Everything the parser can suggest for a profile. */
export interface ResumeSuggestions {
  name?: FieldSuggestion;
  email?: FieldSuggestion;
  phone?: FieldSuggestion;
  address?: FieldSuggestion;
  school?: FieldSuggestion;
  degree?: FieldSuggestion;
  graduationDate?: FieldSuggestion;
  linkedinUrl?: FieldSuggestion;
  githubUrl?: FieldSuggestion;
  portfolioUrl?: FieldSuggestion;
  skills?: FieldSuggestion<string[]>;
}

/** Grab a readable snippet of the line a match came from. */
function lineAround(text: string, index: number, maxLength = 100): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  const line = text.slice(start, end === -1 ? text.length : end).trim();
  return line.length > maxLength ? `${line.slice(0, maxLength)}…` : line;
}

/** Build a suggestion from a regex match. */
function fromMatch(text: string, match: RegExpExecArray, value?: string): FieldSuggestion {
  return {
    value: value ?? match[0],
    evidence: lineAround(text, match.index),
    source: "pattern",
  };
}

/** Email — the one field a pattern gets right essentially always. */
function findEmail(text: string): FieldSuggestion | undefined {
  const match = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(text);
  return match ? fromMatch(text, match) : undefined;
}

/**
 * Phone number.
 *
 * Deliberately conservative: requires either a country code, parentheses, or
 * separators. A bare run of ten digits in a resume is at least as likely to be
 * a student ID, a date range or a zip+4 as a phone number.
 */
function findPhone(text: string): FieldSuggestion | undefined {
  const match =
    /(\+\d{1,3}[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/.exec(text);
  return match ? fromMatch(text, match, match[0].trim()) : undefined;
}

/** A URL on a known host, normalized to https. */
function findUrl(text: string, host: RegExp): FieldSuggestion | undefined {
  const pattern = new RegExp(
    `(https?://)?(www\\.)?${host.source}/[A-Za-z0-9_./-]+`,
    "i",
  );
  const match = pattern.exec(text);
  if (!match) return undefined;

  const raw = match[0].replace(/[.,;)]+$/, "");
  const value = raw.startsWith("http") ? raw : `https://${raw}`;
  return { value, evidence: lineAround(text, match.index), source: "pattern" };
}

/**
 * The degree, as written.
 *
 * Matches the abbreviations and the spelled-out forms, and keeps the field of
 * study when it is on the same line — "BS Computer Science" is more useful in
 * the profile than "BS", and the eligibility engine reads the level out of it
 * either way.
 */
function findDegree(text: string): FieldSuggestion | undefined {
  const patterns = [
    /\b(B\.?S\.?c?\.?|B\.?A\.?|Bachelor(?:'s)?(?: of [A-Za-z]+)?)\b[^\n,]{0,40}/i,
    /\b(M\.?S\.?c?\.?|M\.?A\.?|MBA|Master(?:'s)?(?: of [A-Za-z]+)?)\b[^\n,]{0,40}/i,
    /\b(Ph\.?D\.?|Doctorate)\b[^\n,]{0,40}/i,
    /\b(Associate(?:'s)?)\b[^\n,]{0,40}/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return fromMatch(text, match, match[0].replace(/\s+/g, " ").trim());
    }
  }
  return undefined;
}

/** Months as resumes write them. */
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Expected graduation, as `YYYY-MM` where the month is stated.
 *
 * Prefers a date that is explicitly labelled as a graduation or an expected
 * one, since a resume is full of other dates — employment ranges, project
 * dates, certification dates. An unlabelled year is not assumed to be a
 * graduation year.
 */
function findGraduation(text: string): FieldSuggestion | undefined {
  const labelled =
    /(?:expected|anticipated|graduat\w*)[^\n]{0,40}?(?:([A-Za-z]{3,9})\.?\s+)?(20\d{2})/i.exec(
      text,
    ) ??
    /(?:([A-Za-z]{3,9})\.?\s+)?(20\d{2})[^\n]{0,20}?(?:expected|anticipated|graduation)/i.exec(
      text,
    );

  if (!labelled) return undefined;

  const monthWord = labelled[1]?.slice(0, 3).toLowerCase();
  const month = monthWord ? MONTHS[monthWord] : undefined;
  const year = labelled[2];

  return {
    value: month ? `${year}-${month}` : (year as string),
    evidence: lineAround(text, labelled.index),
    source: "pattern",
  };
}

/**
 * The school.
 *
 * Matched on the institution words rather than on a section heading, because
 * "EDUCATION" as a heading is followed by the school on the next line about as
 * often as on the same one.
 */
function findSchool(text: string): FieldSuggestion | undefined {
  const match =
    /^[^\n]*\b(University|College|Institute of Technology|Polytechnic)\b[^\n]*$/im.exec(
      text,
    );
  if (!match) return undefined;

  const line = match[0].replace(/\s+/g, " ").trim();
  // Strip a trailing location or date that shares the line.
  const cleaned = line.split(/\s{2,}|\s+\|\s+|,\s+(?=[A-Z]{2}\b)/)[0] ?? line;
  return { value: cleaned.trim(), evidence: line, source: "pattern" };
}

/**
 * Read what can be read by rule.
 *
 * Name and skills are deliberately absent: the first line of a resume is
 * usually the name but is sometimes a header, an address or "Curriculum
 * Vitae", and skills are a prose problem. Both are left to the AI pass, which
 * may not be configured — in which case the user types two fields, which is a
 * better outcome than a confidently wrong name.
 */
export function parseResumeFields(text: string): ResumeSuggestions {
  const suggestions: ResumeSuggestions = {};

  const email = findEmail(text);
  if (email) suggestions.email = email;

  const phone = findPhone(text);
  if (phone) suggestions.phone = phone;

  const linkedin = findUrl(text, /linkedin\.com/);
  if (linkedin) suggestions.linkedinUrl = linkedin;

  const github = findUrl(text, /github\.com/);
  if (github) suggestions.githubUrl = github;

  const school = findSchool(text);
  if (school) suggestions.school = school;

  const degree = findDegree(text);
  if (degree) suggestions.degree = degree;

  const graduation = findGraduation(text);
  if (graduation) suggestions.graduationDate = graduation;

  return suggestions;
}
