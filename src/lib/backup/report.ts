// ============================================================================
// Saying what happened, in a way that cannot be read as more than it was.
//
// The old import printed one number per table: "jobs  2800 written". On a
// second run the same line read "jobs  0 written, 2800 already there", which
// sounds like everything is fine and in fact means "I compared nothing and
// changed nothing, and some of those 2800 rows may be out of date".
//
// A migration report has to survive being read quickly, by someone who is
// about to shut down the old machine. So every row of the file lands in
// exactly one of four columns, and the four always add up to the number of
// rows in the file:
//
//   created    — did not exist here before
//   updated    — existed and was brought up to date (and which columns)
//   unchanged  — existed and already matched; genuinely nothing to do
//   skipped    — could NOT be written, with the reason and the row's id
//
// "unchanged" and "skipped" are different claims, and the old script printed
// them as the same number. That is the whole reason this file exists.
// ============================================================================

import type { TablePlan } from "./rows";

/** One row that could not be written, and why not. */
export interface SkippedRow {
  id: string;
  reason: string;
}

/** What happened (or would happen) to one table. */
export interface TableOutcome {
  table: string;
  model: string;
  /** Rows in the backup file for this table — the number everything must sum to. */
  inFile: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: SkippedRow[];
  /** Column names present in the file that the schema no longer has. */
  droppedColumns: string[];
  /** Up to a few example column names that changed, for the summary line. */
  changedFieldSamples: string[];
}

/**
 * Turn a plan into the outcome a dry run reports.
 *
 * A dry run's numbers are predictions, which is why the printed header says
 * "would" — but they are produced by the same planner the real run uses, so
 * they are predictions of that exact code rather than of a second guess at it.
 */
export function outcomeFromPlan(plan: TablePlan): TableOutcome {
  const changed = new Set<string>();
  for (const action of plan.actions) {
    for (const field of action.changedFields) changed.add(field);
  }

  return {
    table: plan.table,
    model: plan.model,
    inFile: plan.actions.length,
    created: plan.counts.create,
    updated: plan.counts.update,
    unchanged: plan.counts.unchanged,
    skipped: plan.actions
      .filter((action) => action.kind === "blocked")
      .map((action) => ({
        id: action.id,
        reason: action.reason ?? "no reason recorded",
      })),
    droppedColumns: plan.droppedColumns,
    changedFieldSamples: [...changed].sort(),
  };
}

/**
 * Does every row in the file appear in exactly one column?
 *
 * Checked rather than assumed. If this ever returns false it means a row went
 * through the import without being counted anywhere — a silently dropped row,
 * which is precisely the behaviour this rewrite exists to remove.
 */
export function isFullyAccountedFor(outcome: TableOutcome): boolean {
  return (
    outcome.created +
      outcome.updated +
      outcome.unchanged +
      outcome.skipped.length ===
    outcome.inFile
  );
}

/** The four numbers added up across every table. */
export function totals(outcomes: readonly TableOutcome[]): {
  inFile: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
} {
  return outcomes.reduce(
    (sum, outcome) => ({
      inFile: sum.inFile + outcome.inFile,
      created: sum.created + outcome.created,
      updated: sum.updated + outcome.updated,
      unchanged: sum.unchanged + outcome.unchanged,
      skipped: sum.skipped + outcome.skipped.length,
    }),
    { inFile: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 },
  );
}

/** How many skipped rows to name per table before summarising the rest. */
const SKIP_LIST_LIMIT = 20;

/**
 * The per-table table of numbers, plus a named list of everything skipped.
 *
 * `dryRun` only changes the wording — "would create" versus "created". The
 * numbers are the same numbers.
 */
