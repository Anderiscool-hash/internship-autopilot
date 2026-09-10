/**
 * Tests for dashboard filter parsing and URL building.
 *
 * The thing worth protecting here is that junk in the query string never
 * becomes a filter. A `?remote=banana` that silently matched ON_SITE would
 * hide jobs from the user without telling them, which is the one failure mode
 * a job dashboard cannot have.
 */

import { describe, it, expect } from "vitest";
import { AtsType, RemoteType } from "@prisma/client";
import { parseJobFilters, buildJobWhere, buildJobsHref, type JobFilters } from "./filters";

/** A no-filters baseline, so each test can change just the field it cares about. */
const EMPTY: JobFilters = {
  q: null,
  companyId: null,
  atsType: null,
  remoteType: null,
  withinDays: null,
  verdict: null,
  page: 1,
};

describe("parseJobFilters", () => {
  it("returns no filters for an empty query string", () => {
    expect(parseJobFilters({})).toEqual(EMPTY);
  });

  it("reads every supported filter", () => {
    const filters = parseJobFilters({
      q: "software intern",
      company: "cmp_123",
      ats: "GREENHOUSE",
      remote: "REMOTE",
      days: "7",
      verdict: "keep",
      page: "3",
    });

    expect(filters).toEqual({
      q: "software intern",
      companyId: "cmp_123",
      atsType: AtsType.GREENHOUSE,
      remoteType: RemoteType.REMOTE,
      withinDays: 7,
      verdict: "keep",
      page: 3,
    });
  });

  it("trims whitespace and treats a blank search as no search", () => {
    expect(parseJobFilters({ q: "  intern  " }).q).toBe("intern");
    expect(parseJobFilters({ q: "   " }).q).toBeNull();
    expect(parseJobFilters({ q: "" }).q).toBeNull();
  });

  it("drops values that are not valid enum members", () => {
    const filters = parseJobFilters({
      ats: "banana",
      remote: "banana",
      verdict: "banana",
    });

    expect(filters.atsType).toBeNull();
    expect(filters.remoteType).toBeNull();
    expect(filters.verdict).toBeNull();
  });

  it("rejects a day window that is not one of the offered choices", () => {
    expect(parseJobFilters({ days: "7" }).withinDays).toBe(7);
    expect(parseJobFilters({ days: "9" }).withinDays).toBeNull();
    expect(parseJobFilters({ days: "100000" }).withinDays).toBeNull();
    expect(parseJobFilters({ days: "-7" }).withinDays).toBeNull();
    expect(parseJobFilters({ days: "abc" }).withinDays).toBeNull();
  });

  it("falls back to page 1 for junk, zero, or negative pages", () => {
    expect(parseJobFilters({ page: "0" }).page).toBe(1);
    expect(parseJobFilters({ page: "-2" }).page).toBe(1);
    expect(parseJobFilters({ page: "abc" }).page).toBe(1);
  });

  it("truncates a fractional page rather than rejecting it", () => {
    // parseInt stops at the decimal point, so ?page=2.7 lands on page 2.
    // Nobody types that, but a rounded value is a friendlier answer than
    // bouncing them to page 1.
    expect(parseJobFilters({ page: "2.7" }).page).toBe(2);
  });

  it("takes the first value when a key is repeated", () => {
    expect(parseJobFilters({ q: ["intern", "analyst"] }).q).toBe("intern");
  });
});

describe("buildJobWhere", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");

  it("produces an empty clause when nothing is filtered", () => {
    expect(buildJobWhere(EMPTY, now)).toEqual({});
  });

  it("matches titles case-insensitively", () => {
    expect(buildJobWhere({ ...EMPTY, q: "Intern" }, now)).toEqual({
      title: { contains: "Intern", mode: "insensitive" },
    });
  });

  it("turns a day window into a firstSeenAt cutoff", () => {
    const where = buildJobWhere({ ...EMPTY, withinDays: 7 }, now);
    expect(where.firstSeenAt).toEqual({ gte: new Date("2026-09-03T12:00:00.000Z") });
  });

  it("never puts the verdict into SQL — it is not a column", () => {
    const where = buildJobWhere({ ...EMPTY, verdict: "keep" }, now);
    expect(where).toEqual({});
  });

  it("combines several filters into one clause", () => {
    const where = buildJobWhere(
      { ...EMPTY, companyId: "cmp_1", atsType: AtsType.LEVER, remoteType: RemoteType.HYBRID },
      now,
    );
    expect(where).toEqual({
      companyId: "cmp_1",
      atsType: AtsType.LEVER,
      remoteType: RemoteType.HYBRID,
    });
  });
});

describe("buildJobsHref", () => {
  it("omits every default, leaving a clean path", () => {
    expect(buildJobsHref(EMPTY)).toBe("/jobs");
  });

  it("keeps the current filters when only the page changes", () => {
    const href = buildJobsHref({ ...EMPTY, q: "intern", verdict: "keep" }, { page: 2 });
    expect(href).toBe("/jobs?q=intern&verdict=keep&page=2");
  });

  it("returns to page 1 when a filter other than the page changes", () => {
    const href = buildJobsHref({ ...EMPTY, q: "intern", page: 5 }, { verdict: "reject" });
    expect(href).toBe("/jobs?q=intern&verdict=reject");
  });

  it("can clear a filter by setting it back to null", () => {
    expect(buildJobsHref({ ...EMPTY, verdict: "keep" }, { verdict: null })).toBe("/jobs");
  });

  it("escapes values that need it", () => {
    expect(buildJobsHref({ ...EMPTY, q: "data science & ml" })).toBe(
      "/jobs?q=data+science+%26+ml",
    );
  });
});
