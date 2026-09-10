/**
 * Tests for alert text (spec §28).
 *
 * The one that matters most asserts what is NOT in an alert: no match
 * percentage, because nothing has computed one until Phase 3 ships the fit
 * engine, and printing a number we made up is exactly what spec §3 forbids.
 */

import { describe, it, expect } from "vitest";
import {
  describeAge,
  formatAlert,
  formatAlertBatch,
  MAX_JOBS_PER_MESSAGE,
  type AlertableJob,
} from "./format";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function job(overrides: Partial<AlertableJob> = {}): AlertableJob {
  return {
    id: "job_1",
    title: "Software Engineering Intern",
    companyName: "Stripe",
    location: "NYC / Remote",
    canonicalUrl: "https://stripe.com/jobs/123",
    firstSeenAt: new Date(NOW.getTime() - 2 * HOUR),
    verdict: "keep",
    ...overrides,
  };
}

describe("describeAge", () => {
  it("uses the coarse buckets an alert needs", () => {
    expect(describeAge(new Date(NOW.getTime() - 10 * 60 * 1000), NOW)).toBe("< 1 hour");
    expect(describeAge(new Date(NOW.getTime() - 5 * HOUR), NOW)).toBe("< 24 hours");
    expect(describeAge(new Date(NOW.getTime() - 30 * HOUR), NOW)).toBe("1 day");
    expect(describeAge(new Date(NOW.getTime() - 80 * HOUR), NOW)).toBe("3 days");
  });
});

describe("formatAlert", () => {
  it("matches the shape spec §28 asks for", () => {
    const text = formatAlert(job(), NOW);
    expect(text).toContain("Software Engineering Intern — Stripe");
    expect(text).toContain("Location: NYC / Remote");
    expect(text).toContain("Posted: < 24 hours");
    expect(text).toContain("https://stripe.com/jobs/123");
  });

  it("never claims a match score, because nothing has computed one yet", () => {
    const text = formatAlert(job(), NOW);
    expect(text).not.toMatch(/match/i);
    expect(text).not.toMatch(/\d+%/);
  });

  it("says so when the posting did not state a location", () => {
    expect(formatAlert(job({ location: null }), NOW)).toContain("Location: not stated");
    expect(formatAlert(job({ location: "  " }), NOW)).toContain("Location: not stated");
  });

  it("flags an ambiguous title instead of presenting it as confirmed", () => {
    const text = formatAlert(job({ verdict: "ambiguous" }), NOW);
    expect(text).toContain("unconfirmed");
  });

  it("does not add that caveat to a confident verdict", () => {
    expect(formatAlert(job({ verdict: "keep" }), NOW)).not.toContain("unconfirmed");
  });
});

describe("formatAlertBatch", () => {
  it("returns nothing for an empty batch", () => {
    expect(formatAlertBatch([], NOW)).toBe("");
  });

  it("counts the postings in the heading", () => {
    expect(formatAlertBatch([job()], NOW)).toContain("1 new student-role posting");
    expect(formatAlertBatch([job(), job({ id: "b" })], NOW)).toContain(
      "2 new student-role postings",
    );
  });

  it("caps how many it lists and says how many were left out", () => {
    const many = Array.from({ length: MAX_JOBS_PER_MESSAGE + 4 }, (_, i) =>
      job({ id: `job_${i}`, title: `Intern ${i}` }),
    );
    const text = formatAlertBatch(many, NOW);
    expect(text).toContain("Intern 0");
    expect(text).not.toContain(`Intern ${MAX_JOBS_PER_MESSAGE}`);
    expect(text).toContain("…and 4 more on the dashboard.");
  });
});
