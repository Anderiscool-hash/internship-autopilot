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

import type { Prisma, PrismaClient } from "@prisma/client";
import { AtsType as DbAtsType, JobStatus, RemoteType as DbRemoteType } from "@prisma/client";
import {
  buildJobWhere,
  shortlistActive,
  type EligibilityFilter,
  type JobFilters,
  type SortDirection,
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

/**
 * The most rows the dashboard will fit-score in order to SORT by fit.
 *
 * Sorting by any of the other columns is an ORDER BY that Postgres does over
 * the whole result set for free. Fit is different: the score is computed in
 * TypeScript from the job description, and descriptions are multi-kilobyte
 * text this query otherwise fetches for only the ~50 rows on screen.
 *
 * Sorting just those 50 would be the tempting shortcut and it is the wrong
 * answer: it reorders one page and calls the list sorted, so the best-fitting
 * job in the result set stays buried on page 4 while page 1 claims to be the
 * top of the ranking. That is a silently wrong answer, and this codebase
 * refuses those — compare `truncated` / MAX_SCAN in list.ts, which says on
 * screen that it stopped short rather than pretending it did not.
 *
 * So fit sorting scores the entire filtered set, and this is the ceiling on
 * how big that set may be. JUDGMENT CALL — why 500: the default shortlist view
 * is a couple of hundred postings, so the sort works where people actually use
 * it, while `?all=1` (thousands of rows, thousands of descriptions) lands over
 * the line and gets told to narrow the filters instead of being quietly
 * misordered.
 */
export const FIT_SORT_MAX = 500;

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
  /**
   * True when the reader asked to sort by fit and the filtered set was bigger
   * than FIT_SORT_MAX, so the rows came back in the default order instead.
   *
   * The page has to say this out loud. Handing back a newest-first list under
   * a Fit header that looks sorted would be a lie the reader has no way to
   * detect, which is exactly the failure `truncated` exists to avoid.
   */
  fitSortUnavailable: boolean;
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

  // The order the whole pipeline inherits. Whatever column the reader picked,
  // this is an SQL ORDER BY over every matching row — not a reshuffle of the
  // page — so page 2 really does continue where page 1 stopped.
  //
  // Sorting by fit is the one case this cannot express (fit is not a column);
  // buildSortOrder hands back the default order for it and the in-memory sort
  // further down takes over.
  const orderBy = buildSortOrder(filters);

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

  // The requirements each scanned row carries, keyed by id. Both the fit sort
  // below and the page's own rows need them, and looking one up by scanning
  // `capped` from the top every time is a lot of scanning for 5,000 rows.
  const requirementsById = new Map(capped.map((job) => [job.id, job.requirements]));

  const fitProfile = profile ? toFitProfile(profile) : null;

  // ---------------------------------------------------------------------
  // Sorting by fit, the one column SQL cannot order.
  //
  // To sort a list you have to know the value for EVERY row in it, so this
  // scores the whole filtered set — not the page — which means pulling every
  // one of their descriptions. That is the expensive thing FIT_SORT_MAX caps.
  // Over the cap we do not sort at all and do not pretend to: the rows come
  // back in the default order and `fitSortUnavailable` tells the page to say
  // so in words.
  //
  // With no candidate profile there are no fit scores for anything, so
  // "sort by fit" has nothing to sort by. That is not a failure worth a
  // notice — the Fit column is not even on screen — so it quietly does
  // nothing, exactly like the default order.
  const wantsFitSort = filters.sort === "fit" && fitProfile !== null;

  // The rows the cap is measured against have to be exactly the rows that end
  // up listed, which means applying the verdict chip here too. `filtered`
  // above has not had it applied yet — buildJobPage does that — so measuring
  // `filtered` would refuse to sort a 126-row "keep" view on the grounds that
  // the 3,300 rows it was narrowed FROM are too many, and then print a notice
  // naming the 126. The number in the message and the number being judged must
  // be the same number.
  const listed =
    filters.verdict === null
      ? filtered
      : filtered.filter((job) => verdicts.get(job.id)?.verdict === filters.verdict);

  const fitSortUnavailable = wantsFitSort && listed.length > FIT_SORT_MAX;

  // Scores for every listed row, computed only when we are sorting by them.
  // Null otherwise, and the page's 50 rows get scored one by one further down
  // exactly as they always were.
  let fitScores: Map<string, FitResult | null> | null = null;
  let ordered = filtered;

  if (wantsFitSort && !fitSortUnavailable && fitProfile) {
    fitScores = await scoreFitForIds(
      db,
      listed.map((job) => job.id),
      fitProfile,
      eligibility,
      requirementsById,
      now,
    );
    // Sorting `filtered` rather than `listed` keeps buildJobPage the single
    // place that applies the verdict filter. Rows the chip is about to drop
    // have no score, so they sort to the back and are then dropped anyway —
    // the order of the rows that survive is unaffected.
    ordered = sortByFit(filtered, fitScores, filters.dir);
  }

  const page = buildJobPage(ordered, filters.verdict, filters.page, { truncated });

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

  const flattened: JobListRow[] = rows.map(({ company, description, ...job }) => ({
    ...job,
    companyName: company.name,
    // When we sorted by fit we already scored this row, so reuse that number
    // rather than computing a second one — two scorings of the same job could
    // not disagree, but the column and the order they produce must obviously
    // be the same thing.
    fit:
      fitScores?.has(job.id) === true
        ? (fitScores.get(job.id) ?? null)
        : scoreJobFit(
            fitProfile,
            eligibility,
            { ...job, description },
            requirementsById.get(job.id),
            now,
          ),
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
    fitSortUnavailable,
  };
}

/**
 * Turn the chosen sort column into a Prisma `orderBy`.
 *
 * Two rules hold for every branch:
 *
 * 1. `{ id: "desc" }` is always appended. Without a second sort key, rows that
 *    tie on the first one (two jobs with the same title, the same company, no
 *    pay at all) can come back in a different order each time the query runs —
 *    and since page 1 and page 2 are separate queries, that shows one job
 *    twice and hides another. A tiebreaker no two rows can share fixes it.
 *
 * 2. Nullable columns sort their nulls LAST in BOTH directions. A job that
 *    lists no salary is not a job that pays nothing, and a posting with no
 *    location is not a posting located nowhere. Treating "unknown" as a low
 *    value would put every unpriced job at the bottom of "lowest pay first"
 *    as though we knew it paid badly. This is the same rule the fit engine
 *    follows (see the header of src/lib/fit/score.ts): unknown is not zero.
 *
 * Exported so the ordering rules above can be unit tested without a
 * database — they are the part of this file that is pure.
 */
export function buildSortOrder(filters: JobFilters): Prisma.JobOrderByWithRelationInput[] {
  const dir = filters.dir;
  const tiebreak: Prisma.JobOrderByWithRelationInput = { id: "desc" };

  switch (filters.sort) {
    case "title":
      return [{ title: dir }, tiebreak];
    case "company":
      // Company name lives on the related Company row, not on Job, so this
      // orders through the relation rather than by a column of its own.
      return [{ company: { name: dir } }, tiebreak];
    case "location":
      return [{ location: { sort: dir, nulls: "last" } }, tiebreak];
    case "pay":
      // salaryMin, not salaryMax: it is the number a posting is most likely to
      // state, and sorting by the top of a range would rank a "$20-$80/hr"
      // posting above a flat "$60/hr" one.
      return [{ salaryMin: { sort: dir, nulls: "last" } }, tiebreak];
    case "seen":
      return [{ firstSeenAt: dir }, tiebreak];
    case "fit":
    default:
      // Fit is scored in TypeScript, so SQL cannot order by it. Fetch in the
      // default order; the in-memory sort in listJobs reorders from here, and
      // if it declines to (over FIT_SORT_MAX) this IS the order shown.
      return [{ firstSeenAt: "desc" }, tiebreak];
  }
}

/**
 * Score one job for fit, or return null if it should not be scored.
 *
 * Null has three meanings the UI keeps apart — no profile, ruled out by a hard
 * requirement, or too little to compare — and all three arrive here as null.
 */
function scoreJobFit(
  fitProfile: ReturnType<typeof toFitProfile> | null,
  eligibility: Map<string, EligibilityFilter> | null,
  job: {
    id: string;
    title: string;
    location: string | null;
    remoteType: DbRemoteType;
    firstSeenAt: Date;
    description: string;
  },
  storedRequirements: unknown,
  now: Date,
): FitResult | null {
  if (!fitProfile) return null;
  // Spec §12 scores only jobs that clear the hard eligibility gate.
  if (eligibility?.get(job.id) === "ineligible") return null;

  return scoreFit(
    fitProfile,
    {
      title: job.title,
      location: job.location,
      remoteType: job.remoteType,
      description: toPlainText(job.description),
      firstSeenAt: job.firstSeenAt,
      requirements: readStoredRequirements(storedRequirements) ?? NO_REQUIREMENTS,
    },
    now,
  );
}

/**
 * Fit-score a whole set of jobs, so the list can be SORTED by the result.
 *
 * This is the expensive query the rest of the file works to avoid: it fetches
 * the description of every job in the filtered set rather than just the page.
 * Only ever called after the FIT_SORT_MAX check in listJobs.
 */
async function scoreFitForIds(
  db: PrismaClient,
  ids: string[],
  fitProfile: NonNullable<ReturnType<typeof toFitProfile>>,
  eligibility: Map<string, EligibilityFilter> | null,
  requirementsById: Map<string, unknown>,
  now: Date,
): Promise<Map<string, FitResult | null>> {
  const scores = new Map<string, FitResult | null>();
  if (ids.length === 0) return scores;

  const jobs = await db.job.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      location: true,
      remoteType: true,
      firstSeenAt: true,
      description: true,
    },
  });

  for (const job of jobs) {
    scores.set(
      job.id,
      scoreJobFit(fitProfile, eligibility, job, requirementsById.get(job.id), now),
    );
  }

  return scores;
}

/**
 * Order jobs by their fit score, highest first (or lowest, if asked).
 *
 * A job with no score sorts LAST whichever direction you picked. It is not a
 * zero: "we could not score this" and "this scored 0" are different claims,
 * and only one of them is true. Putting unscored jobs at the top of "worst
 * fit first" would read as a confident judgment the engine never made.
 *
 * Rows that tie — including all the unscored ones — keep the order they came
 * in with, which is the default newest-first order, because JavaScript's sort
 * is stable. So "sort by fit" really means "by fit, then by newest".
 */
export function sortByFit<T extends { id: string }>(
  jobs: T[],
  scores: Map<string, FitResult | null>,
  direction: SortDirection,
): T[] {
  const scoreOf = (id: string): number | null => {
    const fit = scores.get(id);
    // `fit.score` is itself null when the engine had too little to work with
    // (see MIN_COVERAGE in fit/score.ts). That is just as unknown as having no
    // FitResult at all, so it lands in the same bucket.
    return fit && fit.score !== null ? fit.score : null;
  };

  return [...jobs].sort((a, b) => {
    const left = scoreOf(a.id);
    const right = scoreOf(b.id);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return direction === "asc" ? left - right : right - left;
  });
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
