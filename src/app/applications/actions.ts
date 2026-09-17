"use server";

/**
 * Server actions behind the tracker (spec §24) and the job page's Save button.
 *
 * Same pattern as the profile screen: plain form posts, no client JavaScript,
 * results reported through a redirect. Every one of them starts by finding the
 * candidate, because an application belongs to a person — with no profile
 * saved there is nobody to track jobs for, and saying so is more useful than
 * quietly doing nothing.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApplicationOutcome, ApplicationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { submitApplyRun } from "@/lib/apply/daemon-client";
import { getProfile } from "@/lib/candidate/store";
import {
  setNotes,
  setOutcome,
  trackJob,
  transitionApplication,
  untrackApplication,
} from "@/lib/applications/store";

// Next.js dispatches server actions by action ID, not by route, so a POST to any
// path the middleware skips can still reach the actions below. The check has to
// live in each action itself; middleware cannot be the boundary for these.
import { requireAccess } from "@/lib/auth/guard";

/** Read one string field off a submitted form. */
function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Bounce back to wherever the form was submitted from, with a message. */
function back(path: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`${path}?${query}`);
}

/** Narrow a submitted string to a real status, or null. */
function toStatus(value: string | null): ApplicationStatus | null {
  if (value === null) return null;
  return value in ApplicationStatus
    ? ApplicationStatus[value as keyof typeof ApplicationStatus]
    : null;
}

/** Put a job on the tracker from the job detail page. */
export async function trackJobAction(form: FormData): Promise<void> {
  await requireAccess();

  const jobId = field(form, "jobId");
  const status = toStatus(field(form, "status")) ?? ApplicationStatus.DISCOVERED;
  const rawFit = field(form, "fitScore");
  const fitScore = rawFit !== null && /^\d+$/.test(rawFit) ? Number(rawFit) : null;
  const returnTo = `/jobs/${jobId ?? ""}`;

  const profile = await getProfile(db);
  if (!profile) {
    back(returnTo, { error: "Save your profile before tracking applications." });
  }
  if (jobId === null) back(returnTo, { error: "No job was given." });

  const { created } = await trackJob(db, profile.id, jobId, status, fitScore);
  revalidatePath(returnTo);
  revalidatePath("/applications");
  back(returnTo, { saved: created ? "tracked" : "already" });
}

/** Move an application to another state (spec §23). */
export async function transitionAction(form: FormData): Promise<void> {
  await requireAccess();

  const applicationId = field(form, "applicationId");
  const to = toStatus(field(form, "to"));
  const returnTo = field(form, "returnTo") ?? "/applications";

  const profile = await getProfile(db);
  if (!profile || applicationId === null || to === null) {
    back(returnTo, { error: "That change could not be applied." });
  }

  const result = await transitionApplication(db, profile.id, applicationId, to);
  revalidatePath("/applications");
  revalidatePath(returnTo);
  back(returnTo, result.ok ? { saved: "moved" } : { error: result.error });
}

/** Record an outcome: OA, interview, offer, rejection (spec §24). */
export async function outcomeAction(form: FormData): Promise<void> {
  await requireAccess();

  const applicationId = field(form, "applicationId");
  const raw = field(form, "outcome");
  const outcome =
    raw !== null && raw in ApplicationOutcome
      ? ApplicationOutcome[raw as keyof typeof ApplicationOutcome]
      : null;

  const profile = await getProfile(db);
  if (!profile || applicationId === null) {
    back("/applications", { error: "That change could not be applied." });
  }

  const result = await setOutcome(db, profile.id, applicationId, outcome);
  revalidatePath("/applications");
  back("/applications", result.ok ? { saved: "outcome" } : { error: result.error });
}

/** Save notes against an application. */
export async function notesAction(form: FormData): Promise<void> {
  await requireAccess();

  const applicationId = field(form, "applicationId");
  const notes = field(form, "notes");

  const profile = await getProfile(db);
  if (!profile || applicationId === null) {
    back("/applications", { error: "That change could not be applied." });
  }

  const result = await setNotes(db, profile.id, applicationId, notes);
  revalidatePath("/applications");
  back("/applications", result.ok ? { saved: "notes" } : { error: result.error });
}

/** Remove a row from the tracker entirely. */
export async function untrackAction(form: FormData): Promise<void> {
  await requireAccess();

  const applicationId = field(form, "applicationId");

  const profile = await getProfile(db);
  if (!profile || applicationId === null) {
    back("/applications", { error: "That change could not be applied." });
  }

  const removed = await untrackApplication(db, profile.id, applicationId);
  revalidatePath("/applications");
  back("/applications", removed ? { saved: "removed" } : { error: "Nothing to remove." });
}

/**
 * Approve the filled form and hand it to the daemon to submit.
 *
 * This is the only thing in the whole application that produces an
 * authorization, and it produces one naming the person and the moment: who
 * said yes, and when. Never a boolean — a `true` sitting in a row months later
 * cannot tell you whether anybody actually looked, and an authorization that
 * cannot be attributed is not one.
 */
export async function approveSubmissionAction(form: FormData): Promise<void> {
  await requireAccess();

  const profile = await getProfile(db);
  if (!profile) {
    back("/applications", { error: "Save your profile before submitting applications." });
  }

  const applicationId = field(form, "applicationId");
  if (applicationId === null) {
    back("/applications", { error: "That change could not be applied." });
  }

  const runId = await submitApplyRun({
    applicationId,
    candidateId: profile.id,
    authorization: {
      kind: "human-approval",
      actor: profile.email,
      at: new Date().toISOString(),
    },
  });

  // No daemon, no submission. Reporting this as success would be the worst
  // possible lie: the person walks away believing they applied.
  if (runId === null) back("/applications", { error: "no-daemon" });

  revalidatePath("/applications");
  back("/applications", { saved: "submitting" });
}

/** Decide, after reading the filled form, not to apply after all. */
export async function rejectSubmissionAction(form: FormData): Promise<void> {
  await requireAccess();

  const profile = await getProfile(db);
  if (!profile) {
    back("/applications", { error: "Save your profile before reviewing applications." });
  }

  const applicationId = field(form, "applicationId");
  if (applicationId === null) {
    back("/applications", { error: "That change could not be applied." });
  }

  const result = await transitionApplication(
    db,
    profile.id,
    applicationId,
    ApplicationStatus.SKIPPED,
    "You decided not to apply after reviewing the filled form.",
  );
  revalidatePath("/applications");
  back("/applications", result.ok ? { saved: "rejected" } : { error: result.error });
}
