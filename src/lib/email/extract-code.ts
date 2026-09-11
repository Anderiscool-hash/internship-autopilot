/**
 * Pulling a verification code or link out of an email.
 *
 * Some application portals will not let you past the first page until you
 * confirm your address: they mail a six-digit code, or a "confirm your email"
 * link, and the form waits. Fetching that by hand means leaving the run
 * half-finished, switching to a mail client, and coming back — which is
 * exactly the kind of interruption this app exists to remove.
 *
 * Pure: text in, a code out. No mailbox, no network, so every rule about what
 * counts as a code is testable without an inbox.
 *
 * The bias here is toward finding NOTHING. A wrong code typed into a real
 * employer's form locks the flow — most portals allow three attempts — so an
 * ambiguous mail returns null and the person is asked instead.
 */

/** What was found in a message, if anything. */
export interface VerificationFinding {
  kind: "code" | "link";
  value: string;
}

/**
 * Phrases that mark the sentence actually carrying the code.
 *
 * Required, rather than grabbing the first number in the mail. A recruiting
 * email is full of digit runs that are not codes — a job requisition number, a
 * street address, a phone number, a year — and "the first six digits" picks
 * the wrong one often enough to be useless.
 */
const CODE_CONTEXT =
  /(verification|confirmation|security|one[\s-]?time|access|login|sign[\s-]?in|passcode|otp)\W{0,40}(code|pin|password)?|(code|pin)\W{0,20}(is|:)/i;

/** A standalone run of 4-8 digits, or two groups like "123 456". */
const CODE_PATTERN = /\b(\d{4,8})\b/g;

/**
 * Digit runs that are something else wearing a code's clothes.
 *
 * Deliberately short. An earlier version also rejected a five-digit run at the
 * end of a line as a US zip code, which threw away "Confirmation code: 55213"
 * — a perfectly ordinary code in a perfectly ordinary mail. The requirement
 * that a candidate sit next to wording announcing a code already excludes
 * address blocks, and the "exactly one candidate" rule covers the rest.
 */
const NOT_A_CODE = [
  /^(19|20)\d{2}$/, // a year
];

/**
 * Find a verification code in a message.
 *
 * Returns null unless the code appears near wording that says it is one, and
 * unless exactly one candidate survives. Two plausible codes in one mail is
 * not a decision this should make.
 */
export function extractVerificationCode(text: string): string | null {
  if (!CODE_CONTEXT.test(text)) return null;

  // Look only at the neighbourhood of the phrase that announces a code, so a
  // signature block or a footer cannot contribute a candidate.
  const match = CODE_CONTEXT.exec(text);
  if (match === null) return null;
  const start = Math.max(0, match.index - 80);
  const window = text.slice(start, match.index + 200);

  const candidates = new Set<string>();
  for (const found of window.matchAll(CODE_PATTERN)) {
    const digits = found[1];
    if (digits === undefined) continue;
    if (NOT_A_CODE.some((pattern) => pattern.test(digits))) continue;
    candidates.add(digits);
  }

  if (candidates.size !== 1) return null;
  return [...candidates][0] ?? null;
}

/**
 * Find a confirmation link in a message.
 *
 * Narrower than "the first URL": a recruiting mail links to the careers page,
 * an unsubscribe endpoint, a privacy policy and a logo. Only a URL whose own
 * path says it confirms something is treated as the one to follow.
 */
export function extractVerificationLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];

  const confirming = urls.filter((url) =>
    /verify|verification|confirm|activate|validate/i.test(url),
  );

  // An unsubscribe link can contain "confirm" too, and following one would
  // quietly opt the candidate out of the employer's mail.
  const safe = confirming.filter((url) => !/unsubscribe|opt[-_]?out|preferences/i.test(url));

  if (safe.length !== 1) return null;
  return safe[0] ?? null;
}

/**
 * What this message offers, preferring a code.
 *
 * A code is typed into the page that is already open; a link navigates away
 * from a half-filled form, which risks losing everything entered so far. So
 * when a mail carries both — many do — the code wins.
 */
export function findVerification(text: string): VerificationFinding | null {
  const code = extractVerificationCode(text);
  if (code !== null) return { kind: "code", value: code };

  const link = extractVerificationLink(text);
  if (link !== null) return { kind: "link", value: link };

  return null;
}
