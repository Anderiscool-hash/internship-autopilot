/**
 * The application tracker (spec §24).
 *
 * Columns rather than a flat list, because the question this screen answers is
 * "what needs me right now?" — and the answer is a column, not a row. The
 * column definitions live in the state machine so that no application status
 * can exist without somewhere to appear.
 */

import { ApplicationOutcome, ApplicationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { listApplications, type ApplicationWithJob } from "@/lib/applications/store";
import { columnFor, TRACKER_COLUMNS } from "@/lib/applications/machine";
import { formatEnum } from "../jobs/format";
import { ApplicationCard } from "./application-card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Applications — Internship Autopilot",
};

interface TrackerPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const SAVED_MESSAGES: Record<string, string> = {
  moved: "Application updated.",
  outcome: "Outcome recorded.",
  notes: "Notes saved.",
  removed: "Removed from the tracker.",
};

export default async function ApplicationsPage({ searchParams }: TrackerPageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  const error = one(params, "error");

  const profile = await getProfile(db);
  if (!profile) {
    return (
      <main className="page page-wide">
        <h1>Applications</h1>
        <div className="notice">
          An application belongs to a person. <a href="/profile">Fill in your profile</a>{" "}
          first, then jobs can be tracked here.
        </div>
      </main>
    );
  }

  const applications = await listApplications(db, profile.id);
  const byColumn = new Map<string, ApplicationWithJob[]>();
  for (const application of applications) {
    const key = columnFor(application.status);
    const existing = byColumn.get(key);
    if (existing) existing.push(application);
    else byColumn.set(key, [application]);
  }

  return (
    <main className="page page-wide">
      <h1>Applications</h1>
      <p className="lede">
        {applications.length === 0
          ? "Nothing tracked yet."
          : `${applications.length} tracked · ${countApplied(applications)} applied · ${countOutcome(applications, ApplicationOutcome.INTERVIEW)} interviews · ${countOutcome(applications, ApplicationOutcome.OFFER)} offers`}
      </p>

      {saved && SAVED_MESSAGES[saved] ? (
        <div className="notice notice-ok">{SAVED_MESSAGES[saved]}</div>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      {applications.length === 0 ? (
        <p className="empty">
          Open a job from <a href="/jobs">the dashboard</a> and save it to start
          tracking it here.
        </p>
      ) : (
        <div className="board">
          {TRACKER_COLUMNS.map((column) => {
            const items = byColumn.get(column.key) ?? [];
            return (
              <section key={column.key} className="board-column">
                <h2>
                  {column.label} <span className="chip-count">{items.length}</span>
                </h2>
                {items.length === 0 ? (
                  <p className="board-empty">Nothing here.</p>
                ) : (
                  items.map((application) => (
                    <ApplicationCard key={application.id} application={application} />
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}

      <section>
        <h2>Statuses</h2>
        <p className="note">
          The columns group spec §23&rsquo;s workflow states. The bot moves an
          application one step at a time; you can always say what actually
          happened — &ldquo;I applied to this myself&rdquo; is legal from
          anywhere, because it is a report, not a step in the plan.
        </p>
        <p className="requirements">
          {TRACKER_COLUMNS.map((column) => (
            <span key={column.key} className="status-group">
              <strong>{column.label}:</strong>{" "}
              {column.statuses.map((status) => formatEnum(status)).join(", ")}
            </span>
          ))}
        </p>
      </section>
    </main>
  );
}

/** How many rows actually reached the employer. */
function countApplied(applications: ApplicationWithJob[]): number {
  return applications.filter((application) => application.appliedAt !== null).length;
}

/** How many rows carry a given outcome. */
function countOutcome(
  applications: ApplicationWithJob[],
  outcome: ApplicationStatus | ApplicationOutcome,
): number {
  return applications.filter((application) => application.outcome === outcome).length;
}
