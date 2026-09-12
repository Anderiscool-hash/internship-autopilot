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
import { describeKind, documentKindForField, type DocumentKind } from "../documents/kind-for-field";
import { inferEducationLevel } from "../eligibility/engine";
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
  /**
   * A JS combobox: typing does not select. The runner has to open the list and
   * click the option, and say so when it cannot.
   */
  isCombobox?: boolean;
}

/** What the runner should do with one field. */
export type FillAction =
  /** Type a value into a text input or textarea. */
  | { type: "fill"; value: string }
  /** Pick an option from a select. */
  | { type: "select"; value: string; option: string }
  /** Click one option of a radio/checkbox group. */
  | { type: "choose"; value: string; option: string }
  /** Attach a stored document to a file input. */
  | { type: "attach"; path: string; filename: string; mimeType: string; kind: DocumentKind }
  /** Leave it alone, and say why. */
  | { type: "skip"; reason: string };

/** One field and what will happen to it. */
export interface PlannedField {
  field: FillableField;
  action: FillAction;
  /** Where the value came from, for the review screen. */
  source: "profile" | "answer-bank" | "none" | "document";
}

export interface FillPlan {
  planned: PlannedField[];
  /** Fields that will be filled. */
  fillCount: number;
  /** Required fields that will be left empty — the reason a human is needed. */
  blockingGaps: string[];
}

/** One job the candidate has held, as a form needs it. */
export interface WorkEntry {
  company: string;
  title: string;
  location: string | null;
  isCurrent: boolean;
}

/** One programme the candidate has studied, as a form needs it. */
export interface EducationEntry {
  school: string;
  degree: string;
  fieldOfStudy: string | null;
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
  /**
   * Jobs held, most recent first. Application forms ask about one position —
   * "Company name", "Title", "Current role" — and mean the current or latest
   * one, so order is what makes these fields answerable.
   */
  work?: WorkEntry[];
  /** Programmes studied, most recent first. Same reasoning as `work`. */
  education?: EducationEntry[];
}

/**
 * The job a form means when it asks about "your" company or title.
 *
 * A current role beats a past one; failing that, the most recent, which is why
 * the caller is required to sort. Returns null rather than guessing when there
 * is nothing on file — a form asking for an employer is not a question a
 * blank profile can answer.
 */
export function currentWork(profile: FillProfile): WorkEntry | null {
  const work = profile.work ?? [];
  return work.find((entry) => entry.isCurrent) ?? work[0] ?? null;
}

