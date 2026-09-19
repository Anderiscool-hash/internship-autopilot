/**
 * One application on the tracker board (spec §24).
 *
 * The buttons offered are computed from the state machine rather than
 * hard-coded per column, so a move that appears on screen is always a move the
 * machine will accept. Anything else would mean showing people buttons that
 * fail when pressed.
 */

import { ApplicationOutcome, ApplicationStatus } from "@prisma/client";
import { allowedTransitions } from "@/lib/applications/machine";
import type { ApplicationWithJob } from "@/lib/applications/store";
import { formatEnum } from "../jobs/format";
import { notesAction, outcomeAction, transitionAction, untrackAction } from "./actions";
import { ReviewPanel, type ReviewGate } from "./review-panel";
import { draftMessageAction } from "../contacts/actions";

/**
 * The moves worth putting on a card, in the order a person would want them.
 *
 * The machine allows more than this — every exception state is reachable from
 * everywhere — but a tracker card offering "CAPTCHA" as a button would be
 * noise. Those states are set by the apply worker, not by hand.
 */
const OFFERED: { status: ApplicationStatus; label: string }[] = [
  { status: ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION, label: "Applied" },
  { status: ApplicationStatus.CONFIRMED, label: "Confirmed" },
  { status: ApplicationStatus.QUEUED, label: "Queue" },
  { status: ApplicationStatus.SKIPPED, label: "Skip" },
  { status: ApplicationStatus.DISCOVERED, label: "Reopen" },
  { status: ApplicationStatus.JOB_CLOSED, label: "Closed" },
];

export function ApplicationCard({
  application,
  attempt,
}: {
  application: ApplicationWithJob;
  /** The latest submission attempt, only fetched for rows awaiting review. */
  attempt?: { gates: ReviewGate[]; confidence: number | null; screenshotPath: string | null } | null;
}) {
  const allowed = new Set(allowedTransitions(application.status));
  const moves = OFFERED.filter((move) => allowed.has(move.status));
  // Only WAITING_FOR_USER means "the form is filled and it is your turn". The
  // other exception states are blocked on something else entirely, and a
  // review panel there would invite an approval that cannot be acted on.
  const review =
    application.status === ApplicationStatus.WAITING_FOR_USER && attempt ? attempt : null;

  return (
    <article className="card">
      <a className="job-title" href={`/jobs/${application.job.id}`}>
        {application.job.title}
      </a>
      <p className="card-sub">
        {application.job.company.name}
        {application.job.location ? ` · ${application.job.location}` : ""}
      </p>

      <section className="card-form" aria-label={`Contacts at ${application.job.company.name}`}>
        <strong>People at this company</strong>
        {application.job.company.contacts.length > 0 ? (
          <ul className="note">
            {application.job.company.contacts.slice(0, 5).map((contact) => {
              const email = contact.emails.find((item) => item.status !== "BOUNCED");
              return (
                <li key={contact.id}>
                  <span>{contact.firstName} {contact.lastName}</span>
                  {contact.title ? ` - ${contact.title}` : ""}
                  {email ? <> &middot; <code>{email.address}</code></> : null}
                  <form action={draftMessageAction} className="inline-form">
                    <input type="hidden" name="id" value={contact.id} />
                    <input type="hidden" name="applicationId" value={application.id} />
                    <button type="submit" className="small-button" disabled={!email}>Draft email</button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : <p className="note">No researched contacts yet.</p>}
        <a className="note" href={`/contacts?company=${application.job.company.id}`}>
          {application.job.company.contacts.length ? "View all contacts" : "Add or view contacts"}
        </a>
      </section>

      <p className="card-status">
        <span className="badge">{formatEnum(application.status)}</span>
        {application.outcome ? (
          <span className="badge badge-outcome">{formatEnum(application.outcome)}</span>
        ) : null}
        {application.fitScore !== null ? (
          <span className="card-fit">{application.fitScore}% fit</span>
        ) : null}
      </p>

      {application.appliedAt ? (
        <p className="card-sub">
          Applied {application.appliedAt.toISOString().slice(0, 10)}
        </p>
      ) : null}

      {review ? (
        <ReviewPanel
          applicationId={application.id}
          gates={review.gates}
          confidence={review.confidence}
          screenshotPath={review.screenshotPath}
        />
      ) : null}

      <div className="card-actions">
        {moves.map((move) => (
          <form key={move.status} action={transitionAction}>
            <input type="hidden" name="applicationId" value={application.id} />
            <input type="hidden" name="to" value={move.status} />
            <button type="submit" className="small-button">
              {move.label}
            </button>
          </form>
        ))}
      </div>

      {/* Details are collapsed: a board of twenty cards should stay scannable,
          and outcome and notes are things you go looking for. */}
      <details>
        <summary>Outcome &amp; notes</summary>

        <form className="card-form" action={outcomeAction}>
          <input type="hidden" name="applicationId" value={application.id} />
          <label className="field">
            <span>Outcome</span>
            <select name="outcome" defaultValue={application.outcome ?? ""}>
              <option value="">None yet</option>
              {Object.values(ApplicationOutcome).map((outcome) => (
                <option key={outcome} value={outcome}>
                  {formatEnum(outcome)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="small-button">
            Save outcome
          </button>
        </form>

        <form className="card-form" action={notesAction}>
          <input type="hidden" name="applicationId" value={application.id} />
          <label className="field">
            <span>Notes</span>
            <textarea name="notes" rows={3} defaultValue={application.notes ?? ""} />
          </label>
          <button type="submit" className="small-button">
            Save notes
          </button>
        </form>

        <form action={untrackAction}>
          <input type="hidden" name="applicationId" value={application.id} />
          <button type="submit" className="link-button">
            Remove from tracker
          </button>
        </form>
      </details>
    </article>
  );
}
