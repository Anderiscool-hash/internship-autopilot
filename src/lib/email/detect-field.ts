/**
 * Spotting the field that is waiting on an email.
 *
 * Pure. Label in, verdict out.
 *
 * Kept narrow on purpose. The cost of a false positive is real: this app would
 * open a mailbox and read mail for a field that was never about email at all.
 * So the label has to say both that it wants a code and that the code came
 * from somewhere — a bare "Code" is not enough, because forms use that for
 * referral codes, promo codes, and course codes.
 */

/** Does this field want a code that was emailed to the candidate? */
export function isVerificationField(label: string): boolean {
  const text = label.toLowerCase();

  // Referral and promo codes look identical to a verification code until you
  // read the noun in front. Excluded first so nothing below can rescue them.
  if (/\b(referral|promo|discount|coupon|course|employee|req(uisition)?)\b/.test(text)) {
    return false;
  }

  const wantsCode = /\b(code|pin|otp|passcode)\b/.test(text);
  if (!wantsCode) return false;

  // The qualifier that makes it *this* kind of code.
  return /\b(verification|verify|confirmation|confirm|security|one[\s-]?time|otp|passcode|email(ed)?|sent)\b/.test(
    text,
  );
}

/**
 * The sending domain to restrict the mailbox search to, from the form's URL.
 *
 * Narrowing the search is the difference between reading one message and
 * reading every message that arrived in the last two minutes. Returns null
 * when the host gives nothing useful, and the caller then searches unfiltered
 * — still bounded by time, just less tightly.
 */
export function senderDomainFor(formUrl: string): string | null {
  let host: string;
  try {
    host = new URL(formUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  // ATS mail comes from the ATS, not from the employer: a Greenhouse form at
  // job-boards.greenhouse.io sends from greenhouse.io. Take the registrable
  // part and let the caller match on it as a substring.
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;

  return parts.slice(-2).join(".");
}
