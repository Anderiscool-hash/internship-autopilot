"use server";

/**
 * Saving the Hunter API key.
 *
 * Writes to .env rather than the database, matching how every other secret in
 * this project is held: .env is gitignored, a database dump is not.
 *
 * Nothing here ever sends the key back to the browser. The screen learns
 * whether one is set — never its value.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeOutreachVars } from "@/lib/outreach/env-file";

// Next.js dispatches server actions by action ID, not by route, so a POST to any
// path the middleware skips can still reach the actions below. The check has to
// live in each action itself; middleware cannot be the boundary for these.
import { requireAccess } from "@/lib/auth/guard";

function back(params: Record<string, string>): never {
  redirect(`/settings/outreach?${new URLSearchParams(params).toString()}`);
}

function text(form: FormData, field: string): string {
  return String(form.get(field) ?? "").trim();
}

export async function saveHunterKeyAction(form: FormData): Promise<void> {
  await requireAccess();

  // Whitespace only, not the /\s+/g strip the mailbox screen applies to
  // Google app passwords: those are displayed in groups of four and pasted
  // with spaces in them, whereas a Hunter key is one opaque token and an
  // internal space in it would be a real character we must not silently eat.
  const rawKey = String(form.get("key") ?? "");
  const key = rawKey.trim();

  if (/[\x00-\x1f\x7f]/.test(rawKey)) {
    back({ error: "The key contains an invalid control character." });
  }

  if (key.length === 0) {
    // An empty box means "leave the stored key alone", not "erase it" — the
    // field renders blank every time precisely because the value is never
    // sent to the browser, so treating blank as a deletion would wipe the key
    // any time this form was submitted for any other reason. Clearing it is
    // its own button.
    back({ saved: "Nothing changed — the box was blank, so the stored key was kept." });
  }

  writeOutreachVars({ HUNTER_API_KEY: key });

  // The running process keeps its own copy of the environment, and .env is
  // only read at startup. Updating it in place here means the very next
  // discovery run uses the key just saved rather than whatever was loaded
  // when the server booted.
  process.env.HUNTER_API_KEY = key;

  revalidatePath("/settings/outreach");
  back({ saved: "Key saved to .env. Discovery will use Hunter from the next run." });
}

/**
 * Remove the key.
 *
 * Its own button rather than a blank submit, because blank has to mean "keep"
 * for the reason above. Removing it is not a failure state: the free path is
 * the default and the fallback, and the feature keeps working without Hunter.
 */
export async function clearHunterKeyAction(): Promise<void> {
  await requireAccess();

  writeOutreachVars({ HUNTER_API_KEY: "" });
  process.env.HUNTER_API_KEY = "";

  revalidatePath("/settings/outreach");
  back({
    saved:
      "Key removed. Discovery falls back to the free path — MX, name permutation, " +
      "Gravatar and bounce feedback.",
  });
}
