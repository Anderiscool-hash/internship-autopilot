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
import {
  buildJobWhere,
  shortlistActive,
  type EligibilityFilter,
  type JobFilters,
} from "./filters";
import {
  buildJobPage,
  classifyJobs,
  countVerdicts,
  orderByIds,
  MAX_SCAN,
  type JobPage,
} from "./list";
import { NO_REQUIREMENTS } from "../eligibility/requirements";
import { getProfile } from "../candidate/store";
import { checkEligibility, type EligibilityProfile } from "../eligibility/engine";
import { readStoredRequirements } from "../eligibility/stored";
import { toEligibilityProfile, toFitProfile } from "../fit/profile";
import { scoreFit, type FitResult } from "../fit/score";
import { toPlainText } from "../eligibility/extract";

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
  /**
   * Fit score for this row (spec §12), or null.
   *
   * Null covers three different situations the UI keeps apart: no profile
   * exists, the job failed the hard eligibility gate (§12 scores only eligible
   * jobs), or nothing in the profile could be compared against it.
   */
  fit: FitResult | null;
}

/** How many scanned jobs fell into each eligibility verdict. */
export interface EligibilityCounts {
  eligible: number;
  unconfirmed: number;
  ineligible: number;
}

/** A page of the dashboard: the rows themselves plus the counts around them. */
export interface JobListResult extends Omit<JobPage, "ids"> {
  rows: JobListRow[];
  /**
   * Eligibility verdict per scanned job, or null when no profile exists yet.
   *
   * Null is the honest answer before the profile is filled in: with nothing to
   * check against, every job is neither eligible nor ineligible, and showing a
   * verdict anyway would be inventing one.
   */
  eligibility: Map<string, EligibilityFilter> | null;
  eligibilityCounts: EligibilityCounts | null;
  /**
   * How many postings were looked at in total for this request.
   *
   * This is the number the verdict and eligibility chips add up to: every row
   * matching the SQL filters (company, date window, search text), before the
   * shortlist or any chip narrowed it. `matching` is the smaller number — the
   * rows actually listed. The page must never present `scanned` as the size of
   * what you are reading; the two disagreeing was the bug that made the old
   * headline say 1,429 while the table showed 63.
   */
  scanned: number;
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
    select: { id: true, title: true, requirements: true },
    orderBy,
    take: MAX_SCAN + 1,
  });

  const truncated = scanned.length > MAX_SCAN;
  const capped = truncated ? scanned.slice(0, MAX_SCAN) : scanned;

  // Hard eligibility (spec §11) is computed here, in memory, for the same
  // reason the classifier verdict is: it depends on the candidate profile and
  // on requirements parsed out of JSON, neither of which SQL can express.
  // The requirements themselves were extracted at ingest, so this is a cheap
  // comparison per row rather than a re-parse of every description.
  const profile = await getProfile(db);
  const eligibility = profile
    ? scoreEligibility(capped, toEligibilityProfile(profile))
    : null;
  const eligibilityCounts = eligibility ? countEligibility(eligibility) : null;

  // Classify the whole scanned set once, up front.
  //
  // Two different questions need the answer, and they need it over different
  // sets. The chips ask "how many of EVERYTHING scanned is a reject?" — they
  // are navigation, so their counts have to stay put no matter what is
  // currently selected. The shortlist asks "is THIS row a reject?" so it can
  // drop it. Doing the classification here, before any narrowing, lets the
  // counts below describe the full scan while the filtering still works
  // row-by-row.
  const classified = classifyJobs(capped);
  const scannedCounts = countVerdicts(classified);
  const verdicts = new Map(classified.map((job) => [job.id, job]));

  // The shortlist (see filters.ts) drops two groups: postings the title
  // classifier rejected, and postings a hard requirement in the profile rules
  // out. Note the `?.` on eligibility — with no profile saved there are no
  // eligibility verdicts at all, and "we have not checked" must not be treated
  // as "ineligible". Those rows stay.
  const hideUnworkable = shortlistActive(filters);

  const filtered = capped.filter((job) => {
    if (eligibility && filters.eligibility) {
      if (eligibility.get(job.id) !== filters.eligibility) return false;
    }
    if (hideUnworkable) {
      if (verdicts.get(job.id)?.verdict === "reject") return false;
      if (eligibility?.get(job.id) === "ineligible") return false;
    }
    return true;
  });

  const page = buildJobPage(filtered, filters.verdict, filters.page, { truncated });

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
            // Only fetched for the ~50 rows actually being displayed, which is
            // why fit scoring happens after pagination rather than before it.
            description: true,
            company: { select: { name: true } },
          },
        });

  const fitProfile = profile ? toFitProfile(profile) : null;

  const flattened: JobListRow[] = rows.map(({ company, description, ...job }) => ({
    ...job,
    companyName: company.name,
    fit:
      fitProfile && eligibility?.get(job.id) !== "ineligible"
        ? scoreFit(
            fitProfile,
            {
              title: job.title,
              location: job.location,
              remoteType: job.remoteType,
              description: toPlainText(description),
              firstSeenAt: job.firstSeenAt,
              requirements:
                readStoredRequirements(
                  capped.find((scannedJob) => scannedJob.id === job.id)?.requirements,
                ) ?? NO_REQUIREMENTS,
            },
            now,
          )
        : null,
  }));

  // `buildJobPage` also returns counts and verdicts, but it only saw the rows
  // that survived the narrowing above, so its totals would shrink every time a
  // chip was clicked — a chip whose count changes when you click it is useless
  // for navigating. The full-scan versions computed earlier replace them.
  const {
    ids: _ids,
    counts: _narrowedCounts,
    verdicts: _narrowedVerdicts,
    ...pageMeta
  } = page;

  return {
    ...pageMeta,
    counts: scannedCounts,
    verdicts,
    rows: orderByIds(flattened, page.ids),
    eligibility,
    eligibilityCounts,
    scanned: capped.length,
  };
}

/**
 * Work out the eligibility verdict for every scanned job.
 *
 * A job whose requirements column was never populated comes back
 * "unconfirmed", not "eligible" — "we have not looked at this posting" and
 * "this posting asks for nothing" are different claims, and only one of them
 * is true.
 */
function scoreEligibility(
  jobs: { id: string; requirements: unknown }[],
  profile: EligibilityProfile,
): Map<string, EligibilityFilter> {
  const verdicts = new Map<string, EligibilityFilter>();

  for (const job of jobs) {
    const requirements = readStoredRequirements(job.requirements);
    if (requirements === null) {
      verdicts.set(job.id, "unconfirmed");
      continue;
    }
    verdicts.set(job.id, checkEligibility(profile, requirements).verdict);
  }

  return verdicts;
}

/** Tally the verdicts, for the dashboard's eligibility chips. */
function countEligibility(
  verdicts: Map<string, EligibilityFilter>,
): EligibilityCounts {
  const counts: EligibilityCounts = { eligible: 0, unconfirmed: 0, ineligible: 0 };
  for (const verdict of verdicts.values()) counts[verdict] += 1;
  return counts;
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
