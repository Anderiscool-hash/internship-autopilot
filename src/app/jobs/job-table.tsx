/**
 * The dashboard's results table.
 *
 * Each row is one discovered posting. The title links straight to the
 * employer's own canonical URL (spec §6) — the whole point of the canonical
 * URL is that we can always get back to the real posting, so the dashboard
 * should never be a place where a job's source becomes unreachable.
 *
 * The verdict badge shows the cheap keyword classifier's opinion (spec §9),
 * with its reasoning in the hover title. It is not an eligibility decision —
 * that engine is Phase 3 — so a "reject" here means "almost certainly not a
 * student role", not "you can't apply".
 */

import { JobStatus } from "@prisma/client";
import {
  buildJobsHref,
  nextSortDirection,
  type EligibilityFilter,
  type JobFilters,
  type SortKey,
} from "@/lib/jobs/filters";
import type { ClassifiedJob } from "@/lib/jobs/list";
import type { JobListRow } from "@/lib/jobs/query";
import { formatAge, formatEnum, formatLocation, formatSalary } from "./format";

interface JobTableProps {
  rows: JobListRow[];
  verdicts: Map<string, ClassifiedJob>;
  /** Hard-eligibility verdicts, or null when there is no profile to check against. */
  eligibility: Map<string, EligibilityFilter> | null;
  /**
   * The filters this table is showing, so each header can build the URL that
   * sorts by it while keeping everything else the reader already chose.
   */
  filters: JobFilters;
  now: Date;
}

/**
 * A column header you can click to sort by.
 *
 * It is a real link, not a button with a click handler, for two reasons. The
 * dashboard has no client-side JavaScript at all — the whole page is server
 * rendered — so a link is the only thing that can work. And a link is
 * keyboard reachable, focusable and openable in a new tab for free, which a
 * clickable `<th>` would have to reimplement badly.
 *
 * The direction is shown with an arrow character rather than a colour: this
 * design system spends colour on meaning (a verdict, an eligibility badge),
 * and a reader who cannot distinguish the colours would be left with a header
 * that looks identical whichever way it is sorted.
 */
