/**
 * Tests for dashboard filter parsing and URL building.
 *
 * The thing worth protecting here is that junk in the query string never
 * becomes a filter. A `?remote=banana` that silently matched ON_SITE would
 * hide jobs from the user without telling them, which is the one failure mode
 * a job dashboard cannot have.
 */

import { describe, it, expect } from "vitest";
import { AtsType, JobStatus, RemoteType } from "@prisma/client";
import {
  parseJobFilters,
  buildJobWhere,
  buildJobsHref,
  shortlistActive,
  type JobFilters,
} from "./filters";

/** A no-filters baseline, so each test can change just the field it cares about. */
const EMPTY: JobFilters = {
  q: null,
  companyId: null,
  atsType: null,
  remoteType: null,
  withinDays: null,
  verdict: null,
  // The shortlist is the default view, so the "no filters" baseline has it on.
  shortlist: true,
  includeClosed: false,
  eligibility: null,
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
      // An explicit verdict= in the URL turns the shortlist off, so the chip
      // and the shortlist cannot both be narrowing the same rows.
      shortlist: false,
      includeClosed: false,
      eligibility: null,
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

  it("hides closed postings unless they are asked for", () => {
    expect(buildJobWhere(EMPTY, now)).toEqual({ status: JobStatus.OPEN });
    expect(buildJobWhere({ ...EMPTY, includeClosed: true }, now)).toEqual({});
  });

  it("matches titles case-insensitively", () => {
    expect(buildJobWhere({ ...EMPTY, q: "Intern" }, now)).toEqual({
      status: JobStatus.OPEN,
      title: { contains: "Intern", mode: "insensitive" },
    });
  });

  it("turns a day window into a firstSeenAt cutoff", () => {
    const where = buildJobWhere({ ...EMPTY, withinDays: 7 }, now);
    expect(where.firstSeenAt).toEqual({ gte: new Date("2026-09-03T12:00:00.000Z") });
  });

  it("never puts the verdict into SQL — it is not a column", () => {
    const where = buildJobWhere({ ...EMPTY, verdict: "keep" }, now);
    expect(where).toEqual({ status: JobStatus.OPEN });
  });

  it("combines several filters into one clause", () => {
    const where = buildJobWhere(
      { ...EMPTY, companyId: "cmp_1", atsType: AtsType.LEVER, remoteType: RemoteType.HYBRID },
      now,
    );
    expect(where).toEqual({
      status: JobStatus.OPEN,
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

  it("round-trips the include-closed toggle", () => {
    expect(parseJobFilters({ closed: "1" }).includeClosed).toBe(true);
    expect(parseJobFilters({ closed: "on" }).includeClosed).toBe(true);
    expect(parseJobFilters({ closed: "nonsense" }).includeClosed).toBe(false);
    expect(parseJobFilters({}).includeClosed).toBe(false);
    expect(buildJobsHref({ ...EMPTY, includeClosed: true })).toBe("/jobs?closed=1");
  });

  it("carries the eligibility filter, and drops a bogus one", () => {
    expect(parseJobFilters({ eligibility: "eligible" }).eligibility).toBe("eligible");
    expect(parseJobFilters({ eligibility: "banana" }).eligibility).toBeNull();
    expect(buildJobsHref({ ...EMPTY, eligibility: "ineligible" })).toBe(
      "/jobs?eligibility=ineligible",
    );
  });

  it("escapes values that need it", () => {
    expect(buildJobsHref({ ...EMPTY, q: "data science & ml" })).toBe(
      "/jobs?q=data+science+%26+ml",
    );
  });
});

/**
 * The shortlist: the default view that hides rejects and ineligible postings.
 *
 * What these tests are really protecting is that the shortlist and the filter
 * chips can never both be narrowing the same rows. If they could, clicking
 * "reject" would show an empty table — the chip asking for rejects and the
 * shortlist throwing them away — and the reader would have no way to tell
 * that the two had cancelled each other out.
 */
describe("the shortlist", () => {
  it("is on by default, so /jobs opens on postings worth reading", () => {
    expect(parseJobFilters({}).shortlist).toBe(true);
    expect(shortlistActive(parseJobFilters({}))).toBe(true);
  });

  it("is turned off by ?all=1", () => {
    expect(parseJobFilters({ all: "1" }).shortlist).toBe(false);
    expect(parseJobFilters({ all: "on" }).shortlist).toBe(false);
    expect(parseJobFilters({ all: "true" }).shortlist).toBe(false);
  });

  it("ignores an ?all= value that means nothing", () => {
    expect(parseJobFilters({ all: "banana" }).shortlist).toBe(true);
    expect(parseJobFilters({ all: "0" }).shortlist).toBe(true);
    expect(parseJobFilters({ all: "" }).shortlist).toBe(true);
  });

  it("is turned off by an explicit verdict, so the reject chip shows rejects", () => {
    const filters = parseJobFilters({ verdict: "reject" });
    expect(filters.verdict).toBe("reject");
    expect(filters.shortlist).toBe(false);
    expect(shortlistActive(filters)).toBe(false);
  });

  it("is turned off by an explicit eligibility, for the same reason", () => {
    const filters = parseJobFilters({ eligibility: "ineligible" });
    expect(filters.eligibility).toBe("ineligible");
    expect(filters.shortlist).toBe(false);
    expect(shortlistActive(filters)).toBe(false);
  });

  it("is turned off even by a chip value that turned out to be junk", () => {
    // ?verdict=banana is not a verdict, so no verdict filter is applied — but
    // the shortlist still steps aside. Erring toward showing MORE postings is
    // the only safe direction: a view that shows extra rows cannot hide a job
    // from you, and a view that shows fewer can.
    const filters = parseJobFilters({ verdict: "banana" });
    expect(filters.verdict).toBeNull();
    expect(filters.shortlist).toBe(false);
    expect(parseJobFilters({ eligibility: "banana" }).shortlist).toBe(false);
  });

  it("stays on when a chip parameter is present but empty", () => {
    // `?verdict=` is what an unset form field looks like, not a request.
    expect(parseJobFilters({ verdict: "" }).shortlist).toBe(true);
    expect(parseJobFilters({ eligibility: "   " }).shortlist).toBe(true);
  });

  it("never claims to be active while a chip is set", () => {
    // A hand-built filter set can hold this contradiction; shortlistActive is
    // the one place that settles it, so every caller resolves it the same way.
    expect(shortlistActive({ ...EMPTY, shortlist: true, verdict: "keep" })).toBe(false);
    expect(
      shortlistActive({ ...EMPTY, shortlist: true, eligibility: "eligible" }),
    ).toBe(false);
  });
});

describe("buildJobsHref and the shortlist", () => {
  it("writes nothing for the default on state", () => {
    expect(buildJobsHref(EMPTY)).toBe("/jobs");
  });

  it("writes ?all=1 when the shortlist is off", () => {
    expect(buildJobsHref({ ...EMPTY, shortlist: false })).toBe("/jobs?all=1");
  });

  it("round-trips through parse in both directions", () => {
    const off = parseJobFilters({ all: "1" });
    expect(buildJobsHref(off)).toBe("/jobs?all=1");
    expect(parseJobFilters({ all: "1" }).shortlist).toBe(false);

    const backOn = buildJobsHref(off, {
      shortlist: true,
      verdict: null,
      eligibility: null,
    });
    expect(backOn).toBe("/jobs");
    expect(parseJobFilters({}).shortlist).toBe(true);
  });

  it("gives the headline's show-everything link, keeping the other filters", () => {
    const filters = parseJobFilters({ q: "intern", days: "7", page: "4" });
    expect(buildJobsHref(filters, { shortlist: false })).toBe(
      "/jobs?q=intern&days=7&all=1",
    );
  });

  it("gives a back-to-the-shortlist link from a verdict chip view", () => {
    const filters = parseJobFilters({ q: "intern", verdict: "reject" });
    expect(
      buildJobsHref(filters, { shortlist: true, verdict: null, eligibility: null }),
    ).toBe("/jobs?q=intern");
  });

  it("does not add ?all=1 alongside a chip that already implies it", () => {
    // Belt and braces in the URL would be noise: parseJobFilters already reads
    // verdict= as "shortlist off".
    expect(buildJobsHref(EMPTY, { verdict: "reject" })).toBe("/jobs?verdict=reject");
    expect(buildJobsHref(EMPTY, { eligibility: "ineligible" })).toBe(
      "/jobs?eligibility=ineligible",
    );
    expect(buildJobsHref({ ...EMPTY, shortlist: false }, { verdict: "keep" })).toBe(
      "/jobs?verdict=keep",
    );
  });

  it("keeps the shortlist off across pagination", () => {
    const filters = parseJobFilters({ all: "1", page: "2" });
    expect(buildJobsHref(filters, { page: 3 })).toBe("/jobs?all=1&page=3");
    expect(parseJobFilters({ all: "1", page: "3" }).shortlist).toBe(false);
  });

  it("keeps the shortlist on across pagination", () => {
    expect(buildJobsHref(EMPTY, { page: 2 })).toBe("/jobs?page=2");
    expect(parseJobFilters({ page: "2" }).shortlist).toBe(true);
  });

  it("returns to the shortlist when a verdict chip is cleared from a chip view", () => {
    // Clicking "All" from ?verdict=keep: the shortlist was off, and it stays
    // off, because the reader asked to see everything and never asked to go
    // back. ?all=1 now has to carry that, since verdict= no longer does.
    const filters = parseJobFilters({ verdict: "keep" });
    expect(buildJobsHref(filters, { verdict: null })).toBe("/jobs?all=1");
  });
});
