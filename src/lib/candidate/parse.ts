/**
 * Turning the profile form into trustworthy candidate data (spec §2).
 *
 * This is the boundary where free text typed into a browser becomes the facts
 * the rest of the system acts on — the eligibility engine reads work
 * authorization from here, and the resume builder may only make claims the
 * Truth Ledger supports (spec §3). So the parsing rules below are deliberately
 * conservative:
 *
 *   - a field left blank is stored as null, never as a guess or a default
 *   - a field that cannot be understood is an error the form reports back,
 *     never a value silently coerced into something plausible
 *
 * Pure functions over plain records, so they can be tested without a browser
 * or a database.
 */

import { RemotePreference, TruthFactCategory } from "@prisma/client";

/** Whatever the form sent us: FormData flattened to strings. */
export type FormValues = Record<string, string | undefined>;

/** A validated profile ready to write to the Candidate row. */
export interface ProfileInput {
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  school: string | null;
  degree: string | null;
  graduationDate: Date | null;
  workAuthorization: string | null;
  needsSponsorship: boolean;
  citizenship: string | null;
  preferredLocations: string[];
  remotePreference: RemotePreference;
  minimumSalary: number | null;
  desiredRoles: string[];
  skills: string[];
  certifications: string[];
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
}

/** Either a parsed value or the list of things wrong with the form. */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

/** Trim a field, treating blank as absent. */
export function text(values: FormValues, key: string): string | null {
  const raw = values[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Split a multi-value field into a list.
 *
 * Accepts commas or newlines as separators, because people type both. Blank
 * entries are dropped and exact duplicates removed, so "Python, python" is
 * kept as two distinct skills (they might be spelled that way on purpose) but
 * "Python, Python" collapses to one.
 */
export function list(values: FormValues, key: string): string[] {
  const raw = values[key];
  if (typeof raw !== "string") return [];

  const items = raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return [...new Set(items)];
}

/** Read an HTML checkbox, which submits "on" when ticked and nothing when not. */
export function checkbox(values: FormValues, key: string): boolean {
  const raw = values[key];
  return raw === "on" || raw === "1" || raw === "true";
}

/**
 * Parse a whole-number field.
 *
 * Returns `undefined` for input that isn't a number at all, which the caller
 * turns into an error — as opposed to `null`, which means the field was left
 * blank and is genuinely unknown.
 */
export function wholeNumber(
  values: FormValues,
  key: string,
): number | null | undefined {
  const raw = text(values, key);
  if (raw === null) return null;
  const parsed = Number(raw.replace(/[,_\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.trunc(parsed);
}

/**
 * Parse a date field.
 *
 * Accepts `YYYY-MM-DD` (what `<input type="date">` submits) and `YYYY-MM`,
 * which is how people actually think about a graduation date. A month with no
 * day is stored as the first of that month — a documented convention, not an
 * invented precision, and the only alternative would be refusing the input
 * people naturally give.
 */
export function date(values: FormValues, key: string): Date | null | undefined {
  const raw = text(values, key);
  if (raw === null) return null;

  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const parsed = new Date(
    `${year}-${month}-${day ?? "01"}T00:00:00.000Z`,
  );
  if (Number.isNaN(parsed.getTime())) return undefined;

  // Catches "2026-02-31", which Date would roll forward into March.
  if (parsed.getUTCMonth() + 1 !== Number(month)) return undefined;

  return parsed;
}

/** The minimum an email has to look like before we will store it. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Validate the whole profile form. */
export function parseProfile(values: FormValues): ParseResult<ProfileInput> {
  const errors: string[] = [];

  const name = text(values, "name");
  if (name === null) errors.push("Name is required.");

  const email = text(values, "email");
  if (email === null) errors.push("Email is required.");
  else if (!looksLikeEmail(email)) errors.push(`"${email}" is not an email address.`);

  const graduationDate = date(values, "graduationDate");
  if (graduationDate === undefined) {
    errors.push("Graduation date must look like 2027-05 or 2027-05-15.");
  }

  const minimumSalary = wholeNumber(values, "minimumSalary");
  if (minimumSalary === undefined) {
    errors.push("Minimum salary must be a whole number, or blank.");
  }

  const rawRemote = text(values, "remotePreference");
  const remotePreference =
    rawRemote !== null && rawRemote in RemotePreference
      ? RemotePreference[rawRemote as keyof typeof RemotePreference]
      : RemotePreference.ANY;

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      // The required-field checks above guarantee these are non-null; the
      // compiler cannot see that through the error array.
      name: name as string,
      email: email as string,
      phone: text(values, "phone"),
      address: text(values, "address"),
      school: text(values, "school"),
      degree: text(values, "degree"),
      graduationDate: graduationDate as Date | null,
      workAuthorization: text(values, "workAuthorization"),
      needsSponsorship: checkbox(values, "needsSponsorship"),
      citizenship: text(values, "citizenship"),
      preferredLocations: list(values, "preferredLocations"),
      remotePreference,
      minimumSalary: minimumSalary as number | null,
      desiredRoles: list(values, "desiredRoles"),
      skills: list(values, "skills"),
      certifications: list(values, "certifications"),
      linkedinUrl: text(values, "linkedinUrl"),
      githubUrl: text(values, "githubUrl"),
      portfolioUrl: text(values, "portfolioUrl"),
    },
  };
}

/** A validated Truth Ledger entry (spec §3). */
export interface TruthFactInput {
  category: TruthFactCategory;
  statement: string;
  company: string | null;
  role: string | null;
  technology: string | null;
  metric: string | null;
  sourceDate: Date | null;
}

/**
 * Validate one Truth Ledger fact.
 *
 * The metric field gets a specific warning in spec §3: quantify only when a
 * real number exists. So a metric that contains no digit is rejected — if
 * there is no number, the claim belongs in the statement, not in a field the
 * resume builder will treat as a hard figure.
 */
export function parseTruthFact(values: FormValues): ParseResult<TruthFactInput> {
  const errors: string[] = [];

  const rawCategory = text(values, "category");
  const category =
    rawCategory !== null && rawCategory in TruthFactCategory
      ? TruthFactCategory[rawCategory as keyof typeof TruthFactCategory]
      : null;
  if (category === null) errors.push("Pick a category for this fact.");

  const statement = text(values, "statement");
  if (statement === null) errors.push("A fact needs a statement.");

  const metric = text(values, "metric");
  if (metric !== null && !/\d/.test(metric)) {
    errors.push(
      "A metric has to contain a real number — if there isn't one, leave it blank.",
    );
  }

  const sourceDate = date(values, "sourceDate");
  if (sourceDate === undefined) {
    errors.push("Date must look like 2026-05 or 2026-05-15.");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      category: category as TruthFactCategory,
      statement: statement as string,
      company: text(values, "company"),
      role: text(values, "role"),
      technology: text(values, "technology"),
      metric,
      sourceDate: sourceDate as Date | null,
    },
  };
}
