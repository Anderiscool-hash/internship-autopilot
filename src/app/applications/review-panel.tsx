/**
 * The level-3 review surface: what the bot filled in, and your decision.
 *
 * This lives inside the tracker's existing "Needs you" column rather than on a
 * page of its own. That column already means "this one is your turn", and a
 * second inbox for the same concept is how things stop being checked: two
 * places to look means one of them goes unlooked-at, and the one that rots is
 * always the one you have to remember to open. So the review sits on the card
 * that is already in front of you.
 *
 * The panel never offers a button the submit guard would refuse. That is the
 * same rule the card itself follows when it computes its moves from the state
 * machine — an approve button that fails when pressed teaches people that the
 * buttons are guesses.
 */

import { approveSubmissionAction, rejectSubmissionAction } from "./actions";

/** One preflight gate, as the attempt recorded it. */
export interface ReviewGate {
  gate: string;
  passed: boolean;
  detail: string;
}

export function ReviewPanel({
  applicationId,
  gates,
  confidence,
  screenshotPath,
}: {
  applicationId: string;
  gates: ReviewGate[];
  confidence: number | null;
  screenshotPath: string | null;
}) {
  const failed = gates.filter((g) => !g.passed);
  const ready = failed.length === 0;

  // .notice rather than a new class: that box already means "a contained thing
  // the page is telling you about", which is what this is, and the design
  // system asks for reuse before invention.
  return (
    <section className="notice">
      <p className="card-status">
        <span className={ready ? "badge badge-keep" : "badge badge-reject"}>
          {ready
            ? "Ready to submit"
            : `${failed.length} ${failed.length === 1 ? "check" : "checks"} did not pass`}
        </span>
        {confidence !== null ? (
          <span className="card-fit">{confidence}% confidence</span>
        ) : null}
      </p>

      {gates.length === 0 ? (
        <p className="note">
          This attempt recorded no checks, so there is nothing to review yet.
        </p>
      ) : (
        <ul className="requirements">
          {gates.map((gate) => (
            <li key={gate.gate} className={gate.passed ? "check-pass" : "check-fail"}>
              {/* The glyph carries the verdict as well as the colour: a red tick
                  and a green cross would both read as "fine" at a glance. */}
              <span className="mark">{gate.passed ? "✓" : "✗"}</span>{" "}
              <strong>{gate.gate}</strong> &mdash; {gate.detail}
            </li>
          ))}
        </ul>
      )}

      {screenshotPath !== null ? (
        // A local filesystem path, not a URL — nothing serves these, so showing
        // it as an <img> would render a broken image and hide the one useful
        // thing: where the file actually is.
        <p className="note">
          Screenshot: <code>{screenshotPath}</code>
        </p>
      ) : null}

      {ready ? null : (
        <p className="note">
          This cannot be submitted until every check passes. Fix what the failed
          checks name, or decide not to apply.
        </p>
      )}

      <div className="card-actions">
        {ready ? (
          <form action={approveSubmissionAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <button type="submit" className="small-button">
              Approve and submit
            </button>
          </form>
        ) : null}

        <form action={rejectSubmissionAction}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <button type="submit" className="link-button">
            Do not apply
          </button>
        </form>
      </div>
    </section>
  );
}
