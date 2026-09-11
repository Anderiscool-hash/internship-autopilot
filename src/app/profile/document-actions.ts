"use server";

/**
 * Uploading and removing the documents applications attach.
 *
 * Separate from resume-actions.ts because the jobs are different: that file
 * reads a resume for its *contents* and proposes profile fields from them;
 * this one stores a *file* so a form's upload button can be answered. The
 * resume import does both, which is why it calls into the same store.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { DocumentError, deleteDocument, saveDocument } from "@/lib/documents/store";
import type { DocumentKind } from "@/lib/documents/kind-for-field";

const KINDS = new Set<DocumentKind>(["RESUME", "COVER_LETTER", "TRANSCRIPT", "OTHER"]);

function back(params: Record<string, string>): never {
  redirect(`/profile?${new URLSearchParams(params).toString()}`);
}

export async function uploadDocumentAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  if (!profile) back({ errors: "Save your profile first — a document belongs to a person." });

  const file = form.get("document");
  const rawKind = String(form.get("kind") ?? "");

  if (!KINDS.has(rawKind as DocumentKind)) back({ errors: "Choose what kind of document this is." });
  if (!(file instanceof File) || file.size === 0) back({ errors: "Choose a file to upload." });

  try {
    const saved = await saveDocument(db, {
      candidateId: profile.id,
      kind: rawKind as DocumentKind,
      filename: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath("/profile");
    back({ saved: "document", note: `${saved.filename} is on file and will be attached automatically.` });
  } catch (error) {
    if (error instanceof DocumentError) back({ errors: error.message });
    throw error;
  }
}

export async function deleteDocumentAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  if (id) await deleteDocument(db, id);
  revalidatePath("/profile");
  back({ saved: "document", note: "Document removed." });
}