/** The programme a form means when it asks about "your" school or major. */
export function currentEducation(profile: FillProfile): EducationEntry | null {
  return (profile.education ?? [])[0] ?? null;
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

  // ── The employment block, checked first ──────────────────────────────
  // "Company name" and "Title" are asked on nearly every form and mean the
  // candidate's current or most recent job.
  //
  // These run before the personal-details rules below because the generic
  // "name" rule would otherwise answer "Company name" with the candidate's
  // own name — which it did, until this test caught it.
  //
  // Both words are ambiguous elsewhere, so the traps are excluded first.
  // "Title" is also Mr/Ms on a personal-details block and the name of a
  // publication on an academic one; "Company" appears in questions *about the
  // employer* — "Have you previously been employed by this company?" — where
  // answering with the candidate's own employer would be actively wrong.
  if (/\bcompany\b|\bemployer\b/.test(text)) {
    if (/previous|prior|ever|have you|worked at|employed by|why|our\b/.test(text)) return null;
    return currentWork(profile)?.company ?? null;
  }

  if (/current role|job title|position title|\btitle\b/.test(text)) {
    // Mr/Mrs/Dr, not a job. Matched on the honorifics themselves as well as
    // the word "salutation", because the commonest spelling of this field is
    // "Title (Mr/Ms/Dr)" — which says "title" and never says "salutation".
    if (/salutation|prefix|honorific|\bmr\b|\bmrs\b|\bms\b|\bdr\b|\bmx\b/.test(text)) return null;
    // A paper, a thesis, a portfolio piece.
    if (/publication|thesis|paper|project|article|book\b/.test(text)) return null;
    return currentWork(profile)?.title ?? null;
  }

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

  // Discipline is a separate question from degree — "Computer Science" versus
  // "B.S." — and the profile's single degree string cannot answer both. It is
  // answerable only from an education entry that records the field of study.
  if (/discipline|major|field of study|course of study/.test(text)) {
    return currentEducation(profile)?.fieldOfStudy ?? null;
  }

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

/**
 * Match a stored answer against a dropdown's real options, trying the
 * forgiving-but-still-honest variations.
 *
 * Found by live runs: a profile says "John Jay College of Criminal Justice
 * (CUNY)" and the list offers "John Jay College of Criminal Justice"; a
 * profile says "B.S. in Computer Science & Cybersecurity" and the list offers
 * "Bachelor's Degree". Both were previously typed in as free text, which made
 * them look filled while the form held nothing.
 *
 * Every step here still requires the candidate's own words to pick the option
 * — none of it invents a value. Where nothing matches, it says so.
 */
export function matchOptionForLabel(
  value: string,
  options: string[],
  label: string,
): string | null {
  const direct = matchOption(value, options);
  if (direct) return direct;

  // A parenthetical qualifier the list does not carry: "(CUNY)", "(Main
  // Campus)". Dropping it changes nothing about which institution is meant.
  const withoutParens = value.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (withoutParens !== value) {
    const stripped = matchOption(withoutParens, options);
    if (stripped) return stripped;
  }

  // Degree lists are a fixed vocabulary — "Bachelor's Degree", "Master's
  // Degree" — and a profile stores the degree as the candidate wrote it. The
  // level is already inferred from that same string for eligibility (spec
  // §11), so the two agree by construction.
  if (/degree|education level/i.test(label)) {
    const level = inferEducationLevel(value);
    if (level) {
      const wanted: Record<string, RegExp> = {
        associates: /associate/i,
        bachelors: /bachelor/i,
        masters: /master/i,
        phd: /doctor|ph\.?d/i,
      };
      const pattern = wanted[level];
      const found = pattern ? options.find((option) => pattern.test(option)) : undefined;
      if (found) return found;
    }
  }

  // A month stored as a number against a list of month names. Education date
  // pickers ask for the month as a dropdown reading January...December, and a
  // stored "09" matches none of the twelve — a live run left both the start
  // and end month of a degree empty for exactly this reason.
  //
  // Only for a field whose label says month: "09" against an arbitrary list is
  // the number nine, not September.
  if (/\bmonth\b/i.test(label)) {
    const named = monthNameFor(value);
    if (named) {
      const found = options.find((option) => option.trim().toLowerCase().startsWith(named));
      if (found) return found;
    }
  }

  return null;
}

/** The month names, in the order their numbers imply. */
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * The month name a numeric month refers to, or null.
 *
 * Null for anything outside 1-12 — including "13", which a live answer bank
 * actually held. A number that is not a month must stay unmatched and be
 * reported, not be rounded to the nearest one.
 */
export function monthNameFor(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;

  const month = Number(trimmed);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return MONTH_NAMES[month - 1] ?? null;
}

/** Text-ish controls that take a typed value. */
const TYPED_INPUTS = new Set(["text", "email", "tel", "url", "number", "textarea", "month", "date"]);

/** Build the plan for one form. */
export function buildFillPlan(
  fields: FillableField[],
  profile: FillProfile,
  answers: AnswerEntry[],
  /**
   * The candidate's stored documents, by kind. Passed in rather than looked up
   * so this stays pure and testable: what is on disk is the caller's problem.
   */
  documents: Partial<
    Record<DocumentKind, { absolutePath: string; filename: string; mimeType?: string }>
  > = {},
): FillPlan {
  const planned: PlannedField[] = fields.map((field) => {
    // A file input gets whichever stored document its label names. When the
    // label does not clearly name one — "Attach a file", or a label mentioning
    // both a resume and a cover letter — nothing is attached, because the
    // wrong file in an upload slot looks answered and reads wrong, and that is
    // harder for a reviewing human to catch than an empty field.
    if (field.kind === "file" || field.inputType === "file") {
      const wanted = documentKindForField(field.label);
      const document = wanted ? documents[wanted] : undefined;

      if (wanted === null) {
        return {
          field,
          action: {
            type: "skip",
            reason: "Cannot tell which document this field wants — attach it yourself.",
          },
          source: "none",
        };
      }
      if (!document) {
        return {
          field,
          action: {
            type: "skip",
            reason: `No ${describeKind(wanted)} is saved. Upload one on the profile screen.`,
          },
          source: "none",
        };
      }

      return {
        field,
        action: {
          type: "attach",
          path: document.absolutePath,
          filename: document.filename,
          mimeType: document.mimeType ?? "application/octet-stream",
          kind: wanted,
        },
        source: "document",
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
