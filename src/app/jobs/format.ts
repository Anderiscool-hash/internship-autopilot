/**
 * Display formatting for the job dashboard.
 *
 * Pure string functions, kept out of the components so they can be tested
 * without rendering anything.
 *
 * The one rule that shapes all of them: a field the posting never stated is
 * shown as an em dash, never as a plausible-looking default (spec §3). A
 * salary with no currency prints as bare numbers rather than being decorated
 * with a dollar sign we made up.
 */

const NUMBER = new Intl.NumberFormat("en-US");

/** What we print where a posting simply didn't say. */
export const NOT_STATED = "—";

/**
 * Format a posting's pay range.
 *
 * The currency is appended as its code ("USD", "EUR") rather than a symbol:
 * mapping codes to symbols means a lookup table that is wrong for some
 * currencies, and the code is unambiguous everywhere.
 */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
): string {
  if (min === null && max === null) return NOT_STATED;

  const suffix = currency ? ` ${currency}` : "";

  if (min !== null && max !== null) {
    if (min === max) return `${NUMBER.format(min)}${suffix}`;
    return `${NUMBER.format(min)}–${NUMBER.format(max)}${suffix}`;
  }
  if (min !== null) return `${NUMBER.format(min)}+${suffix}`;
  return `up to ${NUMBER.format(max as number)}${suffix}`;
}

/**
 * How long ago we first saw a posting, in the shortest useful unit.
 *
 * Freshness is the thing that actually matters on this screen — an internship
 * posted an hour ago is worth more attention than one from three weeks back —
 * so it gets a compact form that scans down a column.
 */
export function formatAge(date: Date, now: Date): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // Clock skew, or a sourcePostedAt in the future: don't print "-3m ago".
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Turn a database enum (ON_SITE, SAP_SUCCESSFACTORS) into readable text. */
export function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Where a job is, or an em dash when the posting didn't say. */
export function formatLocation(location: string | null): string {
  const trimmed = location?.trim();
  return trimmed ? trimmed : NOT_STATED;
}
