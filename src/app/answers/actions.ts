"use server";

/**
 * Server actions for the answer bank (spec §16).
 *
 * Same no-JavaScript pattern as the rest of the app: form posts, server
 * actions, results carried back in the URL.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";

/** Read one trimmed string off a form. */
function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function back(params: Record<string, string>): never {
  redirect(`/answers?${new URLSearchParams(params).toString()}`);
}

/**
 * Save an answer, replacing any existing one for the same question.
 *
 * Matched on the exact stored question rather than fuzzily: this is the form
 * where a person edits their own bank, and a fuzzy match here could silently
 * overwrite a different answer than the one they meant to change.
 */
export async function saveAnswerAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  if (!profile) back({ error: "Save your profile first — answers belong to you." });

  const question = field(form, "question");
  const answer = field(form, "answer");
  const isLegal = form.get("isLegal") === "on";
  const id = field(form, "id");

  if (question === null || answer === null) {
    back({ error: "A question and an answer are both required." });
  }

  if (id !== null) {
    const updated = await db.answerBankEntry.updateMany({
      where: { id, candidateId: profile.id },
      data: { question, answer, isLegal },
    });
    if (updated.count === 0) back({ error: "That answer no longer exists." });
  } else {
    const existing = await db.answerBankEntry.findFirst({
      where: { candidateId: profile.id, question },
    });
    if (existing) {
      await db.answerBankEntry.update({
        where: { id: existing.id },
        data: { answer, isLegal },
      });
    } else {
      await db.answerBankEntry.create({
        data: { candidateId: profile.id, question, answer, isLegal },
      });
    }
  }

  revalidatePath("/answers");
  back({ saved: "answer" });
}

/** Delete one answer. */
export async function deleteAnswerAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  const id = form.get("id");
  if (!profile || typeof id !== "string") back({ error: "That answer no longer exists." });

  const deleted = await db.answerBankEntry.deleteMany({
    where: { id, candidateId: profile.id },
  });
  revalidatePath("/answers");
  back(deleted.count > 0 ? { saved: "deleted" } : { error: "That answer no longer exists." });
}
