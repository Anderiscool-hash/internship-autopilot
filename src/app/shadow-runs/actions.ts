"use server";

/**
 * The verdict button behind the review queue (spec §20).
 *
 * Same pattern as the tracker: a plain form post, no client JavaScript, the
 * result reported by where you end up. Here that is the whole interaction —
 * the redirect lands back on /shadow-runs, which serves the next unverified
 * run, so pressing a button and getting the next form is the confirmation. A
 * "saved" banner would be describing something the page already shows.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { recordVerdict, type Verdict } from "@/lib/shadow/verdicts";

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
  redirect("/shadow-runs");
}
