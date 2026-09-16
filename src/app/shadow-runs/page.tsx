/**
 * The shadow-run review queue (spec §20).
 *
 * One run, the oldest unverified one, and two buttons. Everything about this
 * screen is shaped by the fact that the backlog is the problem: 33 runs have
 * been recorded and one has ever been checked, and an unverified run counts
 * for nothing on the trust ladder — so those remaining runs are work already
 * done that is currently worth zero. A list view would let someone browse the
 * backlog; a queue makes them clear it.
 *
 * Which is also why there is no navigation between runs, no filter, and no
 * table of everything. The only decision this page asks for is the one in
 * front of you, and pressing either button loads the next.
 */

import { db } from "@/lib/db";
import { parseOutcomes } from "@/lib/shadow/outcomes-view";
import {
  atsStandings,
  nextUnverifiedRun,
  verificationProgress,
  type AtsStanding,
  type ShadowRunRow,
} from "@/lib/shadow/verdicts";
import { TRUST_THRESHOLDS } from "@/lib/apply/trust";
import type { FieldOutcome } from "@/lib/apply/shadow-types";
import { formatEnum, NOT_STATED } from "../jobs/format";
import { recordVerdictAction, undoVerdictAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Review shadow runs — Internship Autopilot",
};

interface ReviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * How each recorded status reads on screen.
 *
 * The glyph repeats what the word in the next column already says, on purpose:
 * the row rail is the only thing carrying colour here, and a colour with no
 * text beside it is a judgement some readers never receive. The glyph is
 * aria-hidden because the Status column is the real answer.
 */
const STATUS_VIEW: Record<FieldOutcome["status"], { mark: string; row: string }> = {
  filled: { mark: "✓", row: "check-pass" },
  chosen: { mark: "✓", row: "check-pass" },
  answered: { mark: "✓", row: "check-pass" },
  attached: { mark: "✓", row: "check-pass" },
  skipped: { mark: "–", row: "check-unknown" },
  failed: { mark: "✗", row: "check-fail" },
};

/** Where a value came from, in words rather than in the stored token. */
const SOURCE_LABELS: Record<FieldOutcome["source"], string> = {
  profile: "Profile",
  "answer-bank": "Answer bank",
  document: "Document",
  asked: "You were asked",
  email: "From email",
  none: NOT_STATED,
};

/** What each trust level lets the bot do (spec §21). */
const LEVEL_MEANING: Record<AtsStanding["level"], string> = {
  0: "Unsupported — no adapter.",
  1: "Parse postings only.",
  2: "Fill a form so you can look at it.",
  3: "Fill a form and offer it for you to submit.",
  4: "Submit unattended, once you opt in.",
};

/**
 * The bar this queue is actually working towards.
 *
 * Read from the thresholds rather than written out here, because trust.ts asks
 * for exactly that: the numbers live in one place so that changing them means
 * changing that constant and nothing else.
 */
const LEVEL_3 = TRUST_THRESHOLDS.find((threshold) => threshold.level === 3);
const LEVEL_3_RUNS = LEVEL_3 ? LEVEL_3.minVerifiedRuns : 10;
const LEVEL_3_RATE = LEVEL_3 ? LEVEL_3.minCorrectRate : 0.9;

/**
 * The run whose verdict was just recorded, if the URL still names one.
 *
 * Queried here rather than through verdicts.ts because ShadowRunRow is the
 * *unverified* view by design — it carries neither the verdict nor the job the
 * run belongs to, and this banner is made of precisely those two things.
 */
async function justRecorded(runId: string | undefined) {
  if (runId === undefined) return null;

  return db.shadowRun.findFirst({
    // Both halves matter. An id nobody recognises is a hand-edited or stale
    // URL, and a run with no verdict has already been undone — in another tab,
    // or by a reload of this very redirect. Neither is an error worth showing:
    // nothing was lost either way, and the queue below is still the truth.
    where: { id: runId, verdict: { not: null } },
    select: {
      id: true,
      verdict: true,
      job: { select: { title: true, company: { select: { name: true } } } },
    },
  });
}

/** What the banner needs, shaped by the query rather than restated by hand. */
type RecordedRun = NonNullable<Awaited<ReturnType<typeof justRecorded>>>;


export default async function ShadowRunsPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  const error = one(params, "error");

  const progress = await verificationProgress(db);
  const run = await nextUnverifiedRun(db);
  const undone = await justRecorded(one(params, "undone"));
  // Kept on the row itself: an undone verdict leaves its note behind, and
  // nextUnverifiedRun already selects it.
  const note = run?.verdictNote?.trim() ? run.verdictNote.trim() : null;

  return (
    <main className="page page-wide">
      <h1>Review shadow runs</h1>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* Above both branches, not just the queue: the verdict most likely to
          need taking back is the last one, and recording it is what empties
          the queue. A banner that only appeared beside a next run would
          vanish at exactly the moment it was the only way back. */}
      {undone ? <UndoBanner run={undone} /> : null}

      {run === null ? (
        <>
          <p className="lede">
            {progress.total === 0
              ? "No shadow runs have been recorded yet."
              : `All ${progress.total} recorded runs have been checked. Nothing is waiting on you.`}
          </p>
          {progress.total === 0 ? (
            <p className="empty">
              Open a job from <a href="/jobs">the dashboard</a> and start a shadow
              run. It fills the real form without submitting it, and lands here to
              be checked.
            </p>
          ) : (
            <Standings standings={await atsStandings(db)} />
          )}
        </>
      ) : (
        <>
          {/* The remaining count, not the verified one, and in the largest type
              on the page: "1 of 33 verified" is a report, "32 left" is a thing a
              person can finish. */}
          <p className="fit-headline">
            {progress.pending} {progress.pending === 1 ? "run" : "runs"} left to check
          </p>
          <p className="lede">
            {progress.verified} of {progress.total} verified · oldest first
          </p>

          <RunReview run={run} note={note} />
        </>
      )}
    </main>
  );
}

