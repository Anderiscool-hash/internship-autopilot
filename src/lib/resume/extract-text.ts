/**
 * Getting readable text out of an uploaded resume.
 *
 * Three formats, because those are the three people actually have: PDF (what
 * everyone sends), DOCX (what everyone edits), and plain text.
 *
 * Nothing here interprets the text — that is `parse-fields.ts`. This file's
 * only job is bytes in, words out, and to be honest when a file yields
 * nothing. A scanned resume is a picture of a document: it is a valid PDF with
 * no text layer, and the right answer is "I could not read any text from
 * this", not an empty profile presented as a successful parse.
 */

/** The most bytes we will accept. Resumes are small; anything larger is a mistake. */
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** What we managed to read. */
export interface ExtractedResume {
  text: string;
  /** Detected format, for the message shown to the user. */
  format: "pdf" | "docx" | "text";
  /** Pages, when the format has them. */
  pages?: number;
}

/** Raised when a file cannot be read at all — the caller shows this verbatim. */
export class ResumeReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeReadError";
  }
}

/** Enough characters that we plausibly have a resume rather than a stray header. */
const MINIMUM_USEFUL_CHARS = 120;

/**
 * Read an uploaded resume into plain text.
 *
 * Format is decided by the file's own bytes where possible rather than by its
 * name: a `.pdf` extension on a Word document is a thing that happens, and
 * sniffing the magic number costs nothing.
 */
export async function extractResumeText(
  bytes: Uint8Array,
  filename: string,
): Promise<ExtractedResume> {
  if (bytes.length === 0) {
    throw new ResumeReadError("That file is empty.");
  }
  if (bytes.length > MAX_RESUME_BYTES) {
    throw new ResumeReadError(
      `That file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_RESUME_BYTES / 1024 / 1024} MB.`,
    );
  }

  const extracted = await readByFormat(bytes, filename);
  const text = normalizeWhitespace(extracted.text);

  if (text.length < MINIMUM_USEFUL_CHARS) {
    throw new ResumeReadError(
      extracted.format === "pdf"
        ? "No text could be read from that PDF. If it is a scan or an image, export a text-based PDF from your editor and try again — nothing was guessed from it."
        : "That file contained almost no readable text.",
    );
  }

  return { ...extracted, text };
}

/** Dispatch on the file's actual contents. */
async function readByFormat(
  bytes: Uint8Array,
  filename: string,
): Promise<ExtractedResume> {
  const name = filename.toLowerCase();

  // %PDF magic number.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) || name.endsWith(".pdf")) {
    return readPdf(bytes);
  }
  // DOCX is a zip archive: PK\x03\x04.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || name.endsWith(".docx")) {
    return readDocx(bytes);
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return { text: new TextDecoder().decode(bytes), format: "text" };
  }

  throw new ResumeReadError(
    "Unsupported file type. Upload a PDF, a DOCX, or a plain text file.",
  );
}

async function readPdf(bytes: Uint8Array): Promise<ExtractedResume> {
  // Imported lazily so the PDF library is only loaded when someone actually
  // uploads one — it is large, and every other page render would pay for it.
  const { extractText, getDocumentProxy } = await import("unpdf");

  try {
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return {
      text: Array.isArray(text) ? text.join("\n") : text,
      format: "pdf",
      pages: totalPages,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ResumeReadError(`That PDF could not be opened (${detail}).`);
  }
}

async function readDocx(bytes: Uint8Array): Promise<ExtractedResume> {
  const mammoth = await import("mammoth");

  try {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    return { text: result.value, format: "docx" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ResumeReadError(`That DOCX could not be opened (${detail}).`);
  }
}

/** Does the buffer start with these bytes? */
function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Tidy extracted text without destroying its structure.
 *
 * Line breaks are kept — a resume's meaning is partly in its layout, and the
 * field parser uses line boundaries to tell a section heading from a bullet.
 * Only runs of blank lines and trailing spaces are collapsed.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
