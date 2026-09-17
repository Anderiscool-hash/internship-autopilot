"use server";

/**
 * Starting a shadow run from the job page.
 *
 * The run opens a real browser window, which happens on the machine running
 * the server — this machine. So the button that calls this is only offered to
 * a local request: on a hosted copy it would open a window nobody is sitting
 * in front of.
 *
 * The process is spawned detached and the action returns immediately. A shadow
 * run in handoff mode lives until the person closes the browser, which can be
 * many minutes; holding the HTTP request open for that would be pointless.
 */

import { spawn } from "node:child_process";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { localRequestsTrusted } from "@/lib/auth/session";
import { mailboxStatus } from "@/lib/email/env-file";
import { daemonStatus, submitToDaemon } from "@/lib/apply/daemon-client";

// Next.js dispatches server actions by action ID, not by route, so a POST to any
// path the middleware skips can still reach the actions below. The check has to
// live in each action itself; middleware cannot be the boundary for these.
import { requireAccess } from "@/lib/auth/guard";

export async function startShadowRunAction(form: FormData): Promise<void> {
  await requireAccess();

  const jobId = form.get("jobId");
  if (typeof jobId !== "string" || jobId.length === 0) {
    redirect("/jobs");
  }

  // Decided by the server's own environment, never by the request. The
  // `Host:` header this used to read is written by the client, so `curl -H
  // "Host: localhost"` against a deployed copy spawned a real browser process
  // on that host. `isLocalHost` says as much in its own doc comment: it is for
  // cosmetics, not for gating something privileged, and spawning a detached
  // process is as privileged as this app gets.
  if (!localRequestsTrusted()) {
    // The window would open on the server, not on the viewer's screen.
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(
      "Shadow mode opens a browser on the machine running this app, so it can only be started from that machine.",
    )}`);
  }

  const profile = await getProfile(db);
  if (!profile) {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(
      "Fill in your profile first — there would be nothing to put in the form.",
    )}`);
  }

  // Read an emailed verification code automatically when a mailbox is set up
  // — the same opt-in `npm run shadow -- --verify` gives the CLI, just decided
  // by configuration instead of a flag, since nobody sitting at this button
  // gets the chance to type one.
  const verify = mailboxStatus().configured;

  // Hand it to the daemon when one is up, same as scripts/shadow-apply.ts: it
  // already has a browser warm, so the window opens sooner than spawning a
  // fresh process would.
  const daemon = await daemonStatus();
  if (daemon) {
    const accepted = await submitToDaemon({ jobId, handoff: true, verify });
    if (accepted) {
      redirect(`/jobs/${jobId}?saved=${encodeURIComponent(
        "Opening the application form in a browser window. It will fill itself, then hand over to you.",
      )}`);
    }
    // The daemon refused it (or died between the health check and here) —
    // fall through to spawning a standalone run below.
  }

  // Detached: the run outlives this request. shell: true because npm on
  // Windows is a shim rather than an executable.
  const child = spawn(
    "npm",
    ["run", "shadow", "--", jobId, "--handoff", ...(verify ? ["--verify"] : [])],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      shell: true,
    },
  );
  child.unref();

  redirect(`/jobs/${jobId}?saved=${encodeURIComponent(
    "Opening the application form in a browser window. It will fill itself, then hand over to you.",
  )}`);
}
