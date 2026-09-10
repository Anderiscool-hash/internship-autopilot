"use server";

/**
 * Server actions behind the profile forms.
 *
 * These run on the server when a form is submitted — no client-side
 * JavaScript, same as the dashboard. Results come back as a redirect carrying
 * either `saved=...` or `errors=...`, so the outcome survives the page reload
 * and the URL alone says what happened.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { parseProfile, parseTruthFact, type FormValues } from "@/lib/candidate/parse";
import {
  addTruthFact,
  deleteTruthFact,
  getProfile,
  saveProfile,
} from "@/lib/candidate/store";

/** Flatten FormData into the plain string record the parsers expect. */
function toValues(form: FormData): FormValues {
  const values: FormValues = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/** Bounce back to the profile page with a message in the URL. */
function backTo(params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/profile?${query}`);
}

/** Save the identity/eligibility/preferences form. */
export async function saveProfileAction(form: FormData): Promise<void> {
  const parsed = parseProfile(toValues(form));

  if (!parsed.ok) {
    backTo({ errors: parsed.errors.join("|") });
  }

  await saveProfile(db, parsed.value);
  revalidatePath("/profile");
  backTo({ saved: "profile" });
}

/** Add one Truth Ledger fact (spec §3). */
export async function addFactAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  if (!profile) {
    backTo({ errors: "Save your profile before adding facts to the ledger." });
  }

  const parsed = parseTruthFact(toValues(form));
  if (!parsed.ok) {
    backTo({ errors: parsed.errors.join("|") });
  }

  await addTruthFact(db, profile.id, parsed.value);
  revalidatePath("/profile");
  backTo({ saved: "fact" });
}

/** Remove a fact from the ledger. */
export async function deleteFactAction(form: FormData): Promise<void> {
  const factId = form.get("factId");
  const profile = await getProfile(db);

  if (!profile || typeof factId !== "string" || factId.length === 0) {
    backTo({ errors: "That fact could not be found." });
  }

  const deleted = await deleteTruthFact(db, profile.id, factId);
  revalidatePath("/profile");
  backTo(deleted ? { saved: "deleted" } : { errors: "That fact could not be found." });
}
