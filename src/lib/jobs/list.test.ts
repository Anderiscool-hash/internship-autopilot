/**
 * Tests for classify-then-paginate.
 *
 * These use titles the classifier has strong opinions about, so the tests are
 * about paging and counting rather than about re-testing the classifier
 * itself (classify.test.ts already does that).
 */

import { describe, it, expect } from "vitest";
import { classifyStudentRole } from "./classify";
import { buildJobPage, classifyJobs, countVerdicts, orderByIds } from "./list";

/** Titles whose verdicts we assert on below, to keep the fixtures honest. */
const INTERN_TITLE = "Software Engineering Intern";
const SENIOR_TITLE = "Senior Staff Engineer";

describe("fixture sanity", () => {
  it("uses titles the classifier actually disagrees about", () => {
    expect(classifyStudentRole(INTERN_TITLE).verdict).toBe("keep");
    expect(classifyStudentRole(SENIOR_TITLE).verdict).toBe("reject");
  });
});

/** Build n jobs alternating between an intern title and a senior title. */
function alternatingJobs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `job_${index}`,
    title: index % 2 === 0 ? INTERN_TITLE : SENIOR_TITLE,
  }));
}

describe("classifyJobs", () => {
  it("keeps ids attached to their verdicts", () => {
    const classified = classifyJobs([{ id: "a", title: INTERN_TITLE }]);
    expect(classified).toEqual([
      { id: "a", verdict: "keep", reason: expect.any(String) },
    ]);
  });
});

describe("countVerdicts", () => {
  it("counts each verdict and reports zeros for the rest", () => {
    const counts = countVerdicts(classifyJobs(alternatingJobs(10)));
    expect(counts).toEqual({ keep: 5, ambiguous: 0, reject: 5 });
  });
});

describe("buildJobPage", () => {
  it("returns the first page in the order it was given", () => {
    const page = buildJobPage(alternatingJobs(10), null, 1, { pageSize: 4 });
    expect(page.ids).toEqual(["job_0", "job_1", "job_2", "job_3"]);
    expect(page.page).toBe(1);
    expect(page.pageCount).toBe(3);
    expect(page.matching).toBe(10);
  });

  it("paginates over the filtered set, not the scanned set", () => {
    // 10 jobs, 5 of them "keep" — with a page size of 2 that is 3 pages of
    // keeps, not 5 pages of everything.
    const page = buildJobPage(alternatingJobs(10), "keep", 2, { pageSize: 2 });
    expect(page.ids).toEqual(["job_4", "job_6"]);
    expect(page.matching).toBe(5);
    expect(page.pageCount).toBe(3);
  });

  it("still reports counts for verdicts filtered out of view", () => {
    const page = buildJobPage(alternatingJobs(10), "keep", 1, { pageSize: 2 });
    expect(page.counts).toEqual({ keep: 5, ambiguous: 0, reject: 5 });
  });

  it("clamps a page number past the end back into range", () => {
    const page = buildJobPage(alternatingJobs(10), null, 99, { pageSize: 4 });
    expect(page.page).toBe(3);
    expect(page.ids).toEqual(["job_8", "job_9"]);
  });

  it("reports one empty page when nothing matches", () => {
    const page = buildJobPage([], null, 1);
    expect(page.ids).toEqual([]);
    expect(page.matching).toBe(0);
    expect(page.pageCount).toBe(1);
    expect(page.page).toBe(1);
  });

  it("exposes a verdict for every scanned job, including ones off this page", () => {
    const page = buildJobPage(alternatingJobs(10), null, 1, { pageSize: 2 });
    expect(page.verdicts.size).toBe(10);
    expect(page.verdicts.get("job_9")?.verdict).toBe("reject");
  });

  it("passes the truncation flag through untouched", () => {
    expect(buildJobPage(alternatingJobs(2), null, 1).truncated).toBe(false);
    expect(buildJobPage(alternatingJobs(2), null, 1, { truncated: true }).truncated).toBe(
      true,
    );
  });
});

describe("orderByIds", () => {
  it("restores the requested order regardless of how rows came back", () => {
    const rows = [{ id: "b" }, { id: "a" }, { id: "c" }];
    expect(orderByIds(rows, ["a", "b", "c"])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
  });

  it("skips ids with no matching row", () => {
    expect(orderByIds([{ id: "a" }], ["a", "gone"])).toEqual([{ id: "a" }]);
  });
});
