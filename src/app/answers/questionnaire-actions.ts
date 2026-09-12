"use server";

/**
 * Saving the whole questionnaire in one go.
 *
 * One action rather than one per question: a person filling twenty boxes
 * should press Save once, and a partial save would leave them guessing which
 * half landed.
 *
 * A blank field does NOT store an empty answer — it deletes any answer that
 * was there. "I have not answered this" and "my answer is nothing" are
 * different states, and only the first one is allowed to stop an application
 * for a human. Storing "" would make every form think the question was
 * answered and type nothing into it.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { fieldNameFor, QUESTIONNAIRE } from "@/lib/answers/questionnaire";

function back(params: Record<string, string>): never {
  redirect(`/answers?${new URLSearchParams(params).toString()}`);
}

export async function saveQuestionnaireAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  if (!profile) back({ error: "Save your profile first — answers belong to you." });

  let saved = 0;
  let cleared = 0;

  for (const [index, item] of QUESTIONNAIRE.entries()) {
    const name = fieldNameFor(index);
    const raw = form.get(name);
    const answer = typeof raw === "string" ? raw.trim() : "";

    // This field was pre-filled from an answer stored under the employer's
    // wording rather than ours. Write back to that entry, so a person who
    // reviews the sheet does not end up with two entries saying the same thing
    // under two wordings — which is how an answer bank becomes untrustworthy.
    const from = form.get(`${name}__from`);
    const was = form.get(`${name}__was`);
    const sourceQuestion = typeof from === "string" && from.length > 0 ? from : null;
    const sourceAnswer = typeof was === "string" ? was : "";

    const existing = sourceQuestion
      ? await db.answerBankEntry.findFirst({
          where: { candidateId: profile.id, question: sourceQuestion },
          select: { id: true },
        })
      : await db.answerBankEntry.findFirst({
          where: { candidateId: profile.id, question: item.question },
          select: { id: true },
        });

    // Untouched: nothing to do. Re-saving would only bump a timestamp, and
    // reporting it as "saved" would overstate what the person just did.
    if (existing && answer === sourceAnswer && sourceAnswer.length > 0) continue;

    if (answer.length === 0) {
      // Deleting only counts when the person actually emptied a box that had
      // something in it. `__was` is what the field held when the page was
      // rendered, so a blank submission with a blank `__was` means "this was
      // never answered" and must not touch anything.
      //
      // The first version of this deleted on any blank, and a select whose
      // stored value was not one of its options ("yes" against "Yes") rendered
      // as "not answered" — so merely opening the page and pressing Save
      // destroyed two real answers. Losing an answer the person gave is worse
      // than any amount of clutter.
      const hadValue = sourceAnswer.length > 0;
      if (existing && hadValue) {
        await db.answerBankEntry.delete({ where: { id: existing.id } });
        cleared += 1;
      }
      continue;
    }

    if (existing) {
      await db.answerBankEntry.update({
        where: { id: existing.id },
        data: { answer, isLegal: item.isLegal ?? false },
      });
    } else {
      await db.answerBankEntry.create({
        data: {
          candidateId: profile.id,
          question: item.question,
          answer,
          isLegal: item.isLegal ?? false,
        },
      });
    }
    saved += 1;
  }

  revalidatePath("/answers");

  const note =
    cleared > 0
      ? `${saved} answer${saved === 1 ? "" : "s"} saved, ${cleared} cleared.`
      : `${saved} answer${saved === 1 ? "" : "s"} saved.`;

  back({ saved: "questionnaire", note });
}
