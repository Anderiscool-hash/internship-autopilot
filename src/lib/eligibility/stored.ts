/**
 * Reading requirements back out of the database.
 *
 * `Job.requirements` is a JSON column, which means Prisma hands it back as
 * `unknown` — the database cannot promise the shape, only that it is JSON. A
 * row could predate a change to the extractor, or have been written by hand.
 *
 * So everything coming out of that column goes through this file, which
 * validates it field by field and falls back to "unknown" for anything it does
 * not recognize. The alternative — casting the JSON straight to
 * JobRequirements and trusting it — would let a malformed row become a
 * confident wrong answer about someone's eligibility.
 */

import {
  NO_REQUIREMENTS,
  EDUCATION_LEVELS,
  type EducationLevel,
  type GraduationWindow,
  type JobRequirements,
  type SponsorshipStance,
} from "./requirements";

/** Narrow an unknown value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEducation(value: unknown): EducationLevel | null {
  return typeof value === "string" &&
    (EDUCATION_LEVELS as readonly string[]).includes(value)
    ? (value as EducationLevel)
    : null;
}

function readWindow(value: unknown): GraduationWindow | null {
  if (!isRecord(value)) return null;
  const { from, to } = value;
  if (typeof from !== "number" || typeof to !== "number") return null;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return null;
  return { from, to };
}

function readSponsorship(value: unknown): SponsorshipStance {
  return value === "none" || value === "available" ? value : "unknown";
}

function readYears(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

/**
 * Parse a stored `Job.requirements` value.
 *
 * Returns null when the column was never populated — which is not the same as
 * "this posting requires nothing", and callers are expected to tell the reader
 * the difference.
 */
export function readStoredRequirements(value: unknown): JobRequirements | null {
  if (!isRecord(value)) return null;

  return {
    ...NO_REQUIREMENTS,
    educationLevel: readEducation(value.educationLevel),
    graduationWindow: readWindow(value.graduationWindow),
    minimumExperienceYears: readYears(value.minimumExperienceYears),
    sponsorship: readSponsorship(value.sponsorship),
    citizenshipRequired:
      typeof value.citizenshipRequired === "string" && value.citizenshipRequired.length > 0
        ? value.citizenshipRequired
        : null,
    clearanceRequired: value.clearanceRequired === true,
  };
}