export function formatOutcomes(
  outcomes: readonly TableOutcome[],
  options: { dryRun: boolean; verbose?: boolean },
): string {
  const lines: string[] = [];
  const verb = options.dryRun ? "would be" : "";

  lines.push(
    options.dryRun
      ? "DRY RUN — nothing below was written. This is what a real run would do."
      : "Import complete. This is what was written.",
  );
  lines.push("");
  lines.push(
    `${"table".padEnd(22)}${"in file".padStart(8)}${"create".padStart(8)}` +
      `${"update".padStart(8)}${"same".padStart(8)}${"skip".padStart(8)}`,
  );
  lines.push("-".repeat(62));

  for (const outcome of outcomes) {
    lines.push(
      outcome.table.padEnd(22) +
        String(outcome.inFile).padStart(8) +
        String(outcome.created).padStart(8) +
        String(outcome.updated).padStart(8) +
        String(outcome.unchanged).padStart(8) +
        String(outcome.skipped.length).padStart(8),
    );
  }

  const sum = totals(outcomes);
  lines.push("-".repeat(62));
  lines.push(
    "TOTAL".padEnd(22) +
      String(sum.inFile).padStart(8) +
      String(sum.created).padStart(8) +
      String(sum.updated).padStart(8) +
      String(sum.unchanged).padStart(8) +
      String(sum.skipped).padStart(8),
  );
  lines.push("");

  // What "same" means, spelled out, because the number being large is the
  // normal result of a healthy re-import and should not read as a failure.
  if (sum.unchanged > 0) {
    lines.push(
      `${sum.unchanged} rows already matched the backup exactly — every column ` +
        `compared, nothing to do.`,
    );
  }

  // Which columns an update touched. Useful on a catch-up import: "status,
  // updatedAt" is reassuring; "email, phone, address" is worth a second look.
  const updatedTables = outcomes.filter((outcome) => outcome.updated > 0);
  if (updatedTables.length > 0) {
    lines.push("");
    lines.push(`Columns that ${verb === "" ? "changed" : "would change"}:`);
    for (const outcome of updatedTables) {
      const shown = outcome.changedFieldSamples.slice(0, 8).join(", ");
      const more =
        outcome.changedFieldSamples.length > 8
          ? `, +${outcome.changedFieldSamples.length - 8} more`
          : "";
      lines.push(`  ${outcome.table.padEnd(22)} ${shown}${more}`);
    }
  }

  // Every skipped row gets named. A count on its own is the same mistake as
  // before — it tells you something went wrong without telling you what.
  const skippedTables = outcomes.filter((outcome) => outcome.skipped.length > 0);
  if (skippedTables.length > 0) {
    lines.push("");
    lines.push(
      `NOT ${options.dryRun ? "importable" : "imported"} — ${sum.skipped} rows. ` +
        `These are real gaps, not duplicates that were already there:`,
    );
    for (const outcome of skippedTables) {
      lines.push(`  ${outcome.table} (${outcome.skipped.length}):`);
      const limit = options.verbose === true ? outcome.skipped.length : SKIP_LIST_LIMIT;
      for (const row of outcome.skipped.slice(0, limit)) {
        lines.push(`    ${row.id} — ${row.reason}`);
      }
      if (outcome.skipped.length > limit) {
        lines.push(
          `    ...and ${outcome.skipped.length - limit} more (re-run with --verbose to list them all)`,
        );
      }
    }
  }

  // A column that vanished between export and import is schema drift. It is
  // survivable — the rest of the row still imports — but you should know.
  const droppedTables = outcomes.filter(
    (outcome) => outcome.droppedColumns.length > 0,
  );
  if (droppedTables.length > 0) {
    lines.push("");
    lines.push(
      "Columns in the backup file that this schema no longer has — their " +
        "values were left behind:",
    );
    for (const outcome of droppedTables) {
      lines.push(`  ${outcome.table}: ${outcome.droppedColumns.join(", ")}`);
    }
  }

  return lines.join("\n");
}

/** The one-line verdict, so the last thing printed is the honest headline. */
export function headline(
  outcomes: readonly TableOutcome[],
  options: { dryRun: boolean },
): string {
  const sum = totals(outcomes);

  if (sum.skipped > 0) {
    return options.dryRun
      ? `${sum.skipped} rows CANNOT be imported — see the list above before running for real.`
      : `${sum.skipped} rows were NOT imported — the data on this server is incomplete.`;
  }

  if (sum.created === 0 && sum.updated === 0) {
    return options.dryRun
      ? "Nothing to do — this database already matches the backup exactly."
      : "Nothing needed changing — this database already matched the backup exactly.";
  }

  return options.dryRun
    ? `Would create ${sum.created} rows and update ${sum.updated}. Re-run without --dry-run to apply.`
    : `Created ${sum.created} rows and updated ${sum.updated}.`;
}
