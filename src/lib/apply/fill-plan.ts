/**
 * Deciding what to type into each field of an application form (spec §20).
 *
 * Pure: fields in, a plan out. No browser, no network, so every decision about
 * what would be entered into a real employer's form is testable without
 * opening one.
 *
 * The rule the whole file serves: **a field is filled only from something the
 * candidate actually wrote down.** Profile values and answer-bank entries,
 * nothing else. There is no paraphrasing, no inference, no "it probably means
 * yes". A question with no stored answer is skipped and reported, because spec
 * §16 says an unknown answer pauses the run rather than being invented — and
 * an invented answer on a real application is not a bug you can retract.
 */

import { findAnswer, type AnswerEntry } from "../answers/match";
import type { FieldKind } from "./classify-field";

/** A form field, as read from the page. */
export interface FillableField {
  label: string;
  kind: FieldKind;
  required: boolean;
  /** DOM id, when the control has one — the preferred way to address it. */
  elementId: string;
  /** The control's name attribute; the fallback selector, and the radio group key. */
  name: string;
  /** text | email | tel | textarea | select | radio | checkbox | file | ... */
  inputType: string;
  /** For selects and choice groups: the option labels available. */
  options: string[];
}

/** What the runner should do with one field. */
export type FillAction =
  /** Type a value into a text input or textarea. */
  | { type: "fill"; value: string }
  /** Pick an option from a select. */
  | { type: "select"; value: string; option: string }
  /** Click one option of a radio/checkbox group. */
  | { type: "choose"; value: string; option: string }
  /** Leave it alone, and say why. */
  | { type: "skip"; reason: string };

/** One field and what will happen to it. */
export interface PlannedField {
  field: FillableField;
  action: FillAction;
  /** Where the value came from, for the review screen. */
  source: "profile" | "answer-bank" | "none";
}

export interface FillPlan {
  planned: PlannedField[];
  /** Fields that will be filled. */
  fillCount: number;
  /** Required fields that will be left empty — the reason a human is needed. */
  blockingGaps: string[];
}

/** The candidate values a form can be filled from. */
export interface FillProfile {
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  school: string | null;
  degree: string | null;
  graduationDate: Date | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
}

/**
 * The profile value for a standard field, or null.
 *
 * Matched on the label the employer wrote, since that is all we have. Order
 * matters: "preferred name" must be tested before the generic name rule, and
 * the more specific link labels before the generic "website".
 */
