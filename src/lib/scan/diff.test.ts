/**
 * Tests for removal detection.
 *
 * The important one is the empty-fetch guard: a board that momentarily returns
 * nothing must not wipe out a company's entire job history.
 */

import { describe, it, expect } from "vitest";
import { boardChanged, findDisappearedJobs, shouldTrustForRemoval } from "./diff";

const KNOWN = [
  { id: "job_a", sourceJobId: "1" },
  { id: "job_b", sourceJobId: "2" },
  { id: "job_c", sourceJobId: "3" },
];

describe("findDisappearedJobs", () => {
  it("returns nothing when every stored job is still listed", () => {
    expect(findDisappearedJobs(KNOWN, ["1", "2", "3"])).toEqual([]);
  });

  it("returns the ids of jobs missing from the fetch", () => {
    expect(findDisappearedJobs(KNOWN, ["1", "3"])).toEqual(["job_b"]);
  });

  it("ignores jobs in the fetch that we have never stored", () => {
    expect(findDisappearedJobs(KNOWN, ["1", "2", "3", "99"])).toEqual([]);
  });

  it("returns everything when the fetch lists none of them", () => {
    expect(findDisappearedJobs(KNOWN, [])).toEqual(["job_a", "job_b", "job_c"]);
  });
});

describe("shouldTrustForRemoval", () => {
  it("does not trust an empty fetch to mean an empty board", () => {
    expect(shouldTrustForRemoval(0)).toBe(false);
  });

  it("trusts a fetch that returned at least one job", () => {
    expect(shouldTrustForRemoval(1)).toBe(true);
  });
});

describe("boardChanged", () => {
  it("counts new and removed jobs as change", () => {
    expect(boardChanged(1, 0)).toBe(true);
    expect(boardChanged(0, 1)).toBe(true);
  });

  it("does not count a re-scan that found the same jobs as change", () => {
    expect(boardChanged(0, 0)).toBe(false);
  });
});
