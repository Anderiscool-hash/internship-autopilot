// ============================================================================
// "Is this actually the database I meant?"
//
// The failure this exists to stop is boring and permanent. DATABASE_URL is a
// single environment variable, usually pasted, often pasted from the wrong
// tab. Point an import at the wrong database and it does not complain — the
// schema matches, the rows go in, and you have now written one person's
// profile, Truth Ledger and application history on top of another's. There is
// no undo, and the import will have printed "Done."
//
// So before anything is written, the import asks one question it can actually
// answer: does this database already belong to the person whose backup I am
// holding? The backup names its candidates by email. The target has its own
// candidates. If those two sets share nobody, and the target is not empty,
// then this is somebody else's database — or an unrelated one — and the import
// stops.
//
// Two things are deliberately NOT treated as suspicious:
//   - An empty target. That is the normal case: a fresh server that has had
//     `prisma migrate deploy` run and nothing else. Nothing can be lost.
//   - A target that shares even one candidate email. That is a re-import onto
//     the machine the backup came from, which is the whole point of the tool.
//
// And --force exists because the guard can be wrong: changing your email
// address between the export and the import is a real thing that makes an
// honest re-import look like an accident. --force is how you say "I know",
// and this file spells out exactly what it switches off.
// ============================================================================

/** The verdict, with the reasoning attached either way. */
export type IdentityVerdict =
  | { ok: true; note: string }
  | { ok: false; reason: string };

/** Lower-case and trim so "Me@Example.com " matches "me@example.com". */
function normalizeEmails(emails: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const email of emails) {
    const clean = email.trim().toLowerCase();
    if (clean !== "") normalized.add(clean);
  }
  return normalized;
}

/**
 * Decide whether this backup belongs to this database.
 *
 * `targetRowCount` is the total number of rows across every table the backup
 * covers — not just candidates. A database with no candidates but 40,000 jobs
 * in it is still somebody's database, and still worth refusing to write over.
 */
export function checkTargetIdentity(input: {
  /** Candidate emails found in the backup file. */
  backupEmails: readonly string[];
  /** Candidate emails found in the target database right now. */
  targetEmails: readonly string[];
  /** Total rows currently in the target, across all backed-up tables. */
  targetRowCount: number;
}): IdentityVerdict {
  const backup = normalizeEmails(input.backupEmails);
  const target = normalizeEmails(input.targetEmails);

  // An empty database cannot have anything overwritten in it. This is the
  // migration case the whole tool exists for, so it passes without argument.
  if (input.targetRowCount === 0) {
    return {
      ok: true,
      note: "target database is empty — nothing here can be overwritten",
    };
  }

  const shared = [...backup].filter((email) => target.has(email));
  if (shared.length > 0) {
    return {
      ok: true,
      note: `target already holds ${shared.join(", ")} — same person, re-import`,
    };
  }

  // From here on, the target has rows and none of them are this candidate.

  if (backup.size === 0) {
    return {
      ok: false,
      reason:
        `The backup file contains no candidate, so there is no way to tell ` +
        `whose data it is — and the target database is not empty ` +
        `(${input.targetRowCount} rows). Refusing to write into it.`,
    };
  }

  if (target.size === 0) {
    return {
      ok: false,
      reason:
        `The target database has ${input.targetRowCount} rows but no candidate ` +
        `at all, so it is not a database this backup was ever taken from. ` +
        `The backup belongs to ${[...backup].join(", ")}. Refusing to write ` +
        `into it — check DATABASE_URL.`,
    };
  }

  return {
    ok: false,
    reason:
      `This looks like the wrong database. The backup belongs to ` +
      `${[...backup].join(", ")}, but the target holds ${input.targetRowCount} ` +
      `rows belonging to ${[...target].join(", ")} — no candidate in common. ` +
      `Importing would write one person's profile over another's. Check ` +
      `DATABASE_URL.`,
  };
}

/**
 * What --force actually switches off, in the words the script prints.
 *
 * Kept next to the guard rather than in the script so the two can never
 * describe different things — a flag documented as doing less than it does is
 * how people end up using it casually.
 */
export const FORCE_OVERRIDES: readonly string[] = [
  "the check that the backup's candidate email matches one already in the target database",
  "the refusal to write into a non-empty database that appears to belong to someone else",
];

/** The paragraph printed when the guard fires, explaining the way out. */
export function describeForceEscapeHatch(): string {
  return [
    "If you are sure this is the right database — for example you changed your",
    "email address after taking the backup — re-run with --force.",
    "",
    "--force switches off exactly this, and nothing else:",
    ...FORCE_OVERRIDES.map((line) => `  - ${line}`),
    "",
    "It does NOT switch off the schema coverage check, and it does not make the",
    "import destructive: rows are still matched by id, and no row is ever",
    "deleted. Consider running with --dry-run first to see what it would do.",
  ].join("\n");
}
