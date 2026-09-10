/**
 * Tests for building an ATS-native application URL.
 *
 * Written after a live preflight parsed a Coinbase posting as zero fields: the
 * canonical URL was the company's own careers page, and the Greenhouse form
 * was never on it.
 */

import { describe, it, expect } from "vitest";
import { applicationUrlFor } from "./application-url";

const CANONICAL = "https://www.coinbase.com/careers/positions/8175363?gh_jid=8175363";

describe("applicationUrlFor", () => {
  it("uses the Greenhouse embed endpoint, not the hosted board page", () => {
    // The hosted board redirects to the employer's own careers page for any
    // company that has one, and the form is in an iframe there. Verified
    // against Coinbase: the board page parses as 0 inputs, the embed as 58.
    expect(
      applicationUrlFor({
        atsType: "GREENHOUSE",
        atsIdentifier: "coinbase",
        sourceJobId: "8175363",
        canonicalUrl: CANONICAL,
      }),
    ).toContain("/embed/job_app");
  });

  it("builds the hosted form URL for each supported ATS", () => {
    expect(
      applicationUrlFor({
        atsType: "GREENHOUSE",
        atsIdentifier: "coinbase",
        sourceJobId: "8175363",
        canonicalUrl: CANONICAL,
      }),
    ).toBe("https://job-boards.greenhouse.io/embed/job_app?for=coinbase&token=8175363");

    expect(
      applicationUrlFor({
        atsType: "LEVER",
        atsIdentifier: "palantir",
        sourceJobId: "abc-123",
        canonicalUrl: CANONICAL,
      }),
    ).toBe("https://jobs.lever.co/palantir/abc-123/apply");

    expect(
      applicationUrlFor({
        atsType: "ASHBY",
        atsIdentifier: "ramp",
        sourceJobId: "xyz",
        canonicalUrl: CANONICAL,
      }),
    ).toBe("https://jobs.ashbyhq.com/ramp/xyz/application");
  });

  it("falls back to the canonical URL when the board slug was never confirmed", () => {
    expect(
      applicationUrlFor({
        atsType: "GREENHOUSE",
        atsIdentifier: null,
        sourceJobId: "8175363",
        canonicalUrl: CANONICAL,
      }),
    ).toBe(CANONICAL);
  });

  it("falls back for an ATS with no known form URL pattern", () => {
    expect(
      applicationUrlFor({
        atsType: "WORKDAY",
        atsIdentifier: "acme",
        sourceJobId: "1",
        canonicalUrl: CANONICAL,
      }),
    ).toBe(CANONICAL);
  });

  it("escapes identifiers rather than pasting them into a URL", () => {
    const url = applicationUrlFor({
      atsType: "GREENHOUSE",
      atsIdentifier: "a b/c",
      sourceJobId: "1 2",
      canonicalUrl: CANONICAL,
    });
    expect(url).toBe(
      "https://job-boards.greenhouse.io/embed/job_app?for=a%20b%2Fc&token=1%202",
    );
  });
});
