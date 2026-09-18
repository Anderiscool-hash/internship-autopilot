/**
 * Turning a set of matching jobs into one page of the dashboard.
 *
 * The awkward bit this file exists to handle: the student-role verdict (spec
 * §9) is computed from the job title by TypeScript, not stored in a column.
 * Postgres therefore cannot filter or count by it, and it cannot paginate by
 * it either — `LIMIT 50` in SQL would hand back 50 rows of which an unknown
 * number are rejects.
 *
 * So the dashboard classifies first and paginates second, in memory. Every
 * function here is pure: give it titles, it gives back verdicts, counts and a
 * page of ids. No database, no clock, which is why it can be unit tested
 * directly.
 */

import { classifyStudentRole } from "./classify";
import { readStoredRequirements } from "../eligibility/stored";
import { PAGE_SIZE, type Verdict } from "./filters";

/**
 * The most rows the dashboard will classify in one request.
 *
 * There has to be a ceiling — classifying is cheap per title but not free, and
 * an unfiltered scan of a table with a million postings would stall the page.
 * When the cap bites we say so on screen (`truncated`) instead of quietly
 * showing a partial answer, because a job count that is silently wrong is
 * worse than one labelled incomplete.
 *
 * The number is measured, not guessed. Over 17,232 real rows on this machine:
 * fetching id+title+requirements took 129ms, classifying them all took 229ms,
 * and running hard eligibility over them took 7ms — 365ms in total, about
 * 0.021ms per row. At that rate 25,000 rows costs roughly half a second, which
 * a dashboard can afford; a million would still take about twenty seconds,
 * which is what the ceiling is here to prevent.
 *
 * It was 5,000, chosen before there was anything to measure against. That was
 * fine at 3,600 postings and wrong the moment the registry grew to 84 boards:
 * the cap bound on every request, so the default shortlist quietly became
 * "the shortlist of the 5,000 newest postings" and an older internship fell
 * out of view. Raise this again when the corpus approaches it — the notice on
 * screen is the signal, and this comment is the measurement to redo.
 */
export const MAX_SCAN = 25000;

/** The minimum a row needs for classification: an id and a title. */
export interface ClassifiableJob {
  id: string;
  title: string;
  /**
   * The requirements extracted from the description at ingest, still in the
   * JSON shape Prisma hands back. Optional: a row that has never been through
   * extraction simply gets classified on its title alone, exactly as before.
   *
   * This is what lets the classifier settle a title it cannot settle by
   * itself — see the arbiter in ./classify.
   */
  requirements?: unknown;
}

/** One job's verdict, kept alongside the id it belongs to. */
export interface ClassifiedJob {
  id: string;
  verdict: Verdict;
  /** The classifier's own explanation, shown in the row's tooltip. */
  reason: string;
}

/** How many jobs in the current filter fell into each verdict. */
export interface VerdictCounts {
  keep: number;
  ambiguous: number;
  reject: number;
}

/** One page of the dashboard, expressed as ids plus the counts around it. */
export interface JobPage {
  /** Ids to display, in order. */
  ids: string[];
  /** Verdict for every scanned job, keyed by id — the row badges read this. */
  verdicts: Map<string, ClassifiedJob>;
  /** Verdict totals across everything matching the SQL filters. */
  counts: VerdictCounts;
  /** How many jobs match after the verdict filter is applied. */
  matching: number;
  /** The page actually shown (clamped into range). */
  page: number;
  /** Total pages available for the current filters; at least 1. */
  pageCount: number;
  /** True when the scan cap stopped us short of the full result set. */
  truncated: boolean;
}

/** Run the title classifier over a batch of jobs. */
export function classifyJobs(jobs: ClassifiableJob[]): ClassifiedJob[] {
  return jobs.map((job) => {
    // Pass the stored requirements along when the row has them. A title like
    // "Financial Data Analyst" is genuinely undecidable on its own; a body
    // that asks for four years of experience decides it.
    const posting =
      job.requirements === undefined ? null : readStoredRequirements(job.requirements);
    const result = classifyStudentRole(job.title, posting);
    return { id: job.id, verdict: result.verdict, reason: result.reason };
  });
}

/** Count how many of each verdict a classified batch contains. */
export function countVerdicts(classified: ClassifiedJob[]): VerdictCounts {
  const counts: VerdictCounts = { keep: 0, ambiguous: 0, reject: 0 };
  for (const job of classified) counts[job.verdict] += 1;
  return counts;
}

/**
 * Classify a batch, apply the verdict filter, and slice out one page.
 *
 * `scanned` must already be ordered the way the dashboard displays jobs
 * (newest first) — this function preserves that order and never re-sorts.
 *
 * `requestedPage` is clamped rather than rejected: asking for page 9 of a
 * 3-page result set lands you on page 3. A browser back-button after
 * tightening a filter does exactly that, and an error screen would be a
 * hostile answer to an honest mistake.
 */
export function buildJobPage(
  scanned: ClassifiableJob[],
  verdictFilter: Verdict | null,
  requestedPage: number,
  options: { truncated?: boolean; pageSize?: number } = {},
): JobPage {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const classified = classifyJobs(scanned);
  const counts = countVerdicts(classified);

  const kept =
    verdictFilter === null
      ? classified
      : classified.filter((job) => job.verdict === verdictFilter);

  const pageCount = Math.max(1, Math.ceil(kept.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
  const start = (page - 1) * pageSize;

  return {
    ids: kept.slice(start, start + pageSize).map((job) => job.id),
    verdicts: new Map(classified.map((job) => [job.id, job])),
    counts,
    matching: kept.length,
    page,
    pageCount,
    truncated: options.truncated ?? false,
  };
}

/**
 * Put database rows back into the order the page asked for.
 *
 * `findMany({ where: { id: { in: ids } } })` gives no ordering guarantee, so
 * fetching the page's rows scrambles them. This restores the newest-first
 * order established before the fetch. Ids with no matching row are skipped,
 * which is the right behaviour if a job was deleted between the two queries.
 */
export function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is T => row !== undefined);
}
