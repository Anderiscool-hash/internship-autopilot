/**
 * Tests for the pure decisions behind the ask panel's "check my email" button.
 *
 * The button itself lives inside PANEL_SCRIPT, a string injected into the
 * employer's page (see the file header comment on why it cannot be a
 * function) — nothing in there can be unit-tested directly. What CAN be
 * tested, and is worth testing, is the two judgments made in plain TypeScript
 * before any of that string runs: whether a given field earns a button at
 * all, and what a mailbox check's result should be shown as. Getting either
 * wrong is the concrete failure this file exists to prevent:
 *
 *   - shouldOfferMailButton wrong -> either a "referral code" field grows a
 *     button that opens a mailbox for no reason, or a real verification field
 *     is left with no way to fetch its code short of typing it by hand.
 *   - classifyMailCheck wrong -> a confirmation LINK gets treated as a code
 *     and typed into the field (see shadow.ts's own comment on why a link is
 *     never followed), or a mailbox that is simply unreachable is reported to
 *     the person as "no mail yet" — which sends them back to press a button
 *     that was never going to work.
 */

import { describe, it, expect } from "vitest";
import { classifyMailCheck, shouldOfferMailButton } from "./ask-overlay";
import { InboxError } from "../email/inbox";
import type { VerificationResult } from "../email/inbox";

function verification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    kind: "code",
    value: "123456",
    subject: "Confirm your email",
    from: "no-reply@greenhouse.io",
    ...overrides,
  };
}

describe("shouldOfferMailButton", () => {
  it("offers the button for a verification field when a mailbox is configured", () => {
    expect(shouldOfferMailButton("Verification code", true)).toBe(true);
    expect(shouldOfferMailButton("Email confirmation code", true)).toBe(true);
  });

  it("never offers the button when no mailbox was configured", () => {
    // Requirement 1: an unconfigured run must behave exactly as it did before
    // this button existed. A verification field with no mailbox to check is
    // just a plain question again.
    expect(shouldOfferMailButton("Verification code", false)).toBe(false);
  });

  it("never offers the button on a field that only looks like one", () => {
    // Referral, promo and course codes read identically to a verification
    // code until you look at the noun in front — isVerificationField already
    // excludes them, and this must not second-guess that.
    expect(shouldOfferMailButton("Referral code", true)).toBe(false);
    expect(shouldOfferMailButton("Promo code", true)).toBe(false);
    expect(shouldOfferMailButton("Course code", true)).toBe(false);
  });

  it("never offers the button on an ordinary field", () => {
    expect(shouldOfferMailButton("Phone number", true)).toBe(false);
  });
});

describe("classifyMailCheck", () => {
  it("reports a code as found, carrying the value and where it came from", () => {
    const outcome = classifyMailCheck(verification({ value: "482913" }));
    expect(outcome).toEqual({
      status: "found",
      value: "482913",
      subject: "Confirm your email",
      from: "no-reply@greenhouse.io",
    });
  });

  it("reports a confirmation link as its own status, never as a found code", () => {
    // This is the branch that matters most: mixing this up would have the
    // panel type a URL into a six-digit code field, or worse, treat the panel
    // as though it should navigate there — shadow.ts's own comment explains
    // why a link is never followed.
    const outcome = classifyMailCheck(verification({ kind: "link", value: "https://x/confirm" }));
    expect(outcome).toEqual({ status: "link", value: "https://x/confirm" });
  });

  it("reports no mail yet as empty, not as an error", () => {
    expect(classifyMailCheck(null)).toEqual({ status: "empty" });
  });

  it("reports a mailbox that could not be reached as an error, using its message", () => {
    const outcome = classifyMailCheck(null, new InboxError("Could not reach the mailbox at x"));
    expect(outcome).toEqual({ status: "error", message: "Could not reach the mailbox at x" });
  });

  it("stringifies a non-InboxError thrown value rather than losing it", () => {
    const outcome = classifyMailCheck(null, "connection reset");
    expect(outcome).toEqual({ status: "error", message: "connection reset" });
  });

  it("treats an error as an error even if a result also happened to be passed", () => {
    // Guards the argument order in checkMailboxOnce's catch block: a caller
    // that accidentally passes both must not have the code silently win.
    const outcome = classifyMailCheck(verification(), new Error("boom"));
    expect(outcome.status).toBe("error");
  });
});