export function profileValueFor(label: string, profile: FillProfile): string | null {
  const text = label.toLowerCase();

  if (/first\s*name/.test(text)) return profile.name.split(/\s+/)[0] ?? null;
  if (/last\s*name|surname|family\s*name/.test(text)) {
    const parts = profile.name.split(/\s+/);
    return parts.length > 1 ? (parts[parts.length - 1] ?? null) : null;
  }
  if (/name/.test(text)) return profile.name;
  if (/e-?mail/.test(text)) return profile.email;
  if (/phone|mobile|telephone/.test(text)) return profile.phone;
  if (/linked\s?in/.test(text)) return profile.linkedinUrl;
  if (/github/.test(text)) return profile.githubUrl;
  if (/website|portfolio|personal site/.test(text)) return profile.portfolioUrl;
  if (/school|university|college/.test(text)) return profile.school;
  // Degree and discipline are different questions — "B.S." versus "Computer
  // Science" — and the profile stores them as one string. Filling both with
  // the same value looked right in a shadow run and was not, so only the
  // degree field is offered a value.
  if (/degree/.test(text)) return profile.degree;
  if (/discipline|major|field of study/.test(text)) return null;
  // "Country" is asked as its own field on most ATS forms and the profile
  // holds one free-text location line. A live shadow run put a street address
  // into Coinbase's Country field — a plausible-looking value that is simply
  // wrong, which is the worst kind. The profile does not know a country, so
  // nothing is offered for one.
  if (/\bcountry\b/.test(text)) return null;
  // A City field is not an address field. The profile keeps one free-text
  // location line, which may be a full "Brooklyn, NY" or may be just a street
  // — a live run put "108 autum ave" into Coinbase's City box. So a city is
  // offered only when one can actually be read out of the address.
  if (/\bcity\b/.test(text)) return cityFrom(profile.address);
  if (/state|location|address|zip|postal/.test(text)) return profile.address;
  if (/graduation|grad date/.test(text)) {
    if (!profile.graduationDate) return null;
    const date = profile.graduationDate;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

/**
 * The city part of a free-text address, if there is one.
 *
 * "Brooklyn, NY" -> "Brooklyn". "108 autumn ave" -> null, because a street is
 * not a city and guessing would put a plausible wrong value on an application.
 */
export function cityFrom(address: string | null): string | null {
  if (!address) return null;

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // No comma: one run-on line, and nothing here can tell a city from a street.
  if (parts.length < 2) return null;

  // "Brooklyn, NY" and "108 Autumn Ave, Brooklyn, NY" both put the city
  // immediately before a trailing state or country.
  const city = parts[parts.length - 2] as string;

  // A street number in that position means the address has no city in it.
  return /^\d/.test(city) ? null : city;
}

/**
 * Find the option that matches an answer.
 *
 * Exact match first, then a case-insensitive one, then a starts-with — "Yes"
 * should match an option reading "Yes, I am authorized". Returns null when
 * nothing matches closely, which is treated as "cannot answer this" rather
 * than as licence to pick the nearest option: on a work-authorization
 * question, the nearest option is a legal claim about the candidate.
 */
export function matchOption(value: string, options: string[]): string | null {
  const wanted = value.trim();
  if (wanted.length === 0 || options.length === 0) return null;

  const exact = options.find((option) => option === wanted);
  if (exact) return exact;

  const lower = wanted.toLowerCase();
  const insensitive = options.find((option) => option.trim().toLowerCase() === lower);
  if (insensitive) return insensitive;

  const prefixed = options.filter((option) =>
    option.trim().toLowerCase().startsWith(lower),
  );
  // Only when it is unambiguous. "Yes" matching both "Yes" and "Yes, with
  // conditions" is not an answer, it is a coin toss.
  return prefixed.length === 1 ? (prefixed[0] as string) : null;
}

/** Text-ish controls that take a typed value. */
const TYPED_INPUTS = new Set(["text", "email", "tel", "url", "number", "textarea", "month", "date"]);

/** Build the plan for one form. */
export function buildFillPlan(
  fields: FillableField[],
  profile: FillProfile,
  answers: AnswerEntry[],
): FillPlan {
  const planned: PlannedField[] = fields.map((field) => {
    // Documents are Phase 4 and do not exist; a file input is always skipped.
    if (field.kind === "file" || field.inputType === "file") {
      return {
        field,
        action: {
          type: "skip",
          reason: "Document uploads are not built yet — attach this yourself.",
        },
        source: "none",
      };
    }

    if (field.kind === "unknown") {
      return {
        field,
        action: {
          type: "skip",
          reason: "The parser could not tell what this field is asking for.",
        },
        source: "none",
      };
    }

    // Standard fields come from the profile; anything else from the answer
    // bank. A legal question is never answered from the profile by inference —
    // "needs sponsorship" on the profile is not the same claim as whatever
    // wording this particular employer used.
    const fromProfile =
      field.kind === "standard" ? profileValueFor(field.label, profile) : null;
    const match = fromProfile === null ? findAnswer(field.label, answers) : null;
    const value = fromProfile ?? match?.entry.answer ?? null;
    const source: PlannedField["source"] =
      fromProfile !== null ? "profile" : match ? "answer-bank" : "none";

    if (value === null) {
      return {
        field,
        action: {
          type: "skip",
          reason:
            field.kind === "standard"
              ? "Your profile has no value for this."
              : "No stored answer matches this question closely enough.",
        },
        source: "none",
      };
    }

    if (field.inputType === "select" || field.inputType === "radio" || field.inputType === "checkbox") {
      const option = matchOption(value, field.options);
      if (option === null) {
        return {
          field,
          action: {
            type: "skip",
            reason: `Your answer ("${value}") does not match any of the offered options.`,
          },
          source: "none",
        };
      }
      return {
        field,
        action: {
          type: field.inputType === "select" ? "select" : "choose",
          value,
          option,
        },
        source,
      };
    }

    if (TYPED_INPUTS.has(field.inputType)) {
      return { field, action: { type: "fill", value }, source };
    }

    return {
      field,
      action: {
        type: "skip",
        reason: `Nothing here knows how to fill a "${field.inputType}" control.`,
      },
      source: "none",
    };
  });

  return {
    planned,
    fillCount: planned.filter((item) => item.action.type !== "skip").length,
    blockingGaps: planned
      .filter((item) => item.field.required && item.action.type === "skip")
      .map((item) => item.field.label),
  };
}
