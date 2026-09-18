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

import {
  Prisma,
  RemoteType as DbRemoteType,
  AtsType as DbAtsType,
  JobStatus,
} from "@prisma/client";

/** How many jobs one page of the dashboard shows. */
export const PAGE_SIZE = 50;

/** The eligibility verdicts a job can carry, for the dashboard filter (spec §11). */
export const ELIGIBILITY_FILTERS = ["eligible", "unconfirmed", "ineligible"] as const;
export type EligibilityFilter = (typeof ELIGIBILITY_FILTERS)[number];

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
  /**
   * The default view: hide the postings that are not worth opening.
   *
   * Concretely it hides two groups — jobs the title classifier called
   * "reject", and jobs that fail a hard requirement in your profile. What is
   * left is everything the system currently believes you could actually apply
   * to.
   *
   * This exists because `verdict` above can only hold ONE value, so "keep or
   * ambiguous" — the pair you almost always want — was impossible to ask for.
   * Without it the dashboard opened on page 1 of several thousand rejects and
   * you had to know to click two separate chips to find the real list.
   *
   * On by default, and `?all=1` turns it off. It is also turned off by any
   * explicit `verdict=` or `eligibility=` in the URL: otherwise clicking the
   * "reject" chip would fight the shortlist over the same rows and show you
   * an empty table. The page always says out loud how many postings the
   * shortlist is hiding and links to the unfiltered view — a hidden job the
   * reader never learns about is the one error they cannot discover.
   */
  shortlist: boolean;
  /**
   * Show postings the scanner has seen disappear from their board.
   *
   * Off by default: a closed posting cannot be applied to, so listing it
   * alongside live ones by default would waste the reader's attention. It stays
   * available because "did I miss this one?" is a real question, and because a
   * job vanishing is sometimes a board glitch rather than a real closure.
   */
  includeClosed: boolean;
  /**
   * Only jobs with this hard-eligibility verdict (spec §11).
   *
   * Computed in memory against the stored requirements and the candidate
   * profile, so like `verdict` it can never be part of the SQL query. Has no
   * effect at all until a profile exists — there is nothing to check against.
   */
  eligibility: EligibilityFilter | null;
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

  // Read these two raw first, because whether they were PRESENT at all — not
  // whether they were valid — decides the shortlist below.
  const rawVerdict = firstValue(raw, "verdict");
  const rawEligibility = firstValue(raw, "eligibility");

  // The shortlist is on unless something asks for it to be off. Three things
  // ask:
  //   ?all=1              — the "show everything" link in the page headline
  //   ?verdict=...        — a verdict chip
  //   ?eligibility=...    — an eligibility chip
  //
  // The chips count as a request because they and the shortlist would
  // otherwise both be narrowing the same rows: a reader clicking "reject"
  // wants to see rejects, and a shortlist that hides rejects would answer
  // with an empty table and no explanation.
  //
  // JUDGMENT CALL: a chip parameter turns the shortlist off even when its
  // value is junk (`?verdict=banana` drops to "no verdict filter", but still
  // turns the shortlist off). That errs toward showing MORE postings, which
  // is the failure this file everywhere prefers — a filter that quietly shows
  // fewer rows than you asked for can hide a job from you; one that shows
  // more cannot.
  const showEverything = ["1", "on", "true"].includes(firstValue(raw, "all") ?? "");
  const shortlist = !showEverything && rawVerdict === null && rawEligibility === null;

  return {
    q: firstValue(raw, "q"),
    companyId: firstValue(raw, "company"),
    atsType: oneOf(firstValue(raw, "ats"), Object.values(DbAtsType)),
    remoteType: oneOf(firstValue(raw, "remote"), Object.values(DbRemoteType)),
    withinDays,
    verdict: oneOf(rawVerdict, VERDICTS),
    shortlist,
    // A checkbox submits "on"; the pagination links write "1". Anything else
    // (including the parameter being absent) means the box was unchecked.
    includeClosed: ["1", "on", "true"].includes(firstValue(raw, "closed") ?? ""),
    eligibility: oneOf(rawEligibility, ELIGIBILITY_FILTERS),
    page,
  };
}

/**
 * Is the shortlist actually in force for this combination of filters?
 *
 * `parseJobFilters` can never hand back a `JobFilters` with both
 * `shortlist: true` and a verdict or eligibility chip set — but code that
 * builds a filter set by hand (a link that flips one field, a test) can. This
 * is the single place that settles the contradiction, so the URL builder, the
 * query and the page all answer it the same way.
 */
export function shortlistActive(filters: JobFilters): boolean {
  return filters.shortlist && filters.verdict === null && filters.eligibility === null;
}

/**
 * Translate the filters into a Prisma `where` clause.
 *
 * Note what is NOT here: `verdict`, `eligibility` and `shortlist`. The
 * classifier is TypeScript that reads a job title (spec §9) and its verdict is
 * not stored in any column; eligibility is computed against your profile. None
 * of the three can be part of an SQL query, so they are applied in memory
 * instead — see `src/lib/jobs/query.ts` and `src/lib/jobs/list.ts`.
 *
 * `now` is a parameter rather than a `new Date()` inside the function so tests
 * can pin the clock.
 */
export function buildJobWhere(filters: JobFilters, now: Date): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {};

  // The scanner sets CLOSED when a posting stops appearing on its board
  // (spec §5). Everything else — FILLED, REMOVED, UNKNOWN — is a state nothing
  // sets yet, so this deliberately says "only OPEN" rather than "not CLOSED":
  // when those states do arrive, they should have to opt in to being shown.
  if (!filters.includeClosed) {
    where.status = JobStatus.OPEN;
  }

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
 *
 * The shortlist round-trips through here too, which is what makes the chips
 * and the "show everything" link agree: pass `{ shortlist: false }` to get the
 * `?all=1` URL, or `{ shortlist: true, verdict: null, eligibility: null }` to
 * get back to the plain `/jobs` shortlist.
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
  if (merged.includeClosed) params.set("closed", "1");
  if (merged.eligibility) params.set("eligibility", merged.eligibility);
  // The shortlist is the default, so it is written into the URL only when it
  // is OFF. And it only needs writing when nothing else already implies it:
  // a `verdict=` or `eligibility=` in the URL turns the shortlist off on its
  // own (see parseJobFilters), so adding `all=1` alongside one would be noise
  // that says nothing new.
  if (!shortlistActive(merged) && !merged.verdict && !merged.eligibility) {
    params.set("all", "1");
  }
  if (merged.page > 1) params.set("page", String(merged.page));

  const query = params.toString();
  return query.length > 0 ? `/jobs?${query}` : "/jobs";
}
