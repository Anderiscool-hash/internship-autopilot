/**
 * The contacts screen's pure view logic.
 *
 * These are the only tests in this feature's UI: the repository has no
 * component or E2E harness (no @testing-library, no jsdom, no vitest.config),
 * so the page and its server actions are verified by `npm run typecheck` and
 * a manual browser pass instead. What can be asserted is asserted here.
 */

import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_UNKNOWN,
  confidenceBadgeClass,
  confidenceLabel,
  emailStatusBadgeClass,
  followUpDue,
  followUpLabel,
  outreachStatusBadgeClass,
} from "./format";

describe("confidenceLabel", () => {
  it("bands the whole 0-100 range", () => {
    expect(confidenceLabel(0)).toBe("guess");
    expect(confidenceLabel(24)).toBe("guess");
    expect(confidenceLabel(25)).toBe("weak");
    expect(confidenceLabel(54)).toBe("weak");
    expect(confidenceLabel(55)).toBe("likely");
    expect(confidenceLabel(79)).toBe("likely");
    expect(confidenceLabel(80)).toBe("strong");
    expect(confidenceLabel(100)).toBe("strong");
  });

  it("never invents a number for a missing score", () => {
    expect(confidenceLabel(Number.NaN)).toBe(CONFIDENCE_UNKNOWN);
  });
});

describe("confidenceBadgeClass", () => {
  // Colour is reserved for meaning in this design system (globals.css:958).
  // A guessed address is the normal state of a new contact, not an error,
  // so it must not be red — red belongs to a bounce alone.
  it("never paints a low score as a failure", () => {
    expect(confidenceBadgeClass(0)).toBe("badge badge-closed");
    expect(confidenceBadgeClass(24)).toBe("badge badge-closed");
    expect(confidenceBadgeClass(54)).toBe("badge badge-closed");
  });

  it("escalates only as the evidence does", () => {
    expect(confidenceBadgeClass(55)).toBe("badge badge-ambiguous");
    expect(confidenceBadgeClass(80)).toBe("badge badge-keep");
  });

  it("only uses classes globals.css actually defines", () => {
    const allowed = new Set([
      "badge",
      "badge-keep",
      "badge-ambiguous",
      "badge-reject",
      "badge-closed",
      "badge-outcome",
    ]);
    for (const score of [0, 25, 55, 80, 100, Number.NaN]) {
      for (const token of confidenceBadgeClass(score).split(" ")) {
        expect(allowed.has(token)).toBe(true);
      }
    }
  });
});

describe("emailStatusBadgeClass", () => {
  it("reds only the bounce", () => {
    expect(emailStatusBadgeClass("BOUNCED")).toBe("badge badge-reject");
    expect(emailStatusBadgeClass("GUESSED")).toBe("badge badge-closed");
    expect(emailStatusBadgeClass("GRAVATAR_HIT")).toBe("badge badge-ambiguous");
    expect(emailStatusBadgeClass("API_VERIFIED")).toBe("badge badge-ambiguous");
    expect(emailStatusBadgeClass("CONFIRMED")).toBe("badge badge-keep");
  });
});

describe("outreachStatusBadgeClass", () => {
  it("distinguishes an action taken from a good outcome", () => {
    expect(outreachStatusBadgeClass("DRAFT")).toBe("badge badge-closed");
    expect(outreachStatusBadgeClass("SENT")).toBe("badge badge-outcome");
    expect(outreachStatusBadgeClass("REPLIED")).toBe("badge badge-keep");
    expect(outreachStatusBadgeClass("BOUNCED")).toBe("badge badge-reject");
  });
});

describe("followUpLabel", () => {
  const now = new Date(2026, 8, 19, 14, 0, 0);

  it("reads in days, from either direction", () => {
    expect(followUpLabel(new Date(2026, 8, 19, 8, 0, 0), now)).toBe("follow up today");
    expect(followUpLabel(new Date(2026, 8, 20), now)).toBe("follow up tomorrow");
    expect(followUpLabel(new Date(2026, 8, 23), now)).toBe("follow up in 4d");
    expect(followUpLabel(new Date(2026, 8, 18), now)).toBe("follow up was yesterday");
    expect(followUpLabel(new Date(2026, 8, 12), now)).toBe("follow up was 7d ago");
  });

  // A follow-up set for this morning is due now, not tomorrow. Comparing
  // instants rather than days would hide it until midnight.
  it("treats any time today as due", () => {
    expect(followUpDue(new Date(2026, 8, 19, 23, 59), now)).toBe(true);
    expect(followUpDue(new Date(2026, 8, 20, 0, 1), now)).toBe(false);
  });
});
