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
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { isLocalHost } from "@/lib/auth/session";

export async function startShadowRunAction(form: FormData): Promise<void> {
  const jobId = form.get("jobId");
  if (typeof jobId !== "string" || jobId.length === 0) {
    redirect("/jobs");
  }

  const host = (await headers()).get("host");
  if (!isLocalHost(host)) {
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

  // Detached: the run outlives this request. shell: true because npm on
  // Windows is a shim rather than an executable.
  const child = spawn("npm", ["run", "shadow", "--", jobId, "--handoff"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    shell: true,
  });
  child.unref();

  redirect(`/jobs/${jobId}?saved=${encodeURIComponent(
    "Opening the application form in a browser window. It will fill itself, then hand over to you.",
  )}`);
}
