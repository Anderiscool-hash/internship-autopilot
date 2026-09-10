/**
 * Search analytics (spec §29).
 *
 * Reads the tracker and answers "how is this going?" — response, interview and
 * offer rates, and where they come from. Rates over small samples are printed
 * as counts rather than percentages, because a percentage computed from three
 * applications reads as a fact and is not one.
 */

import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { listApplications } from "@/lib/applications/store";
import {
  breakdownBy,
  MIN_SAMPLE,
  summarize,
  type AnalyticsApplication,
  type Rate,
} from "@/lib/analytics/summarize";
import { formatEnum } from "../jobs/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analytics — Internship Autopilot",
};

/** Render a rate, or say plainly that there is not enough data for one. */
function RateCell({ rate }: { rate: Rate }) {
  if (rate.percent === null) {
    return (
      <span className="rate-unknown" title={`Needs at least ${MIN_SAMPLE} applications.`}>
        {rate.numerator}/{rate.denominator}
      </span>
    );
  }
  return (
    <span title={`${rate.numerator} of ${rate.denominator}`}>{rate.percent}%</span>
  );
}

export default async function AnalyticsPage() {
  const profile = await getProfile(db);
  if (!profile) {
    return (
      <main className="page page-wide">
        <h1>Analytics</h1>
        <div className="notice">
          Nothing to measure yet. <a href="/profile">Fill in your profile</a>, then
          track applications.
        </div>
      </main>
    );
  }

  const applications = await listApplications(db, profile.id);
  // The ATS comes along with the job in one query — a per-row lookup here
  // would be one round trip per application on a page whose whole job is to
  // summarize them.
  const rows: AnalyticsApplication[] = applications.map((application) => ({
    appliedAt: application.appliedAt,
    outcome: application.outcome,
    fitScore: application.fitScore,
    companyName: application.job.company.name,
    atsType: application.job.atsType,
  }));

  const summary = summarize(rows);
  const byCompany = breakdownBy(rows, (row) => row.companyName);
  const byAts = breakdownBy(rows, (row) => row.atsType);

  return (
    <main className="page page-wide">
      <h1>Analytics</h1>
      <p className="lede">
        How the search is actually going (spec §29). Percentages appear once
        there are at least {MIN_SAMPLE} applications to compute them from —
        below that you see the raw counts, because a rate from three
        applications is not a rate.
      </p>

      {summary.applied === 0 ? (
        <p className="empty">
          No applications submitted yet. Mark one as applied on{" "}
          <a href="/applications">the tracker</a> and the numbers start here.
        </p>
      ) : null}

      <dl className="facts">
        <div>
          <dt>Tracked</dt>
          <dd>{summary.tracked}</dd>
        </div>
        <div>
          <dt>Applied</dt>
          <dd>{summary.applied}</dd>
        </div>
        <div>
          <dt>Responses</dt>
          <dd>{summary.responses}</dd>
        </div>
        <div>
          <dt>Interviews</dt>
          <dd>{summary.interviews}</dd>
        </div>
        <div>
          <dt>Offers</dt>
          <dd>{summary.offers}</dd>
        </div>
        <div>
          <dt>Ghosted</dt>
          <dd>{summary.ghosted}</dd>
        </div>
      </dl>

      <table className="checks">
        <tbody>
          <tr>
            <th scope="row">Response rate</th>
            <td className="mark">
              <RateCell rate={summary.responseRate} />
            </td>
            <td>Anything other than silence — including a rejection.</td>
          </tr>
          <tr>
            <th scope="row">Interview rate</th>
            <td className="mark">
              <RateCell rate={summary.interviewRate} />
            </td>
            <td>Reached at least a first interview.</td>
          </tr>
          <tr>
            <th scope="row">Offer rate</th>
            <td className="mark">
              <RateCell rate={summary.offerRate} />
            </td>
            <td>Ended in an offer.</td>
          </tr>
          <tr>
            <th scope="row">Average fit applied</th>
            <td className="mark">
              {summary.averageFitApplied === null ? "—" : `${summary.averageFitApplied}%`}
            </td>
            <td>
              Mean fit score of the jobs you actually applied to (spec §12).
            </td>
          </tr>
        </tbody>
      </table>

      {byCompany.length > 0 ? (
        <section>
          <h2>By company</h2>
          <BreakdownTable rows={byCompany} />
        </section>
      ) : null}

      {byAts.length > 0 ? (
        <section>
          <h2>By ATS</h2>
          <BreakdownTable rows={byAts} formatKey={formatEnum} />
        </section>
      ) : null}
    </main>
  );
}

/** One breakdown table (spec §29's "also analyze" list). */
function BreakdownTable({
  rows,
  formatKey = (key: string) => key,
}: {
  rows: { key: string; applied: number; interviews: number; offers: number; interviewRate: Rate }[];
  formatKey?: (key: string) => string;
}) {
  return (
    <div className="table-wrap">
      <table className="jobs">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Applied</th>
            <th scope="col">Interviews</th>
            <th scope="col">Offers</th>
            <th scope="col">Interview rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{formatKey(row.key)}</td>
              <td>{row.applied}</td>
              <td>{row.interviews}</td>
              <td>{row.offers}</td>
              <td>
                <RateCell rate={row.interviewRate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
