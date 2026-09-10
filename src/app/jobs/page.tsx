/**
 * The job dashboard (Phase 2, spec §40).
 *
 * This is the first screen that shows what continuous discovery has actually
 * found: every posting in the database, filterable, newest first, with the
 * student-role classifier's verdict on each one.
 *
 * It is a server component — the database query runs on the server and the
 * browser receives finished HTML. Combined with the GET-form filter bar, that
 * means the entire dashboard works with no client-side JavaScript at all.
 */

import { db } from "@/lib/db";
import {
  buildJobsHref,
  parseJobFilters,
  PAGE_SIZE,
  VERDICTS,
  type JobFilters,
  type RawSearchParams,
} from "@/lib/jobs/filters";
import { MAX_SCAN } from "@/lib/jobs/list";
import { listCompanyOptions, listJobs, type CompanyOption } from "@/lib/jobs/query";
import { FilterBar } from "./filter-bar";
import { JobTable } from "./job-table";

// Always render on request. The page reads live database rows, so a cached
// build-time snapshot would show stale jobs — and would also force a database
// connection during `next build`, which fails on a machine where Postgres
// isn't up.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Jobs — Internship Autopilot",
};

interface JobsPageProps {
  // Next 15 hands search params to the page as a promise.
  searchParams: Promise<RawSearchParams>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const filters = parseJobFilters(await searchParams);
  const now = new Date();

  // One clock for the whole render: the "within 7 days" cutoff and the
  // "3h ago" ages should agree with each other.
  let result: Awaited<ReturnType<typeof listJobs>> | null = null;
  let companies: CompanyOption[] = [];
  let dbError: string | null = null;

  try {
    [result, companies] = await Promise.all([
      listJobs(db, filters, now),
      listCompanyOptions(db),
    ]);
  } catch (error) {
    // The overwhelmingly common cause is Postgres not running, which deserves
    // an instruction rather than a stack trace.
    dbError = error instanceof Error ? error.message : String(error);
  }

  if (dbError !== null || result === null) {
    return (
      <main className="page page-wide">
        <h1>Jobs</h1>
        <div className="notice notice-error">
          <p>
            <strong>Can&apos;t reach the database.</strong> Start it with{" "}
            <code>npm run db:up</code> (Docker Desktop has to be running), then
            reload this page.
          </p>
          <p className="detail">{dbError}</p>
        </div>
      </main>
    );
  }

  const { rows, counts, matching, page, pageCount, truncated, verdicts } = result;
  const total = counts.keep + counts.ambiguous + counts.reject;
  const firstOnPage = matching === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * PAGE_SIZE, matching);

  return (
    <main className="page page-wide">
      <h1>Jobs</h1>
      <p className="lede">
        {total.toLocaleString()} discovered {total === 1 ? "posting" : "postings"}{" "}
        match your filters, classified by title.
      </p>

      <FilterBar filters={filters} companies={companies} />

      <nav className="chips" aria-label="Filter by classifier verdict">
        <VerdictChip filters={filters} verdict={null} label="All" count={total} />
        {VERDICTS.map((verdict) => (
          <VerdictChip
            key={verdict}
            filters={filters}
            verdict={verdict}
            label={verdict}
            count={counts[verdict]}
          />
        ))}
      </nav>

      {truncated ? (
        <div className="notice">
          Showing the {MAX_SCAN.toLocaleString()} most recently discovered jobs
          that match. Narrow the filters to see further back.
        </div>
      ) : null}

      <JobTable rows={rows} verdicts={verdicts} now={now} />

      <div className="pager">
        <span>
          {matching === 0
            ? "No results"
            : `${firstOnPage.toLocaleString()}–${lastOnPage.toLocaleString()} of ${matching.toLocaleString()}`}
        </span>
        <span className="pager-links">
          {page > 1 ? (
            <a href={buildJobsHref(filters, { page: page - 1 })}>← Previous</a>
          ) : (
            <span className="disabled">← Previous</span>
          )}
          <span>
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <a href={buildJobsHref(filters, { page: page + 1 })}>Next →</a>
          ) : (
            <span className="disabled">Next →</span>
          )}
        </span>
      </div>
    </main>
  );
}

/** One verdict filter chip, showing how many jobs carry that verdict. */
function VerdictChip({
  filters,
  verdict,
  label,
  count,
}: {
  filters: JobFilters;
  verdict: JobFilters["verdict"];
  label: string;
  count: number;
}) {
  const active = filters.verdict === verdict;
  return (
    <a
      className={`chip${active ? " chip-active" : ""}`}
      href={buildJobsHref(filters, { verdict })}
      aria-current={active ? "true" : undefined}
    >
      {label} <span className="chip-count">{count.toLocaleString()}</span>
    </a>
  );
}
