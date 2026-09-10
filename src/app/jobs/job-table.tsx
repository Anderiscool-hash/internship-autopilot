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
import type { EligibilityFilter } from "@/lib/jobs/filters";
import type { ClassifiedJob } from "@/lib/jobs/list";
import type { JobListRow } from "@/lib/jobs/query";
import { formatAge, formatEnum, formatLocation, formatSalary } from "./format";

interface JobTableProps {
  rows: JobListRow[];
  verdicts: Map<string, ClassifiedJob>;
  /** Hard-eligibility verdicts, or null when there is no profile to check against. */
  eligibility: Map<string, EligibilityFilter> | null;
  now: Date;
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
  return "Nothing in your profile could be compared against this posting.";
}

export function JobTable({ rows, verdicts, eligibility, now }: JobTableProps) {
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
            <th scope="col">Role</th>
            <th scope="col">Fit</th>
            <th scope="col">Company</th>
            <th scope="col">Location</th>
            <th scope="col">Remote</th>
            <th scope="col">Pay</th>
            <th scope="col">Source</th>
            <th scope="col">First seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => {
            const classified = verdicts.get(job.id);
            const eligible = eligibility?.get(job.id);
            return (
              <tr key={job.id}>
                <td>
                  <a className="job-title" href={`/jobs/${job.id}`}>
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
                    >
                      {classified.verdict}
                    </span>
                  ) : null}
                  {eligible ? (
                    <span
                      className={`badge badge-elig-${eligible}`}
                      title={ELIGIBILITY_TITLES[eligible]}
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
                </td>
                <td>
                  {job.fit && job.fit.score !== null ? (
                    <span
                      className="fit-score"
                      title={`Scored on ${Math.round(job.fit.coverage * 100)}% of spec §12's weights.`}
                    >
                      {job.fit.score}%
                    </span>
                  ) : (
                    <span className="fit-none" title={fitAbsenceReason(eligibility, job.id)}>
                      —
                    </span>
                  )}
                </td>
                <td>{job.companyName}</td>
                <td>{formatLocation(job.location)}</td>
                <td>{formatEnum(job.remoteType)}</td>
                <td>{formatSalary(job.salaryMin, job.salaryMax, job.currency)}</td>
                <td>{formatEnum(job.atsType)}</td>
                <td title={job.firstSeenAt.toISOString()}>
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
