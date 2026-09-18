import { describe, expect, it } from "vitest";
import { parseJobFilters, type JobFilters } from "../../lib/jobs/filters";
import { appliedJobFilters, clearJobFiltersHref } from "./filter-presentation";

function readHref(href: string) {
  return parseJobFilters(Object.fromEntries(new URL(href, "http://localhost").searchParams));
}

describe("applied job filter links", () => {
  it("removes only the requested filter while preserving sort and other criteria", () => {
    const filters = parseJobFilters({ q: "intern", company: "company-1", remote: "REMOTE", days: "7", sort: "title", dir: "desc", page: "4" });
    const tags = appliedJobFilters(filters, [{ id: "company-1", name: "Example", jobCount: 20 }]);
    const removed = readHref(tags.find(tag => tag.key === "remote")!.href);
    expect(removed).toEqual({ ...filters, remoteType: null, page: 1 });
    expect(tags.find(tag => tag.key === "company")?.label).toBe("Company: Example");
  });

  it("keeps all-listings mode when the last explicit verdict is removed", () => {
    const filters = parseJobFilters({ verdict: "reject", sort: "pay" });
    const [only] = appliedJobFilters(filters, []);
    if (!only) throw new Error("expected one applied filter tag");
    const removed = readHref(only.href);
    expect(removed.verdict).toBeNull();
    expect(removed.shortlist).toBe(false);
    expect(removed.sort).toBe("pay");
  });

  it("lets an unavailable company filter be seen and removed", () => {
    const filters = parseJobFilters({ company: "deleted-company" });
    const [tag] = appliedJobFilters(filters, []);
    if (!tag) throw new Error("expected one applied filter tag");
    expect(tag.label).toBe("Company: Unavailable company");
    expect(readHref(tag.href).companyId).toBeNull();
  });

  it("round-trips punctuation in a retained keyword without creating URL parameters", () => {
    const filters = parseJobFilters({ q: "R&D / C++? remote=REMOTE", days: "7" });
    const tag = appliedJobFilters(filters, []).find(tag => tag.key === "days")!;
    const removed = readHref(tag.href);
    expect(removed.q).toBe(filters.q);
    expect(removed.remoteType).toBeNull();
  });

  it.each([false, true])("clears narrowing criteria while retaining shortlist=%s and sort", shortlist => {
    const filters: JobFilters = {
      ...parseJobFilters({ q: "intern", company: "company-1", remote: "REMOTE", days: "7", ats: "LEVER", closed: "1", sort: "company", dir: "desc", page: "3" }),
      shortlist,
    };
    expect(readHref(clearJobFiltersHref(filters))).toEqual({
      ...parseJobFilters({}),
      shortlist,
      sort: "company",
      dir: "desc",
    });
  });

  it("includes every active criterion, but does not count view, sort or page as filters", () => {
    const filters = parseJobFilters({ q: "intern", company: "company-1", remote: "REMOTE", days: "7", ats: "LEVER", closed: "1", verdict: "keep", eligibility: "eligible", sort: "pay", page: "2" });
    expect(appliedJobFilters(filters, []).map(tag => tag.key)).toEqual(["q", "company", "remote", "days", "ats", "verdict", "eligibility", "closed"]);
    expect(appliedJobFilters(parseJobFilters({all:"1",sort:"pay",page:"2"}),[])).toEqual([]);
  });
});