/**
 * What was just recorded, and the one screen on which it can be taken back.
 *
 * The queue's whole rhythm is press a button, get the next run, which is also
 * the rhythm in which a mis-tap happens and is gone. Nothing else in the app
 * can edit a verdict, and a wrong one does not sit quietly: it is counted into
 * the trust ladder that decides whether the bot may submit real applications.
 */
function UndoBanner({ run }: { run: RecordedRun }) {
  // verdicts.ts counts an exact "correct" as a pass and treats everything else
  // in that unconstrained column as a failure. Reading the word the same way
  // means this banner can never describe a run more kindly than the ladder
  // that is about to act on it.
  const verdict = run.verdict === "correct" ? "Correct" : "Wrong";
  // Company and title, because that is what the person remembers deciding
  // about. The heading below identifies runs by ATS and date, which is the
  // right key for a queue of forms and the wrong one for "did I just mean to
  // do that" — two Greenhouse runs from the same day are indistinguishable.
  const label = `${run.job.company.name} — ${run.job.title}`;

  return (
    // Plain .notice, not .notice-ok: green reads as "that was the right
    // answer", and whether it was is exactly what the Undo beside it is
    // asking. The verdict is spelled out in the sentence either way, so
    // nothing here is carried by colour alone.
    <div className="notice">
      <p>
        Recorded <strong>{verdict}</strong> on {label}.
      </p>
      <form action={undoVerdictAction}>
        <input type="hidden" name="runId" value={run.id} />
        <button
          type="submit"
          className="small-button"
          // "Undo" is unambiguous next to the sentence and useless read out of
          // context, which is how a screen reader user meets a list of
          // controls. The name says which verdict on which run.
          aria-label={`Undo the ${verdict} verdict on ${label}`}
        >
          Undo
        </button>
      </form>
    </div>
  );
}

