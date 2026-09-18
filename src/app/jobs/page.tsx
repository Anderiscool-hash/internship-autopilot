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
  ELIGIBILITY_FILTERS,
  parseJobFilters,
  PAGE_SIZE,
  shortlistActive,
  VERDICTS,
  type EligibilityFilter,
  type JobFilters,
  type RawSearchParams,
} from "@/lib/jobs/filters";
import { MAX_SCAN } from "@/lib/jobs/list";
import { FIT_SORT_MAX, listCompanyOptions, listJobs, type CompanyOption } from "@/lib/jobs/query";
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
    counts,
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
  const showEverythingHref = buildJobsHref(filters, { shortlist: false });
  const shortlistHref = buildJobsHref(filters, {
    shortlist: true,
    verdict: null,
    eligibility: null,
  });

  return (
    <main className="page page-wide">
      <h1>Jobs</h1>

      {/* The headline states the number actually on screen, and nothing else.
          It used to add up every scanned row regardless of the filters, so it
          could claim 1,429 postings while the pager underneath said 63 — and
          a reader who believes the headline stops looking for the other 1,366.
          `matching` is the same number the pager counts, so the two cannot
          drift apart again. */}
      {shortlisted ? (
        <p className="lede">
          {matching.toLocaleString()} {matching === 1 ? "posting" : "postings"} worth a
          look.{" "}
          {hidden > 0 ? (
            <>
              {hidden.toLocaleString()} rejected or ineligible{" "}
              {hidden === 1 ? "posting is" : "postings are"} hidden —{" "}
              <a href={showEverythingHref}>show everything</a>.
            </>
          ) : (
            <>Nothing is being hidden — every posting scanned is here.</>
          )}
        </p>
      ) : (
        <p className="lede">
          {matching.toLocaleString()} {matching === 1 ? "posting" : "postings"} match
          your filters. The shortlist is off, so nothing is hidden beyond what the
          filters and chips below say —{" "}
          <a href={shortlistHref}>back to the shortlist</a>.
        </p>
      )}

      <FilterBar filters={filters} companies={companies} />

      <nav className="chips" aria-label="Filter by classifier verdict">
        <VerdictChip filters={filters} verdict={null} label="All" count={scanned} />
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

      {eligibilityCounts === null ? (
        <p className="note">
          No eligibility check yet — <a href="/profile">fill in your profile</a> and
          these jobs can be screened against the hard requirements they state
          (work authorization, graduation date, degree, years of experience).
        </p>
      ) : (
        <nav className="chips" aria-label="Filter by eligibility">
          <EligibilityChip
            filters={filters}
            eligibility={null}
            label="Any eligibility"
            count={
              eligibilityCounts.eligible +
              eligibilityCounts.unconfirmed +
              eligibilityCounts.ineligible
            }
          />
          {ELIGIBILITY_FILTERS.map((verdict) => (
            <EligibilityChip
              key={verdict}
              filters={filters}
              eligibility={verdict}
              label={verdict}
              count={eligibilityCounts[verdict]}
            />
          ))}
        </nav>
      )}

      {/* Said once, under both chip rows, because the numbers on the chips are
          the most misreadable thing on this page: they are a map of everything
          discovered, not a count of what is in the table. Leaving that implicit
          is how you end up with a chip saying 3,455 above a table of 165 and no
          way for the reader to tell which number is lying. */}
      <p className="note">
        The counts on these chips cover all {scanned.toLocaleString()} scanned{" "}
        {scanned === 1 ? "posting" : "postings"}, not the{" "}
        {matching.toLocaleString()} listed below. Choosing one shows exactly that
        group, rejects and all.
      </p>

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

      <JobTable
        rows={rows}
        verdicts={verdicts}
        eligibility={eligibility}
        filters={filters}
        now={now}
      />

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

/** One eligibility filter chip. */
function EligibilityChip({
  filters,
  eligibility,
  label,
  count,
}: {
  filters: JobFilters;
  eligibility: EligibilityFilter | null;
  label: string;
  count: number;
}) {
  // The "Any" chip must not look selected while the shortlist is narrowing the
  // table: a chip reading "Any 3,301" marked as current, above 150 rows, is the
  // same contradiction the headline used to carry. With the shortlist on,
  // nothing here is the operative filter — the shortlist is, and the headline
  // says so — so no chip claims to be.
  const active =
    filters.eligibility === eligibility &&
    !(eligibility === null && shortlistActive(filters));
  return (
    <a
      className={`chip${active ? " chip-active" : ""}`}
      href={buildJobsHref(filters, { eligibility })}
      aria-current={active ? "true" : undefined}
    >
      {label} <span className="chip-count">{count.toLocaleString()}</span>
    </a>
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
  // Same reasoning as EligibilityChip: "All" cannot be the current selection
  // while the shortlist is hiding most of what it counts.
  const active =
    filters.verdict === verdict && !(verdict === null && shortlistActive(filters));
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
