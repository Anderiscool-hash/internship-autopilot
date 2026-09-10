/**
 * The database half of the job dashboard.
 *
 * Everything here talks to Postgres. The decisions about what a page contains
 * live next door in `list.ts` (pure, unit tested); this file is the plumbing
 * that feeds it and then fetches the rows it asked for.
 *
 * It runs in two passes on purpose:
 *
 *   1. fetch ids + titles for every job matching the SQL filters
 *   2. classify those titles, pick the page, fetch full rows for just those
 *
 * The alternative — fetching every column for thousands of jobs so we can look
 * at their titles — would pull job descriptions (multi-kilobyte text) across
 * the wire only to throw them away.
 */

import type { PrismaClient } from "@prisma/client";
import { AtsType as DbAtsType, JobStatus, RemoteType as DbRemoteType } from "@prisma/client";
import { buildJobWhere, type JobFilters } from "./filters";
import { buildJobPage, orderByIds, MAX_SCAN, type JobPage } from "./list";

/** One row as the dashboard table displays it. */
export interface JobListRow {
  id: string;
  title: string;
  companyName: string;
  location: string | null;
  remoteType: DbRemoteType;
  atsType: DbAtsType;
  salaryMin: number | null;
  salaryMax: number | null;
  /** Null whenever the posting didn't state one — never defaulted (spec §3). */
  currency: string | null;
  canonicalUrl: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** OPEN, or CLOSED once the scanner saw it vanish from its board. */
  status: JobStatus;
}

/** A page of the dashboard: the rows themselves plus the counts around them. */
export interface JobListResult extends Omit<JobPage, "ids"> {
  rows: JobListRow[];
}

/**
 * Fetch one page of jobs for the given filters.
 *
 * `now` is passed in rather than read from the clock here so that the caller
 * (and tests) control what "within the last 7 days" means.
 */
export async function listJobs(
  db: PrismaClient,
  filters: JobFilters,
  now: Date,
): Promise<JobListResult> {
  const where = buildJobWhere(filters, now);

  // Newest first, with id as a tiebreaker: two jobs discovered in the same
  // scan share a firstSeenAt down to the millisecond, and without a second
  // sort key their relative order could differ between the two queries below,
  // which would show one job twice and hide another.
  const orderBy = [{ firstSeenAt: "desc" as const }, { id: "desc" as const }];

  // Take one extra row past the cap purely to detect that we hit it.
  const scanned = await db.job.findMany({
    where,
    select: { id: true, title: true },
    orderBy,
    take: MAX_SCAN + 1,
  });

  const truncated = scanned.length > MAX_SCAN;
  const page = buildJobPage(
    truncated ? scanned.slice(0, MAX_SCAN) : scanned,
    filters.verdict,
    filters.page,
    { truncated },
  );

  const rows =
    page.ids.length === 0
      ? []
      : await db.job.findMany({
          where: { id: { in: page.ids } },
          select: {
            id: true,
            title: true,
            location: true,
            remoteType: true,
            atsType: true,
            salaryMin: true,
            salaryMax: true,
            currency: true,
            canonicalUrl: true,
            firstSeenAt: true,
            lastSeenAt: true,
            status: true,
            company: { select: { name: true } },
          },
        });

  const flattened: JobListRow[] = rows.map(({ company, ...job }) => ({
    ...job,
    companyName: company.name,
  }));

  const { ids: _ids, ...pageMeta } = page;
  return { ...pageMeta, rows: orderByIds(flattened, page.ids) };
}

/** A company that has at least one discovered job, for the filter dropdown. */
export interface CompanyOption {
  id: string;
  name: string;
  jobCount: number;
}

/**
 * The companies worth offering in the filter bar.
 *
 * Only companies we have actually discovered jobs for — the registry also
 * holds companies whose board slug was never confirmed (spec §4), and
 * offering those would mean a dropdown full of choices that return nothing.
 */
export async function listCompanyOptions(db: PrismaClient): Promise<CompanyOption[]> {
  const companies = await db.company.findMany({
    where: { jobs: { some: {} } },
    select: { id: true, name: true, _count: { select: { jobs: true } } },
    orderBy: { name: "asc" },
  });

  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    jobCount: company._count.jobs,
  }));
}