function SortHeader({
  filters,
  column,
  label,
  className,
}: {
  filters: JobFilters;
  column: SortKey;
  label: string;
  className: string;
}) {
  const active = filters.sort === column;
  // Clicking the column you are on flips it; clicking a new one starts it the
  // way that column is normally wanted (see nextSortDirection).
  const href = buildJobsHref(filters, {
    sort: column,
    dir: nextSortDirection(filters, column),
  });

  return (
    <th
      scope="col"
      className={className}
      // Screen readers announce this; it is the non-visual half of the arrow.
      aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <a
        className={`col-sort${active ? " col-sort-active" : ""}`}
        href={href}
        title={
          active
            ? `Sorted by ${label.toLowerCase()}, ${filters.dir === "asc" ? "ascending" : "descending"}. Click to reverse.`
            : `Sort by ${label.toLowerCase()}.`
        }
      >
        {label}
        {/* aria-hidden because aria-sort on the <th> already says this, and
            hearing "up arrow" read out after every header is noise. */}
        <span className="sort-arrow" aria-hidden="true">
          {active ? (filters.dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </a>
    </th>
  );
}

/** What each eligibility verdict should say in a badge, and why. */
const ELIGIBILITY_TITLES: Record<EligibilityFilter, string> = {
  eligible: "Nothing this posting states rules you out.",
  unconfirmed: "Some requirement was stated by neither the posting nor your profile.",
  ineligible: "This posting states a hard requirement your profile contradicts.",
};

/**
 * Why a row has no fit score.
 *
 * Three different reasons produce the same em dash, and the reader should be
 * able to tell which one they are looking at (spec §12: only eligible jobs are
 * scored at all).
 */
function fitAbsenceReason(
  eligibility: Map<string, EligibilityFilter> | null,
  jobId: string,
): string {
  if (eligibility === null) return "Fill in your profile to score jobs against it.";
  if (eligibility.get(jobId) === "ineligible") {
    return "Not scored — this job fails a hard requirement.";
  }
  return "Too little of your profile could be compared against this posting to score it.";
}

export function JobTable({ rows, verdicts, eligibility, filters, now }: JobTableProps) {
  // With no profile there is no fit score for any row, so the column is a
  // stripe of em dashes taking width from the columns that say something.
  const showFit = eligibility !== null;

  if (rows.length === 0) {
    return (
      <p className="empty">
        No jobs match these filters. Try widening them, or run{" "}
        <code>npm run discover</code> to pull fresh postings from the boards in
        the company registry.
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table className="jobs">
        <thead>
          <tr>
            {/* Columns carry a class rather than relying on their position:
                hiding Fit used to shift every index after it, so the widths and
                the narrow-screen rules silently applied to the wrong columns. */}
            <SortHeader
              filters={filters}
              column="title"
              label="Role"
              className="col-role"
            />
            {showFit ? (
              <SortHeader
                filters={filters}
                column="fit"
                label="Fit"
                className="col-fit"
              />
            ) : null}
            <SortHeader
              filters={filters}
              column="company"
              label="Company"
              className="col-company"
            />
            <SortHeader
              filters={filters}
              column="location"
              label="Location"
              className="col-location"
            />
            {/* Remote and Source stay plain headers. Both hold a handful of
                fixed values that the filter bar above already lets you pick
                exactly, so sorting by them would only group rows you could
                have asked for outright. */}
            <th scope="col" className="col-remote">
              Remote
            </th>
            <SortHeader filters={filters} column="pay" label="Pay" className="col-pay" />
            <th scope="col" className="col-source">
              Source
            </th>
            <SortHeader
              filters={filters}
              column="seen"
              label="First seen"
              className="col-seen"
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => {
            const classified = verdicts.get(job.id);
            const eligible = eligibility?.get(job.id);
            return (
              <tr key={job.id}>
                <td className="col-role">
                  {/* One flex row: a long title truncates rather than pushing
                      the badges onto a second line, which is what made row
                      heights ragged and the table hard to scan. */}
                  <div className="role-cell">
                  <a className="job-title" href={`/jobs/${job.id}`} title={job.title}>
                    {job.title}
                  </a>
                  {job.status !== JobStatus.OPEN ? (
                    <span
                      className="badge badge-closed"
                      title="This posting no longer appears on the company's board."
                    >
                      {job.status.toLowerCase()}
                    </span>
                  ) : null}
                  {classified ? (
                    <span
                      className={`badge badge-${classified.verdict}`}
                      title={classified.reason}
                      aria-label={`Classifier: ${classified.verdict}. ${classified.reason}`}
                    >
                      {classified.verdict}
                    </span>
                  ) : null}
                  {eligible ? (
                    <span
                      className={`badge badge-elig-${eligible}`}
                      title={ELIGIBILITY_TITLES[eligible]}
                      aria-label={`Eligibility: ${eligible}. ${ELIGIBILITY_TITLES[eligible]}`}
                    >
                      {eligible}
                    </span>
                  ) : null}
                  <a
                    className="source-link"
                    href={job.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the employer's posting"
                  >
                    ↗
                  </a>
                  </div>
                </td>
                {showFit ? (
                  <td className="col-fit">
                    {job.fit && job.fit.score !== null ? (
                      <span
                        className="fit-score"
                        title={`Scored on ${Math.round(job.fit.coverage * 100)}% of the weights.`}
                      >
                        {job.fit.score}%
                      </span>
                    ) : (
                      <span
                        className="fit-none"
                        title={fitAbsenceReason(eligibility, job.id)}
                      >
                        —
                      </span>
                    )}
                  </td>
                ) : null}
                <td className="col-company">{job.companyName}</td>
                <td className="col-location">{formatLocation(job.location)}</td>
                <td className="col-remote">{formatEnum(job.remoteType)}</td>
                <td className="col-pay">
                  {formatSalary(job.salaryMin, job.salaryMax, job.currency)}
                </td>
                <td className="col-source">{formatEnum(job.atsType)}</td>
                <td className="col-seen" title={job.firstSeenAt.toISOString()}>
                  {formatAge(job.firstSeenAt, now)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
