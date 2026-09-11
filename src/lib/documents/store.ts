/**
 * Where the candidate's documents live.
 *
 * The bytes go on disk and the row records where. A file input on an
 * employer's form needs a real path to point at, so keeping the document as a
 * database blob would mean writing it back out to a temp file on every run —
 * more moving parts for no benefit.
 *
 * Paths are stored *relative* to the storage root. This row gets exported in
 * backups, and an absolute path from one machine is a dead link on the next.
 */

import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { DocumentKind } from "./kind-for-field";

/**
 * The storage root, outside the app tree and gitignored.
 *
 * Documents are the most personal thing this app holds — a resume has a home
 * address and a phone number on it — so they never sit anywhere that could be
 * committed or served.
 */
export const STORAGE_ROOT = resolve(process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents");

/** Extensions an ATS will actually accept. */
const ALLOWED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf", ".md"]);

/** 10 MB. Above this, every ATS rejects the upload anyway. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export class DocumentError extends Error {}

/** What the caller gets back — enough to attach the file, or show it. */
export interface StoredDocument {
  id: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Absolute path, resolved from the stored relative one. */
  absolutePath: string;
  /** False when the row exists but the file behind it has gone missing. */
  present: boolean;
  createdAt: Date;
}

/** Turn a stored row into something with a usable path. */
function hydrate(row: {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: Date;
}): StoredDocument {
  const absolutePath = join(STORAGE_ROOT, row.storagePath);
  return {
    id: row.id,
    kind: row.kind as DocumentKind,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    absolutePath,
    // Checked rather than assumed. The row and the file can drift apart — a
    // restored database, a cleared storage folder — and an apply run that
    // thinks it has a resume but points at nothing fails deep inside a
    // browser. Better to know here.
    present: existsSync(absolutePath),
    createdAt: row.createdAt,
  };
}

/**
 * Save an uploaded document, replacing whatever was the default for its kind.
 *
 * Replacing rather than accumulating is deliberate: the question a form asks
 * is "your resume", singular, and a store with four resumes in it would need
 * the person to choose one every time — which is the work this is meant to
 * remove.
 */
export async function saveDocument(
  db: PrismaClient,
  input: {
    candidateId: string;
    kind: DocumentKind;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): Promise<StoredDocument> {
  const extension = extname(input.filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new DocumentError(
      `${extension || "That file type"} is not one an application form will accept. ` +
        `Use ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
    );
  }
  if (input.bytes.byteLength === 0) throw new DocumentError("That file is empty.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentError(
      `That file is ${(input.bytes.byteLength / 1024 / 1024).toFixed(1)} MB. ` +
        `Most application forms reject anything over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`,
    );
  }

  // Content-addressed, so re-uploading the same file twice does not leave a
  // second copy behind. The kind is in the name so the folder is readable.
  const digest = createHash("sha256").update(input.bytes).digest("hex").slice(0, 16);
  const relativePath = `${input.kind.toLowerCase()}-${digest}${extension}`;

  await mkdir(STORAGE_ROOT, { recursive: true });
  await writeFile(join(STORAGE_ROOT, relativePath), input.bytes);

  // The file is on disk before the row is written. The other order can leave a
  // row pointing at a file that was never created.
  const previous = await db.candidateDocument.findMany({
    where: { candidateId: input.candidateId, kind: input.kind as never },
    select: { id: true, storagePath: true },
  });

  const row = await db.candidateDocument.create({
    data: {
      candidateId: input.candidateId,
      kind: input.kind as never,
      filename: input.filename,
      mimeType: input.mimeType || "application/octet-stream",
      sizeBytes: input.bytes.byteLength,
      storagePath: relativePath,
      isDefault: true,
    },
  });

  // Clear the old rows, and their files — but never a file the new row points
  // at, which is what re-uploading an identical document produces.
  for (const old of previous) {
    await db.candidateDocument.delete({ where: { id: old.id } }).catch(() => undefined);
    if (old.storagePath !== relativePath) {
      await unlink(join(STORAGE_ROOT, old.storagePath)).catch(() => undefined);
    }
  }

  return hydrate(row);
}

/** The document to attach for one kind, or null if none is stored. */
export async function defaultDocument(
  db: PrismaClient,
  candidateId: string,
  kind: DocumentKind,
): Promise<StoredDocument | null> {
  const row = await db.candidateDocument.findFirst({
    where: { candidateId, kind: kind as never, isDefault: true },
    orderBy: { createdAt: "desc" },
  });
  return row ? hydrate(row) : null;
}

/** Everything on file, newest first — for the profile screen. */
export async function listDocuments(
  db: PrismaClient,
  candidateId: string,
): Promise<StoredDocument[]> {
  const rows = await db.candidateDocument.findMany({
    where: { candidateId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(hydrate);
}

/** Remove a document and the file behind it. */
export async function deleteDocument(db: PrismaClient, id: string): Promise<void> {
  const row = await db.candidateDocument.findUnique({ where: { id } });
  if (!row) return;
  await db.candidateDocument.delete({ where: { id } });
  await unlink(join(STORAGE_ROOT, row.storagePath)).catch(() => undefined);
}

/** Every stored document, keyed by kind — what an apply run needs up front. */
export async function documentsForApply(
  db: PrismaClient,
  candidateId: string,
): Promise<Partial<Record<DocumentKind, StoredDocument>>> {
  const documents = await listDocuments(db, candidateId);
  const byKind: Partial<Record<DocumentKind, StoredDocument>> = {};
  for (const document of documents) {
    // Only offer a file that is actually there.
    if (document.present && !byKind[document.kind]) byKind[document.kind] = document;
  }
  return byKind;
}
