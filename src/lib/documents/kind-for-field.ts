/**
 * Which stored document a file input is asking for.
 *
 * Getting this wrong is worse than leaving the field empty. A resume attached
 * to the "Cover letter" slot looks answered and reads wrong, and the person
 * reviewing the filled form is much less likely to notice a *wrong* file than
 * a missing one. So this returns null whenever the label is not clear, and the
 * field is left for the human.
 *
 * Pure. No filesystem, no database.
 */

/** The document kinds this app stores, matching the Prisma enum. */
export type DocumentKind = "RESUME" | "COVER_LETTER" | "TRANSCRIPT" | "OTHER";

/** Unicode combining marks — what NFD splits an accented letter into. */
const COMBINING_FIRST = 0x300;
const COMBINING_LAST = 0x36f;

/**
 * Fold accents away before matching.
 *
 * An employer who spells it "Résumé" is asking for the same file as one who
 * writes "Resume". Matching the accented spelling directly does not work:
 * JavaScript's \b is ASCII-only, so the trailing boundary in /\bresume\b/
 * never fires after an accented vowel, and the pattern silently fails on
 * exactly the spelling a careful employer uses. Normalizing first means one
 * plain pattern covers every spelling.
 *
 * Written as a code-point comparison rather than the usual regex range,
 * because that range is spelled with characters that are invisible in an
 * editor and in a diff — and a pattern nobody can see is one nobody can check.
 */
function stripAccents(value: string): string {
  return Array.from(value.normalize("NFD"))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < COMBINING_FIRST || code > COMBINING_LAST;
    })
    .join("");
}

/**
 * Read a file field's label and say which document belongs in it.
 *
 * Order matters: "cover letter" is checked before "resume" because a single
 * label often names both — "Resume or cover letter", and more commonly the
 * hint text "Attach your resume and cover letter" ends up as the label of the
 * *cover letter* input on Greenhouse. When both appear, neither is certain, so
 * nothing is attached.
 */
export function documentKindForField(label: string): DocumentKind | null {
  const text = stripAccents(label.toLowerCase());

  const mentionsResume = /\bresume\b|\bcv\b/.test(text);
  const mentionsCover = /\bcover\s*letter\b|\bcoverletter\b/.test(text);
  const mentionsTranscript = /\btranscript\b/.test(text);

  // Two different documents named in one label: which input this actually is
  // cannot be read off the text. Leave it alone.
  const named = [mentionsResume, mentionsCover, mentionsTranscript].filter(Boolean).length;
  if (named > 1) return null;

  if (mentionsCover) return "COVER_LETTER";
  if (mentionsResume) return "RESUME";
  if (mentionsTranscript) return "TRANSCRIPT";

  // A bare "Attach a file" / "Upload" with no clue what it wants. Some forms
  // use this for a portfolio, some for a writing sample, some for a resume.
  // Guessing resume here would put the resume on a portfolio field often
  // enough to matter.
  return null;
}

/** How the attachment is described afterwards, for the run report. */
export function describeKind(kind: DocumentKind): string {
  switch (kind) {
    case "RESUME":
      return "resume";
    case "COVER_LETTER":
      return "cover letter";
    case "TRANSCRIPT":
      return "transcript";
    case "OTHER":
      return "document";
  }
}
