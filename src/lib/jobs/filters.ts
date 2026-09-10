/**
 * Dashboard filter parsing (Phase 2 job dashboard, spec §40).
 *
 * Everything the dashboard lets you narrow by arrives as a URL query string,
 * because the filter bar is a plain HTML form with `method="get"`. That means
 * the filters are just text typed by a browser — possibly hand-edited, possibly
 * nonsense — so this file is the one place that turns that text into values the
 * rest of the code can trust.
 *
 * The rule it follows: an unrecognized value is dropped, never guessed at. A
 * `?remote=banana` shows all remote types rather than silently picking one.
 */

import { Prisma, RemoteType as DbRemoteType, AtsType as DbAtsType } from "@prisma/client";

/** How many jobs one page of the dashboard shows. */
export const PAGE_SIZE = 50;

/** The three verdicts the student-role classifier (spec §9) can return. */
export const VERDICTS = ["keep", "ambiguous", "reject"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * The "first seen in the last N days" choices offered in the filter bar.
 * A fixed list rather than a free-text number: it keeps the URL predictable
 * and stops someone asking for a 100000-day window that scans the whole table.
 */
export const DAY_WINDOWS = [1, 3, 7, 14, 30, 90] as const;

/** A validated set of dashboard filters. `null` always means "no filter". */
export interface JobFilters {
  /** Case-insensitive substring match against the job title. */
  q: string | null;
  /** Restrict to one company (its database id). */
  companyId: string | null;
  /** Restrict to one ATS platform. */
  atsType: DbAtsType | null;
  /** Restrict to one remote arrangement as stated by the posting. */
  remoteType: DbRemoteType | null;
  /** Only jobs first seen within this many days. */
  withinDays: number | null;
  /** Only jobs the classifier gave this verdict. Applied in memory, not SQL. */
  verdict: Verdict | null;
  /** 1-based page number. */
  page: number;
}

/** The shape Next.js hands us for `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Pull a single string out of the raw search params.
 *
 * A query string can legally repeat a key (`?q=a&q=b`), in which case Next
 * gives us an array. We take the first value: the filter bar never produces
 * repeats, so a repeat means someone hand-edited the URL, and picking one
 * beats throwing an error at them.
 */
function firstValue(raw: RawSearchParams, key: string): string | null {
  const value = raw[key];
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Narrow a raw string to one of a fixed set of allowed values, or null. */
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (value === null) return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Turn raw query-string values into a validated `JobFilters`.
 *
 * Deliberately total: it never throws. Bad input degrades to "no filter",
 * which shows more jobs rather than fewer — the failure mode that can't hide
 * a posting from you.
 */
export function parseJobFilters(raw: RawSearchParams): JobFilters {
  const rawPage = firstValue(raw, "page");
  const parsedPage = rawPage === null ? NaN : Number.parseInt(rawPage, 10);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const rawDays = firstValue(raw, "days");
  const parsedDays = rawDays === null ? NaN : Number.parseInt(rawDays, 10);
  const withinDays = (DAY_WINDOWS as readonly number[]).includes(parsedDays)
    ? parsedDays
    : null;

  return {
    q: firstValue(raw, "q"),
    companyId: firstValue(raw, "company"),
    atsType: oneOf(firstValue(raw, "ats"), Object.values(DbAtsType)),
    remoteType: oneOf(firstValue(raw, "remote"), Object.values(DbRemoteType)),
    withinDays,
    verdict: oneOf(firstValue(raw, "verdict"), VERDICTS),
    page,
  };
}

/**
 * Translate the filters into a Prisma `where` clause.
 *
 * Note what is NOT here: `verdict`. The classifier is TypeScript that reads a
 * job title (spec §9) and its verdict is not stored in any column, so it cannot
 * be part of an SQL query. It gets applied in memory instead — see
 * `src/lib/jobs/list.ts`.
 *
 * `now` is a parameter rather than a `new Date()` inside the function so tests
 * can pin the clock.
 */
export function buildJobWhere(filters: JobFilters, now: Date): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {};

  if (filters.q) {
    where.title = { contains: filters.q, mode: "insensitive" };
  }
  if (filters.companyId) {
    where.companyId = filters.companyId;
  }
  if (filters.atsType) {
    where.atsType = filters.atsType;
  }
  if (filters.remoteType) {
    where.remoteType = filters.remoteType;
  }
  if (filters.withinDays !== null) {
    const cutoff = new Date(now.getTime() - filters.withinDays * 24 * 60 * 60 * 1000);
    where.firstSeenAt = { gte: cutoff };
  }

  return where;
}

/**
 * Rebuild the dashboard URL with some filters changed.
 *
 * Used by the pagination links and the verdict chips. Any filter left at its
 * default is omitted from the query string entirely, so the common case is a
 * clean `/jobs` rather than `/jobs?q=&company=&ats=...`.
 *
 * Changing any filter other than the page resets you to page 1 — staying on
 * page 7 of a result set you just narrowed to 12 rows shows an empty screen.
 */
export function buildJobsHref(
  filters: JobFilters,
  changes: Partial<JobFilters> = {},
): string {
  const merged: JobFilters = { ...filters, ...changes };
  const onlyPageChanged =
    Object.keys(changes).length > 0 &&
    Object.keys(changes).every((key) => key === "page");
  if (!onlyPageChanged && changes.page === undefined) {
    merged.page = 1;
  }

  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.companyId) params.set("company", merged.companyId);
  if (merged.atsType) params.set("ats", merged.atsType);
  if (merged.remoteType) params.set("remote", merged.remoteType);
  if (merged.withinDays !== null) params.set("days", String(merged.withinDays));
  if (merged.verdict) params.set("verdict", merged.verdict);
  if (merged.page > 1) params.set("page", String(merged.page));

  const query = params.toString();
  return query.length > 0 ? `/jobs?${query}` : "/jobs";
}
