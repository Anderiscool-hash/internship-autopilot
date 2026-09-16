"use server";

/**
 * The verdict button behind the review queue (spec §20).
 *
 * Same pattern as the tracker: a plain form post, no client JavaScript, the
 * result reported by where you end up. Here that is the whole interaction —
 * the redirect lands back on /shadow-runs, which serves the next unverified
 * run, so pressing a button and getting the next form is the confirmation. A
 * "saved" banner would be describing something the page already shows.
 *
 * The one thing the next run cannot show you is the run you just left, which
 * is why the redirect carries `?undone=` — not to announce a save, but to keep
 * the previous run reachable for exactly one screen. At this speed a mis-tap is
 * ordinary, and the verdict a mis-tap records is counted straight into the
 * trust ladder that decides whether the bot may submit real applications.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clearVerdict, recordVerdict, type Verdict } from "@/lib/shadow/verdicts";

/** Read one string field off a submitted form. */
function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Bounce back to the queue with a message. */
function back(params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/shadow-runs?${query}`);
}

/** Narrow a submitted string to a verdict the trust ladder counts, or null. */
function toVerdict(value: string | null): Verdict | null {
  return value === "correct" || value === "wrong" ? value : null;
}

/**
 * Record whether the bot filled this run's form correctly.
 *
 * Which button was pressed arrives as the `verdict` field, because a submit
 * button only posts its value when it is the one that submitted the form. That
 * is also why an absent verdict is refused rather than defaulted: the column
 * is an unconstrained String feeding the trust ladder, which counts anything
 * that is not exactly "correct" as a failure. A default here would be silently
 * voting on an adapter's promotion on the candidate's behalf.
 */
export async function recordVerdictAction(form: FormData): Promise<void> {
  const runId = field(form, "runId");
  const verdict = toVerdict(field(form, "verdict"));

  if (runId === null || verdict === null) {
    back({ error: "That verdict could not be recorded. Press Correct or Wrong." });
  }

  await recordVerdict(db, runId, verdict, field(form, "note"));

  // The nav's backlog badge reads the same count this just changed.
  revalidatePath("/shadow-runs");
  revalidatePath("/", "layout");
  // Same bounce as every other exit from this file, carrying the run that was
  // just decided so the next screen can offer it back.
  back({ undone: runId });
}

/**
 * Take a verdict back off a run and return it to the queue.
 *
 * The clearing itself lives in verdicts.ts with the writing, because the rule
 * that makes undo safe is a rule about the column: it nulls `verdict` and
 * `verifiedAt` and deliberately keeps `verdictNote`, so the sentence the
 * reviewer wrote about this run is still attached when the run comes back
 * round. Undoing costs them the tap, not the reasoning.
 *
 * Unverified is the honest state to land in, not a reversal to the other
 * verdict: someone who mis-tapped Correct has not thereby decided Wrong, and
 * an unverified run counts for nothing on the trust ladder rather than
 * counting against the adapter.
 */
export async function undoVerdictAction(form: FormData): Promise<void> {
  const runId = field(form, "runId");

  // Refused rather than guessed at, for the same reason a missing verdict is.
  // "Undo the last one" would mean this action deciding which run that was,
  // and clearing the wrong run's verdict is the exact mistake it exists to fix.
  if (runId === null) {
    back({ error: "That verdict could not be undone. No run was named." });
  }

  await clearVerdict(db, runId);

  // The nav's backlog badge reads the same count this just changed — a run
  // handed back to the queue has to make the badge go up again, or the two
  // disagree about how much work is left.
  revalidatePath("/shadow-runs");
  revalidatePath("/", "layout");
  redirect("/shadow-runs");
}
