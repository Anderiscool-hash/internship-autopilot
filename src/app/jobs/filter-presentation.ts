import { buildJobsHref, type JobFilters } from "../../lib/jobs/filters";
import type { CompanyOption } from "../../lib/jobs/query";
import { formatEnum } from "./format";

export const RELEVANCE_LABELS = {
  keep: "Likely student roles",
  ambiguous: "Needs a closer look",
  reject: "Likely non-student roles",
} as const;

export const ELIGIBILITY_LABELS = {
  eligible: "Eligible",
  unconfirmed: "Not yet confirmed",
  ineligible: "Not eligible",
} as const;

export function clearJobFiltersHref(filters: JobFilters) {
  // Keep the view and sort the user chose; only remove the narrowing criteria.
  return buildJobsHref(filters, {
    q: null, companyId: null, atsType: null, remoteType: null,
    withinDays: null, verdict: null, eligibility: null, includeClosed: false,
  });
}

export function appliedJobFilters(filters: JobFilters, companies: CompanyOption[]) {
  const items: { key: string; label: string; href: string }[] = [];
  function add(key: string, label: string, change: Partial<JobFilters>) {
    items.push({ key, label, href: buildJobsHref(filters, change) });
  }
  if (filters.q) add("q", 'Title: "' + filters.q + '"', { q: null });
  if (filters.companyId) {
    const company = companies.find(item => item.id === filters.companyId);
    add("company", "Company: " + (company?.name ?? "Unavailable company"), { companyId: null });
  }
  if (filters.remoteType) add("remote", "Work: " + formatEnum(filters.remoteType), { remoteType: null });
  if (filters.withinDays) add("days", filters.withinDays === 1 ? "Discovered: past 24 hours" : "Discovered: past " + filters.withinDays + " days", { withinDays: null });
  if (filters.atsType) add("ats", "Source: " + formatEnum(filters.atsType), { atsType: null });
  if (filters.verdict) add("verdict", RELEVANCE_LABELS[filters.verdict], { verdict: null });
  if (filters.eligibility) add("eligibility", "Eligibility: " + ELIGIBILITY_LABELS[filters.eligibility], { eligibility: null });
  if (filters.includeClosed) add("closed", "Including closed listings", { includeClosed: false });
  return items;
}

