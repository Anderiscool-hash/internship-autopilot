"use server";

/**
 * Autofill from resume: upload, parse, review.
 *
 * The flow is deliberately three steps and not two. The upload parses the file
 * and stores what it found; the profile screen then renders those findings as
 * a pre-filled form with the evidence beside each field; nothing reaches the
 * Candidate row until the user presses Save on that form.
 *
 * That extra step is the whole point. Spec §3 says this app does not fabricate
 * candidate facts, and a value lifted out of a PDF by a regex — or suggested by
 * a model — is a guess until a person confirms it. A wrong graduation year
 * written straight to the profile would silently change the eligibility answer
 * on every job afterwards.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { DocumentError, saveDocument } from "@/lib/documents/store";
import { getProvider } from "@/lib/ai";
import { AiUnavailableError } from "@/lib/ai/types";
import { mergeSuggestions, parseResumeWithAi } from "@/lib/resume/ai-parse";
import { extractResumeText, ResumeReadError } from "@/lib/resume/extract-text";
import { parseResumeFields } from "@/lib/resume/parse-fields";
import type { Prisma } from "@prisma/client";

/** Bounce back to the profile with a message. */
function back(params: Record<string, string>): never {
  redirect(`/profile?${new URLSearchParams(params).toString()}`);
}

/** Is this Next's redirect control-flow throw rather than a real failure? */
function isRedirect(error: unknown): boolean {
  if (error instanceof Error && error.message === "NEXT_REDIRECT") return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function importResumeAction(form: FormData): Promise<void> {
  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    back({ errors: "Choose a resume file first." });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractResumeText(bytes, file.name);

    // Patterns first, always. They run with no provider, they are checkable
    // against a line of the document, and they win any field the AI also
    // guesses at.
    const fromPatterns = parseResumeFields(extracted.text);

    // The AI pass is optional. With no provider configured, the user gets the
    // pattern fields and types their name — a smaller win, not a failure.
    let suggestions = fromPatterns;
    let aiNote = "";
    try {
      const provider = await getProvider(db);
      if (provider) {
        const fromAi = await parseResumeWithAi(provider, extracted.text);
        suggestions = mergeSuggestions(fromPatterns, fromAi);
      } else {
        aiNote = " No AI provider is configured, so name and skills were not filled in.";
      }
    } catch (error) {
      if (isRedirect(error)) throw error;
      // A provider that is configured but broken must not lose the pattern
      // results — those are the reliable half.
      const detail =
        error instanceof AiUnavailableError ? error.message : "the model call failed";
      aiNote = ` The AI pass did not run: ${detail}`;
    }

    const imported = await db.resumeImport.create({
      data: {
        filename: file.name,
        text: extracted.text,
        suggestions: suggestions as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Keep the file itself, not just the words in it.
    //
    // Reading a resume for its text and then discarding the document is how
    // this used to work, and it meant the one field every application form
    // requires — the upload — could never be filled. The same upload now does
    // both jobs, so there is no second step for the person to forget.
    let documentNote = "";
    const candidate = await getProfile(db);
    if (candidate) {
      try {
        await saveDocument(db, {
          candidateId: candidate.id,
          kind: "RESUME",
          filename: file.name,
          mimeType: file.type,
          bytes,
        });
        documentNote = " Saved as your resume — applications will attach it automatically.";
      } catch (error) {
        // A resume this app cannot store is still a resume it could read, and
        // the parsed fields are the bigger half of this screen. Say so rather
        // than failing the import.
        const detail = error instanceof DocumentError ? error.message : "it could not be saved";
        documentNote = ` The fields below were read, but the file was not kept for uploads: ${detail}`;
      }
    }

    const found = Object.keys(suggestions).length;
    revalidatePath("/profile");
    back({
      import: imported.id,
      saved: "imported",
      note: `Read ${found} field${found === 1 ? "" : "s"} from ${file.name}.${documentNote}${aiNote}`,
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    if (error instanceof ResumeReadError) {
      back({ errors: error.message });
    }
    const detail = error instanceof Error ? error.message : String(error);
    back({ errors: `That file could not be read: ${detail}` });
  }
}
