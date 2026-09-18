/**
 * Tests for the ordering rules behind the dashboard's sortable columns.
 *
 * The database plumbing in query.ts needs Postgres, but the two decisions that
 * can actually be wrong are pure functions: which ORDER BY a column turns
 * into, and where a job with no fit score ends up. Both are tested here.
 *
 * The rule worth protecting: a MISSING value is not a LOW value. A job that
 * lists no salary did not offer $0, and a job we could not score is not a bad
 * fit. Sorting either of them to the top of "lowest first" would present a
 * blank as a fact, which is the one thing this codebase is built not to do.
 */

import { describe, it, expect } from "vitest";
import { buildSortOrder, sortByFit } from "./query";
import type { JobFilters } from "./filters";
import type { FitResult } from "../fit/score";

/** A no-filters baseline; each test changes only the sort it cares about. */
const EMPTY: JobFilters = {
  q: null,
  companyId: null,
  atsType: null,
  remoteType: null,
  withinDays: null,
  verdict: null,
  shortlist: true,
  includeClosed: false,
  eligibility: null,
  sort: "seen",
  dir: "desc",
  page: 1,
};

/** Shorthand for "the filters, but sorted like this". */
function sortedBy(sort: JobFilters["sort"], dir: JobFilters["dir"]): JobFilters {
  return { ...EMPTY, sort, dir };
}

/** A fit result carrying just the score; nothing here reads the rest. */
function fit(score: number | null): FitResult {
  return { score, components: [], coverage: score === null ? 0 : 1 };
}

describe("buildSortOrder", () => {
  it("defaults to newest first, exactly as the dashboard always was", () => {
    expect(buildSortOrder(EMPTY)).toEqual([{ firstSeenAt: "desc" }, { id: "desc" }]);
  });

  it("orders by the title column for the Role header", () => {
    expect(buildSortOrder(sortedBy("title", "asc"))).toEqual([
      { title: "asc" },
      { id: "desc" },
    ]);
    expect(buildSortOrder(sortedBy("title", "desc"))).toEqual([
      { title: "desc" },
      { id: "desc" },
    ]);
  });

  it("orders company through the relation, since the name is not a Job column", () => {
    expect(buildSortOrder(sortedBy("company", "asc"))).toEqual([
      { company: { name: "asc" } },
      { id: "desc" },
    ]);
  });

  it("puts jobs with no pay last in BOTH directions", () => {
    // The point of the whole rule: "lowest pay first" must not open with every
    // posting that never mentioned pay, as though we knew they paid nothing.
    expect(buildSortOrder(sortedBy("pay", "asc"))).toEqual([
      { salaryMin: { sort: "asc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(buildSortOrder(sortedBy("pay", "desc"))).toEqual([
      { salaryMin: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
  });

  it("puts jobs with no location last in both directions too", () => {
    expect(buildSortOrder(sortedBy("location", "asc"))).toEqual([
      { location: { sort: "asc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(buildSortOrder(sortedBy("location", "desc"))).toEqual([
      { location: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
  });

  it("falls back to the default order for fit, which SQL cannot sort", () => {
    // Fit is scored in TypeScript, so the query fetches in the usual order and
    // the in-memory sort takes over afterwards — or doesn't, over the cap, in
    // which case this is the order the reader actually sees.
    expect(buildSortOrder(sortedBy("fit", "desc"))).toEqual([
      { firstSeenAt: "desc" },
      { id: "desc" },
    ]);
    expect(buildSortOrder(sortedBy("fit", "asc"))).toEqual([
      { firstSeenAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("always ends with a tiebreaker no two rows can share", () => {
    // Without this, rows that tie on the first key can come back in a
    // different order for page 1 than for page 2 — showing one job twice and
    // hiding another.
    for (const sort of ["seen", "title", "company", "location", "pay", "fit"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const order = buildSortOrder(sortedBy(sort, dir));
        expect(order[order.length - 1]).toEqual({ id: "desc" });
      }
    }
  });
});

describe("sortByFit", () => {
  const jobs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const scores = new Map<string, FitResult | null>([
    ["a", fit(40)],
    ["b", fit(90)],
    ["c", null], // never scored — no profile match, or ruled ineligible
    ["d", fit(65)],
  ]);

  it("puts the best fit first when sorting descending", () => {
    expect(sortByFit(jobs, scores, "desc").map((job) => job.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("puts the worst fit first when sorting ascending", () => {
    expect(sortByFit(jobs, scores, "asc").map((job) => job.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("keeps unscored jobs LAST in both directions — unknown is not zero", () => {
    // This is the whole test file's reason for existing. An unscored job at
    // the top of "worst fit first" would read as the engine's judgment that it
    // is a terrible match, which it never made.
    expect(sortByFit(jobs, scores, "asc").at(-1)?.id).toBe("c");
    expect(sortByFit(jobs, scores, "desc").at(-1)?.id).toBe("c");
  });

  it("treats a FitResult whose score is null as unscored, not as a zero", () => {
    // The engine returns a result with score: null when too little of the
    // profile could be compared (MIN_COVERAGE in fit/score.ts). That is just
    // as unknown as having no result at all.
    const withNullScore = new Map<string, FitResult | null>([
      ["a", fit(10)],
      ["b", fit(null)],
    ]);
    expect(sortByFit([{ id: "a" }, { id: "b" }], withNullScore, "asc").map((j) => j.id))
      .toEqual(["a", "b"]);
    expect(sortByFit([{ id: "a" }, { id: "b" }], withNullScore, "desc").map((j) => j.id))
      .toEqual(["a", "b"]);
  });

  it("treats a job missing from the score map as unscored", () => {
    const partial = new Map<string, FitResult | null>([["b", fit(50)]]);
    expect(sortByFit([{ id: "a" }, { id: "b" }], partial, "desc").map((j) => j.id))
      .toEqual(["b", "a"]);
  });

  it("keeps ties in the order they arrived, so fit ties break by newest", () => {
    // The incoming list is already newest-first, and a stable sort preserves
    // that — so "sort by fit" really means "by fit, then by newest".
    const tied = new Map<string, FitResult | null>([
      ["newest", fit(70)],
      ["middle", fit(70)],
      ["oldest", fit(70)],
    ]);
    const order = sortByFit(
      [{ id: "newest" }, { id: "middle" }, { id: "oldest" }],
      tied,
      "desc",
    );
    expect(order.map((job) => job.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("does not modify the list it was given", () => {
    const original = [{ id: "a" }, { id: "b" }];
    sortByFit(original, scores, "desc");
    expect(original.map((job) => job.id)).toEqual(["a", "b"]);
  });

  it("handles an empty list", () => {
    expect(sortByFit([], scores, "desc")).toEqual([]);
  });
});
