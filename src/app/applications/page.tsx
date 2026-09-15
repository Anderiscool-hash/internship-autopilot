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
import type { ReviewGate } from "./review-panel";

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
  submitting: "Submitting. Refresh in a moment to see the result.",
  rejected: "Left un-applied.",
};

/**
 * Errors that need more explaining than the action can fit in a query string.
 *
 * Most errors arrive already written out — the state machine's own refusal
 * message, for instance — and those are shown verbatim. A key only appears
 * here when the useful answer is an instruction rather than a description.
 */
const ERROR_MESSAGES: Record<string, string> = {
  "no-daemon":
    "Nothing was submitted: the apply daemon is not running. Start it with `npm run daemon`, then approve again.",
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

  // Only the rows actually awaiting a decision get their attempt loaded. The
  // attempts table holds every run ever made; joining it onto a whole board to
  // fill in a panel that four cards will show is work nobody asked for.
  const waitingIds = applications
    .filter((application) => application.status === ApplicationStatus.WAITING_FOR_USER)
    .map((application) => application.id);

  const attempts = waitingIds.length
    ? await db.submissionAttempt.findMany({
        where: { applicationId: { in: waitingIds } },
        orderBy: { startedAt: "desc" },
        select: {
          applicationId: true,
          gates: true,
          confidence: true,
          screenshotPath: true,
        },
      })
    : [];

  // Newest first, so the first one seen per application is the current one.
  const latestAttempt = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!latestAttempt.has(attempt.applicationId)) {
      latestAttempt.set(attempt.applicationId, attempt);
    }
  }

  return (
    <main className="page page-wide">
      <h1>Applications</h1>
      <p className="lede">
        {applications.length === 0
          ? "Nothing tracked yet."
          : `${applications.length} tracked · ${countApplied(applications)} applied · ${countOutcome(applications, ApplicationOutcome.INTERVIEW)} interviews · ${countOutcome(applications, ApplicationOutcome.OFFER)} offers`}
      </p>

      <p className="note">
        <a href="/applications/export">Download CSV</a>
      </p>

      {saved && SAVED_MESSAGES[saved] ? (
        <div className="notice notice-ok">{SAVED_MESSAGES[saved]}</div>
      ) : null}
      {error ? (
        <div className="notice notice-error">{ERROR_MESSAGES[error] ?? error}</div>
      ) : null}

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
                  items.map((application) => {
                    const attempt = latestAttempt.get(application.id);
                    return (
                      <ApplicationCard
                        key={application.id}
                        application={application}
                        attempt={
                          attempt
                            ? {
                                gates: toReviewGates(attempt.gates),
                                confidence: attempt.confidence,
                                screenshotPath: attempt.screenshotPath,
                              }
                            : null
                        }
                      />
                    );
                  })
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

/**
 * Narrow the attempt's stored `gates` JSON to the shape the panel renders.
 *
 * Prisma hands this back as an untyped JsonValue, and it was written by a
 * different process possibly several versions ago. Casting it would move the
 * problem to render time, where a malformed row takes the entire tracker down
 * with it — so every entry is checked, and anything unrecognisable is simply
 * left out rather than shown as `undefined`.
 */
function toReviewGates(value: unknown): ReviewGate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ReviewGate =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).gate === "string" &&
      typeof (entry as Record<string, unknown>).passed === "boolean" &&
      typeof (entry as Record<string, unknown>).detail === "string",
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
