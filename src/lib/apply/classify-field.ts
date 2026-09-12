/**
 * Working out what an application form field is asking for.
 *
 * Employers write the same question a dozen ways — "Email", "Email Address",
 * "E-mail *" — so filling a form correctly starts with recognizing what each
 * label means. This file does that by rule, from the label text alone.
 *
 * The category that matters most is `legal`. Work authorization, sponsorship,
 * citizenship and clearance answers are the ones that must come from the
 * profile verbatim and must never be paraphrased or guessed (spec §16), so
 * they are separated out rather than lumped in with everything else.
 *
 * A field with no readable label at all returns `unknown`, which counts
 * against application confidence (spec §17). A field nobody can even describe
 * is a field nobody can fill in correctly, and pretending otherwise is how a
 * form gets submitted with the wrong answer in it.
 */

/**
 * What kind of thing a field is asking for.
 *
 * `custom` and `unknown` are different claims: custom means "a question we can
 * read but have no profile field for, so the answer bank must supply it",
 * while unknown means "we cannot describe this field at all". Only the second
 * counts against form-parsing confidence.
 */
export type FieldKind = "standard" | "legal" | "custom" | "file" | "unknown";

/** Labels that identify a standard profile field, matched as substrings. */
const STANDARD_PATTERNS: RegExp[] = [
  /\b(first|last|full|preferred)\s*name\b/i,
  /^name\b/i,
  /\be-?mail\b/i,
  /\bphone\b|\bmobile\b|\btelephone\b/i,
  /\b(city|state|country|location|address|zip|postal)\b/i,
  /\blinked\s?in\b/i,
  /\bgithub\b/i,
  /\b(website|portfolio|personal site)\b/i,
  /\b(school|university|college)\b/i,
  /\b(degree|discipline|major|field of study)\b/i,
  /\b(graduation|grad date|end date)\b/i,
  /\b(gpa)\b/i,
  /\bpronouns?\b/i,
  /\bstart date\b|\bavailability\b/i,
  // The employment block. These are profile questions now that work history is
  // stored — before it was, they fell through to the answer bank, where they
  // sat unanswered on every run because no stored answer could match them.
  //
  // The narrow "company name" rather than a bare "company": the word also
  // appears throughout questions *about the employer* ("have you previously
  // been employed by this company?"), which are the candidate's to answer and
  // must stay with the answer bank.
  /\bcompany name\b|\bemployer name\b|\bcurrent employer\b/i,
  /\bcurrent role\b|\bjob title\b|\bposition title\b|^title$/i,
];

/**
 * Labels that ask a legal or eligibility question.
 *
 * Includes the EEO/demographic questions. They are voluntary rather than
 * legal obligations, but they share the property that matters here: the answer
 * is the candidate's to give and must never be inferred or invented.
 */
const LEGAL_PATTERNS: RegExp[] = [
  /\bauthoriz/i,
  /\bsponsor/i,
  /\bvisa\b/i,
  /\bcitizen/i,
  /\bclearance\b/i,
  /\bwork permit\b/i,
  /\beligible to work\b/i,
  /\b(18 years|age of 18)\b/i,
  /\b(felony|conviction|background check)\b/i,
  /\b(veteran|disability|gender|race|ethnicity|hispanic|latino)\b/i,
  /\beeo\b/i,
];

/** Labels that identify a document upload. */
const FILE_PATTERNS: RegExp[] = [
  /\bresume\b|\bcv\b/i,
  /\bcover letter\b/i,
  /\battach|\bupload\b/i,
  /\btranscript\b/i,
];

/**
 * Classify a field from its label and input type.
 *
 * `inputType` is what the HTML says (`file`, `textarea`, `select`...), used to
 * catch a document upload whose label is unhelpful.
 */
export function classifyFieldLabel(label: string, inputType?: string): FieldKind {
  const trimmed = label.trim();
  if (trimmed.length === 0) return "unknown";

  if (inputType === "file") return "file";
  if (FILE_PATTERNS.some((pattern) => pattern.test(trimmed))) return "file";

  // Legal is checked before standard on purpose: "Are you legally authorized to
  // work in the country of the job's location?" contains "location", and
  // treating it as a standard address field would be exactly the mistake this
  // file exists to prevent.
  if (LEGAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return "legal";
  if (STANDARD_PATTERNS.some((pattern) => pattern.test(trimmed))) return "standard";

  // Anything else with a readable label is a question we can see but do not
  // have a profile field for: its answer has to come from the answer bank
  // (spec §16). That is "custom", not "unknown" — the distinction matters,
  // because unknown means "we cannot even describe this field", which is a
  // much stronger reason to stop.
  return "custom";
}

/** Strip the decoration employers put around a required field's label. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[*✱]\s*$/, "")
    .replace(/\(required\)$/i, "")
    .replace(/\(optional\)$/i, "")
    .trim();
}

/**
 * Turn a form control's own identifier into a readable label.
 *
 * The last resort when a field has no usable label text. Greenhouse's file
 * inputs are the case that forced it: the visible text next to them is the
 * button ("Attach"), while the input's id is `resume` or `cover_letter` — the
 * name of the thing being asked for.
 */
export function humanizeIdentifier(identifier: string): string {
  const words = identifier
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (words.length === 0) return "";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Labels that name a control rather than what it is asking for. */
export const GENERIC_CONTROL_LABEL =
  /^(attach|upload|choose file|browse|select file|search|submit)$/i;

/** Does this label mark a required field? */
export function looksRequired(raw: string, ariaRequired?: string | null): boolean {
  if (ariaRequired === "true") return true;
  return /[*✱]\s*$/.test(raw.trim()) || /\(required\)/i.test(raw);
}