/** Everything known about the run in hand, and the two buttons. */
function RunReview({ run, note }: { run: ShadowRunRow; note: string | null }) {
  const outcomes = parseOutcomes(run.outcomes);
  const fromEmail = outcomes.filter((outcome) => outcome.source === "email");
  // fieldsTotal is its own column and survives whatever happened to the JSON,
  // so the gap between the two is the honest measure of how much of this run's
  // per-field record could not be read back.
  const unreadable = Math.max(0, run.fieldsTotal - outcomes.length);

  return (
    <section>
      <h2>
        {formatEnum(run.atsType)} · {run.createdAt.toISOString().slice(0, 10)}
      </h2>

      <p className="card-status">
        {run.blockingGaps.length > 0 ? (
          <span
            className="badge badge-reject"
            aria-label={`${run.blockingGaps.length} required fields were left empty, so this run would not have applied`}
          >
            Would not have applied
          </span>
        ) : (
          <span
            className="badge badge-keep"
            aria-label="Every required field was filled, so this run would have been submittable"
          >
            Would have applied
          </span>
        )}
        {run.captcha ? (
          <span className="badge badge-ambiguous" aria-label="The form showed a CAPTCHA">
            CAPTCHA
          </span>
        ) : null}
        {run.loginRequired ? (
          <span
            className="badge badge-ambiguous"
            aria-label="The form required an account to be signed in"
          >
            Login required
          </span>
        ) : null}
      </p>

      <p>
        <a className="apply-link" href={run.url} target="_blank" rel="noopener noreferrer">
          Open the real form
        </a>
      </p>

      <dl className="facts">
        <div>
          <dt>Fields</dt>
          <dd>{run.fieldsTotal}</dd>
        </div>
        <div>
          <dt>Filled</dt>
          <dd>{run.fieldsFilled}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{run.fieldsSkipped}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{run.fieldsFailed}</dd>
        </div>
      </dl>

      {run.blockingGaps.length > 0 ? (
        <div className="notice notice-warn">
          <p>Required fields left empty. A real submission would have been refused:</p>
          <ul>
            {run.blockingGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The screenshot is the evidence. Everything else on this page is the
          bot's own account of what it did, and the question being asked is
          precisely whether that account matches the form. */}
      <img
        src={`/shadow-runs/${run.id}/screenshot`}
        alt={`The ${formatEnum(run.atsType)} application form as the bot left it, with ${run.fieldsFilled} of ${run.fieldsTotal} fields filled in.`}
        // globals.css has no img rule and one element does not earn one. These
        // three keep a full-page capture inside the column and give it the same
        // edge as every other framed block on the screen.
        style={{
          maxWidth: "100%",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
        }}
      />

      <h3>What went into the form</h3>

      {outcomes.length === 0 ? (
        <p className="empty-compact">
          This run recorded no readable per-field detail. Judge it from the
          screenshot and the counts above.
        </p>
      ) : (
        <table className="checks">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Field</th>
              <th scope="col">Status</th>
              <th scope="col">Value</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((outcome, index) => {
              const view = STATUS_VIEW[outcome.status];
              return (
                // The label is the natural key but is not unique — two
                // "Address" fields on one form is ordinary.
                <tr key={`${outcome.label}-${index}`} className={view.row}>
                  <td className="mark" aria-hidden="true">
                    {view.mark}
                  </td>
                  <th scope="row">{outcome.label}</th>
                  <td>{formatEnum(outcome.status)}</td>
                  <td>{outcome.detail.length > 0 ? outcome.detail : NOT_STATED}</td>
                  <td>
                    {outcome.source === "email" ? (
                      <span
                        className="badge badge-ambiguous"
                        aria-label="Read out of your mailbox — the one value you never typed"
                      >
                        {SOURCE_LABELS.email}
                      </span>
                    ) : (
                      SOURCE_LABELS[outcome.source]
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {fromEmail.length > 0 ? (
        <p className="note">
          {fromEmail.length === 1 ? "One value" : `${fromEmail.length} values`} came
          from a verification email rather than from you. Check{" "}
          {fromEmail.length === 1 ? "it" : "them"} against the screenshot first: a
          code read out of a mailbox is the one thing here you cannot confirm from
          memory.
        </p>
      ) : null}

      {unreadable > 0 ? (
        <p className="note">
          {unreadable} of this run&rsquo;s {run.fieldsTotal} field records could not
          be read back and are not listed. The screenshot still shows them.
        </p>
      ) : null}

      <form className="card-form" action={recordVerdictAction}>
        <input type="hidden" name="runId" value={run.id} />

        <label className="field">
          <span>Note (optional)</span>
          <textarea
            name="note"
            rows={3}
            // Non-empty only when this run has been here before: undoing a
            // verdict keeps the note, so what someone wrote about this form
            // is waiting for them when it comes back round. defaultValue and
            // not value — the browser owns the box after it renders, and this
            // page has no client JavaScript to hand it back.
            defaultValue={note ?? undefined}
            placeholder="e.g. the phone number went into the postcode field"
          />
        </label>

        {/* One form, two submits: the note belongs to whichever verdict is
            pressed, and picking a verdict from a dropdown and then pressing
            Save is two decisions where there is only one. */}
        <div className="form-actions">
          <button type="submit" name="verdict" value="correct">
            Correct
          </button>
          <button type="submit" name="verdict" value="wrong" className="secondary-button">
            Wrong
          </button>
        </div>
      </form>

      <p className="note">
        &ldquo;Correct&rdquo; means every value in the screenshot is in the right
        field and says the right thing. A run that failed to fill something is
        still correct if it recorded that honestly &mdash; what is being judged is
        the bot&rsquo;s account of itself, not its luck with the page.
      </p>
    </section>
  );
}

/**
 * What clearing the queue bought: where each ATS now sits on the trust ladder.
 *
 * This is the payoff, so it is the empty state rather than a screen of its own.
 * Verifying runs has no visible effect anywhere else — a level is computed from
 * verdicts and never stored — so without this, the reward for checking the last
 * run would be a page saying there is nothing to do.
 */
function Standings({ standings }: { standings: AtsStanding[] }) {
  if (standings.length === 0) {
    return <p className="empty">No verified runs to stand on yet.</p>;
  }

  return (
    <section>
      <h2>What that bought</h2>
      <p className="note">
        Level 3 is the one worth having: it is where the bot may fill a form and
        offer it for you to submit. An ATS reaches it on {LEVEL_3_RUNS} verified
        runs with {Math.round(LEVEL_3_RATE * 100)}% of them correct.
      </p>

      <table className="checks">
        <thead>
          <tr>
            <th scope="col">ATS</th>
            <th scope="col">Verified</th>
            <th scope="col">Correct</th>
            <th scope="col">Level</th>
            <th scope="col">What it can do</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((standing) => (
            <tr key={standing.atsType}>
              <th scope="row">{formatEnum(standing.atsType)}</th>
              <td>{standing.verified}</td>
              <td>{standing.correct}</td>
              <td>
                <span
                  className={standing.level >= 3 ? "badge badge-keep" : "badge"}
                  aria-label={`Trust level ${standing.level} of 4. ${LEVEL_MEANING[standing.level]}`}
                >
                  Level {standing.level}
                </span>
              </td>
              <td>
                {LEVEL_MEANING[standing.level]}
                {standing.level < 3 && standing.verified < LEVEL_3_RUNS
                  ? ` ${LEVEL_3_RUNS - standing.verified} more verified runs would put level 3 in reach.`
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
