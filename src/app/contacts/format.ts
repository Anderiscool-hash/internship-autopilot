/**
 * Display formatting for the contacts screen.
 *
 * Pure string functions, kept out of the page so they can be tested without
 * rendering anything — the same split as src/app/jobs/format.ts, and for the
 * same reason: this repository has no component test harness, so the logic
 * worth asserting has to live somewhere a plain vitest run can reach it.
 *
 * The status names are declared here as string unions rather than imported
 * from @prisma/client on purpose. It keeps the test runnable with no
 * generated Prisma client, which matters on Windows where `prisma generate`
 * fails with EPERM whenever any repo node process is holding the query
 * engine DLL. The unions are checked against the real enums at the call site
 * in page.tsx, where a Prisma enum value flows into these functions.
 */

/** Mirrors ContactEmailStatus. There is deliberately no GRAVATAR_MISS. */
export type EmailStatusName =
  | "GUESSED"
  | "GRAVATAR_HIT"
  | "API_VERIFIED"
  | "BOUNCED"
  | "CONFIRMED";

/** Mirrors OutreachStatus. There is no SENDING: this app never sends. */
export type OutreachStatusName = "DRAFT" | "SENT" | "BOUNCED" | "REPLIED";

/** What a contact with no addresses yet shows in the confidence column. */
export const CONFIDENCE_UNKNOWN = "—";

/**
 * Turn a 0-100 score into a word.
 *
 * The bands are wide on purpose. The score is built from population priors
 * and a Gravatar probe, and presenting "63%" would imply a precision that
 * scoreAddress() does not have. Four words carry everything the person can
 * actually act on: is this worth an email, or should discovery run again?
 */
export function confidenceLabel(confidence: number): string {
  if (!Number.isFinite(confidence)) return CONFIDENCE_UNKNOWN;
  if (confidence >= 80) return "strong";
  if (confidence >= 55) return "likely";
  if (confidence >= 25) return "weak";
  return "guess";
}

/**
 * The badge class for a confidence score.
 *
 * Colour in this design system is reserved for meaning (globals.css:958,
 * "the only place semantic colour appears"), so a low score is grey rather
 * than red: a guess is not a failure, it is the normal state of a new
 * contact. Red belongs to a bounce, which is the one thing here that is
 * actually wrong.
 */
export function confidenceBadgeClass(confidence: number): string {
  if (!Number.isFinite(confidence)) return "badge badge-closed";
  if (confidence >= 80) return "badge badge-keep";
  if (confidence >= 55) return "badge badge-ambiguous";
  return "badge badge-closed";
}

/** The badge class for one candidate address's state. */
export function emailStatusBadgeClass(status: EmailStatusName): string {
  switch (status) {
    case "CONFIRMED":
      return "badge badge-keep";
    case "API_VERIFIED":
    case "GRAVATAR_HIT":
      // Real evidence, but not a reply. Warning-tinted reads as
      // "promising, unproven" — the same meaning badge-elig-unconfirmed
      // carries on the jobs table.
      return "badge badge-ambiguous";
    case "BOUNCED":
      return "badge badge-reject";
    case "GUESSED":
    default:
      return "badge badge-closed";
  }
}

/** The badge class for one outreach message's fate. */
export function outreachStatusBadgeClass(status: OutreachStatusName): string {
  switch (status) {
    case "REPLIED":
      return "badge badge-keep";
    case "BOUNCED":
      return "badge badge-reject";
    case "SENT":
      // An accent badge, not a green one: sending is an action taken, not a
      // good outcome. Green here would congratulate the person for pressing
      // a button.
      return "badge badge-outcome";
    case "DRAFT":
    default:
      return "badge badge-closed";
  }
}

/**
 * How a follow-up date reads in a list.
 *
 * Nothing acts on a follow-up date (design §8: "A date the UI surfaces;
 * nothing acts on it"), so the only job here is to make an overdue one
 * impossible to scroll past.
 */
export function followUpLabel(followUpAt: Date, now: Date): string {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  const days = Math.round(
    (startOfDay(followUpAt) - startOfDay(now)) / (24 * 60 * 60 * 1000),
  );

  if (days === 0) return "follow up today";
  if (days === 1) return "follow up tomorrow";
  if (days > 1) return `follow up in ${days}d`;
  if (days === -1) return "follow up was yesterday";
  return `follow up was ${Math.abs(days)}d ago`;
}

/** True when a follow-up date has arrived or passed. */
export function followUpDue(followUpAt: Date, now: Date): boolean {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return startOfDay(followUpAt) <= startOfDay(now);
}
