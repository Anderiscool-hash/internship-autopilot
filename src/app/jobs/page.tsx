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
  shortlistActive,
  type RawSearchParams,
} from "@/lib/jobs/filters";
import { MAX_SCAN } from "@/lib/jobs/list";
import { FIT_SORT_MAX, listCompanyOptions, listJobs, type CompanyOption } from "@/lib/jobs/query";
import { FilterBar } from "./filter-bar";
import { clearJobFiltersHref } from "./filter-presentation";
import { Icon } from "../ui-icon";
import "./filters.css";
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
  let databaseUnavailable = false;

  try {
    [result, companies] = await Promise.all([
      listJobs(db, filters, now),
      listCompanyOptions(db),
    ]);
  } catch {
    // The overwhelmingly common cause is Postgres not running, which deserves
    // an instruction rather than a stack trace.
    databaseUnavailable = true;
  }

  if (databaseUnavailable || result === null) {
    return (
      <main className="page page-wide">
        <h1>Jobs</h1>
        <div className="notice notice-error">
          <p>
            <strong>Can&apos;t reach the database.</strong> Start Postgres, or run{" "}
            <code>npm run db:up</code> when using Docker, then try again.
          </p>
          <a className="button" href="/jobs">
            Try again
          </a>
        </div>
      </main>
    );
  }

  const {
    rows,
    matching,
    page,
    pageCount,
    truncated,
    verdicts,
    eligibility,
    eligibilityCounts,
    scanned,
    fitSortUnavailable,
  } = result;
  const firstOnPage = matching === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * PAGE_SIZE, matching);

  // Is the shortlist doing anything right now? The URL can ask for it and a
  // chip can override it, so ask the one function that settles that.
  const shortlisted = shortlistActive(filters);

  // How many postings the shortlist is holding back. `matching` is what the
  // table and the pager are showing; `scanned` is everything that got looked
  // at. The gap is exactly the rejects and the ineligible.
  const hidden = shortlisted ? scanned - matching : 0;

  // Where "show everything" goes, and where "back to the shortlist" comes
  // home to. Both keep the search box, company and date filters intact —
  // turning the shortlist off should not also throw away what you typed.
  const shortlistHref = buildJobsHref(filters, {
    shortlist: true,
    verdict: null,
    eligibility: null,
  });

  return (
    <main className="page page-wide">
      <h1>Find opportunities</h1>
      <p className="lede job-results-summary">
        <strong>{matching.toLocaleString()}</strong> {matching === 1 ? "listing" : "listings"} {shortlisted ? "on your shortlist" : "matching your filters"}.
        {" "}Find a role worth your next application.
      </p>

      <FilterBar
        filters={filters}
        companies={companies}
        eligibilityAvailable={eligibilityCounts !== null}
        hiddenCount={hidden}
      />

      {truncated ? (
        <div className="notice">
          Showing the {MAX_SCAN.toLocaleString()} most recently discovered jobs
          that match. Narrow the filters to see further back.
        </div>
      ) : null}

      {/* Sorting by fit means working out a score for every posting in the
          list, not just the fifty on screen — and a score needs the whole job
          description. Past a few hundred postings that is too much work to do
          on every page load.

          We say so instead of doing it badly. Sorting only the fifty rows in
          front of you would look right and be wrong: the best-fitting job
          would still be sitting on page 4 while page 1 claimed to be the top
          of the list. */}
      {fitSortUnavailable ? (
        <div className="notice">
          <strong>Not sorted by fit.</strong> That needs a fit score for all{" "}
          {matching.toLocaleString()} postings listed here, and this page will
          only work out {FIT_SORT_MAX.toLocaleString()} at a time. These are in
          the usual order, newest first. Narrow the filters — a company, a date
          window, or back to <a href={shortlistHref}>the shortlist</a> — and the
          fit sort will work.
        </div>
      ) : null}

      {matching === 0 ? (
        <section className="job-no-results" aria-labelledby="job-no-results-title">
          <Icon name="search" />
          <h2 id="job-no-results-title">No listings match this combination.</h2>
          <p>Try a broader job title, another company, or a longer discovery window.</p>
          <a className="button" href={clearJobFiltersHref(filters)}>Clear filters</a>
        </section>
      ) : (
        <JobTable
          rows={rows}
          verdicts={verdicts}
          eligibility={eligibility}
          filters={filters}
          now={now}
        />
      )}

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
