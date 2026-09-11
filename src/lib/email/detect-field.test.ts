import { describe, expect, it } from "vitest";
import { isVerificationField, senderDomainFor } from "./detect-field";

describe("isVerificationField", () => {
  it("recognizes the wordings portals actually use", () => {
    expect(isVerificationField("Verification code")).toBe(true);
    expect(isVerificationField("Enter the confirmation code we emailed you")).toBe(true);
    expect(isVerificationField("One-time passcode")).toBe(true);
    expect(isVerificationField("Security code")).toBe(true);
    expect(isVerificationField("Code sent to your email")).toBe(true);
  });

  // The false positives that would make this app open a mailbox for no reason.
  it("ignores codes that have nothing to do with email", () => {
    expect(isVerificationField("Referral code")).toBe(false);
    expect(isVerificationField("Promo code")).toBe(false);
    expect(isVerificationField("Requisition code")).toBe(false);
    expect(isVerificationField("Employee referral code")).toBe(false);
  });

  it("is not satisfied by a bare 'Code'", () => {
    // Forms use it for too many things to guess from.
    expect(isVerificationField("Code")).toBe(false);
  });

  it("ignores ordinary fields", () => {
    expect(isVerificationField("Email")).toBe(false);
    expect(isVerificationField("Postal code")).toBe(false);
    expect(isVerificationField("First name")).toBe(false);
  });
});

describe("senderDomainFor", () => {
  it("takes the registrable domain, since ATS mail comes from the ATS", () => {
    expect(senderDomainFor("https://job-boards.greenhouse.io/embed/job_app?for=x")).toBe(
      "greenhouse.io",
    );
    expect(senderDomainFor("https://jobs.lever.co/acme/123")).toBe("lever.co");
  });

  it("returns null when there is nothing to narrow by", () => {
    expect(senderDomainFor("not a url")).toBeNull();
    expect(senderDomainFor("http://localhost:3000/form")).toBeNull();
  });
});
