import { describe, expect, it } from "vitest";
import {
  extractVerificationCode,
  extractVerificationLink,
  findVerification,
} from "./extract-code";

describe("extractVerificationCode", () => {
  it("reads the code out of the usual wordings", () => {
    expect(extractVerificationCode("Your verification code is 481920.")).toBe("481920");
    expect(extractVerificationCode("Confirmation code: 55213")).toBe("55213");
    expect(extractVerificationCode("Use one-time passcode 830192 to continue.")).toBe("830192");
    expect(extractVerificationCode("Your security code is 4821")).toBe("4821");
  });

  // The reason the context phrase is required at all.
  it("does not mistake a requisition or phone number for a code", () => {
    expect(
      extractVerificationCode("Thanks for applying to requisition 884213. We will be in touch."),
    ).toBeNull();
    expect(extractVerificationCode("Call us on 5551234567 with questions.")).toBeNull();
  });

  it("returns nothing when two plausible codes appear", () => {
    // Not a decision this should make on the candidate's behalf.
    expect(
      extractVerificationCode("Your verification code is 481920, replacing code 220418."),
    ).toBeNull();
  });

  it("ignores a year sitting next to the code wording", () => {
    expect(extractVerificationCode("Verification code issued 2026")).toBeNull();
  });

  it("finds nothing in a mail that has no code", () => {
    expect(extractVerificationCode("Thanks for your application. We received it.")).toBeNull();
  });
});

describe("extractVerificationLink", () => {
  it("finds a confirmation link among the usual clutter", () => {
    const mail = [
      "Welcome! Please confirm your address:",
      "https://jobs.example.com/verify?token=abc123",
      "Careers: https://example.com/careers",
      "Unsubscribe: https://example.com/unsubscribe?u=9",
    ].join("\n");

    expect(extractVerificationLink(mail)).toBe("https://jobs.example.com/verify?token=abc123");
  });

  // Following this would quietly opt the candidate out of the employer's mail.
  it("never follows an unsubscribe link, even one saying confirm", () => {
    const mail = "https://example.com/unsubscribe/confirm?u=9";
    expect(extractVerificationLink(mail)).toBeNull();
  });

  it("returns nothing when several links could be the one", () => {
    const mail = "https://a.com/verify?t=1 and https://b.com/confirm?t=2";
    expect(extractVerificationLink(mail)).toBeNull();
  });
});

describe("findVerification", () => {
  it("prefers a code over a link when the mail carries both", () => {
    // A link navigates away from a half-filled form; a code is typed into it.
    const mail = "Your verification code is 481920, or click https://x.com/verify?t=1";
    expect(findVerification(mail)).toEqual({ kind: "code", value: "481920" });
  });

  it("falls back to the link when there is no code", () => {
    const mail = "Confirm your email: https://x.com/verify?t=1";
    expect(findVerification(mail)).toEqual({ kind: "link", value: "https://x.com/verify?t=1" });
  });

  it("returns null for an ordinary acknowledgement mail", () => {
    expect(findVerification("We have received your application. Thank you.")).toBeNull();
  });
});
