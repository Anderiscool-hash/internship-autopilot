/**
 * Replay an export into this database — repeatably, and honestly.
 *
 * Point DATABASE_URL at the destination and run it. The destination must
 * already have the schema (`npx prisma migrate deploy`); this moves rows, not
 * structure.
 *
 *   npm run data:import -- ./backup.json --dry-run    inspect, write nothing
 *   npm run data:import -- ./backup.json              do it
 *   npm run data:import -- ./backup.json --force      skip the wrong-database guard
 *   npm run data:import -- ./backup.json --verbose    list every skipped row
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 *
 * This script used to insert rows and treat "that id already exists" as
 * success. That makes a migration a one-shot operation: the first import
 * works, and every import after it writes nothing while printing a summary
 * that looks like it did. If the old machine kept running for a day after the
 * first transfer — which is exactly what happens during a real move — the
 * catch-up import silently left the new server holding yesterday's data.
 *
 * Now every row is matched by its id (ids come from the export and are
 * preserved) and lands in one of four buckets: created, updated, unchanged, or
 * skipped-with-a-reason. Those four always add up to the number of rows in the
 * file, so no row can pass through uncounted.
 *
 * WHAT IT STILL WILL NOT DO
 *
 * It never deletes. A row that exists on the target but not in the backup is
 * left alone — this is a restore tool, not a mirror. If you need the target to
 * match the backup exactly, empty it first.
 *
 * The heavy lifting lives in src/lib/backup/ so it can be tested without a
 * database: rows.ts decides what to do, guard.ts decides whether this is even
 * the right database, report.ts does the counting and the wording. This file
 * is the part that talks to Postgres.
 */

import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { EXCLUDED_MODELS, assertExportCoverage } from "../src/lib/backup/coverage";
import { buildShapes, delegateName } from "../src/lib/backup/shapes";
import { planTable, type TableShape } from "../src/lib/backup/rows";
import { checkTargetIdentity, describeForceEscapeHatch } from "../src/lib/backup/guard";
import {
  formatOutcomes,
  headline,
  isFullyAccountedFor,
  outcomeFromPlan,
  totals,
  type SkippedRow,
  type TableOutcome,
} from "../src/lib/backup/report";

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

interface Options {
  source: string;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}

/**
 * Parse the flags, and refuse anything unrecognised.
 *
 * Refusing matters more than it looks: a typo like `--dryrun` silently
 * becoming a real import is the single worst thing this script could do, so an
 * unknown flag stops the run rather than being ignored.
 */
function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    source: "./backup.json",
    dryRun: false,
    force: false,
    verbose: false,
  };
  let sawPath = false;

  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option "${arg}". Valid options are --dry-run, --force and ` +
          `--verbose. Nothing was read or written.`,
      );
    } else if (!sawPath) {
      options.source = arg;
      sawPath = true;
    } else {
      throw new Error(
        `Two file paths given ("${options.source}" and "${arg}"). This script ` +
          `imports one file at a time.`,
      );
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Talking to Prisma generically
// ---------------------------------------------------------------------------

/**
 * The four methods this script needs from a Prisma model client.
 *
 * Typed by hand because the script works over whatever tables BACKUP_TABLES
 * declares, which Prisma's per-model types cannot express in one variable.
 * The cast is contained to `delegateFor` below, which checks at runtime that
 * the thing it found really does have these methods.
 */
interface Delegate {
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  count(args?: unknown): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

/**
 * Find `db.job` from the model name `Job` — and stop the whole run if it
 * isn't there.
 *
 * This is the import-side twin of the coverage guard: add a model to
 * BACKUP_TABLES and the script refuses to start until Prisma actually has a
 * client for it, instead of skipping that table at the moment it matters.
 */
function delegateFor(shape: TableShape): Delegate {
  const property = delegateName(shape.model);
  const candidate = (db as unknown as Record<string, unknown>)[property];

  const usable =
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as Record<string, unknown>).findMany === "function" &&
    typeof (candidate as Record<string, unknown>).create === "function" &&
    typeof (candidate as Record<string, unknown>).update === "function" &&
    typeof (candidate as Record<string, unknown>).count === "function";

  if (!usable) {
    throw new Error(
      `The backup declares the table "${shape.table}" (model ${shape.model}), ` +
        `but this Prisma client has no db.${property} to read or write it. ` +
        `Nothing was imported. Run \`npx prisma generate\` — and if the model ` +
        `was renamed, update src/lib/backup/coverage.ts.`,
    );
  }

  return candidate as unknown as Delegate;
}

/**
 * Boil a Prisma error down to one line a human can act on.
 *
 * Prisma's messages are several lines of query echo with the useful sentence
 * at the end. In a per-row skip list, what you need is the reason, not the
 * invocation — the row's id is already printed next to it.
 */
function describeError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = JSON.stringify(error.meta?.target ?? error.meta ?? {});

    if (error.code === "P2002") {
      return `a row with the same unique value already exists (${target})`;
    }
    if (error.code === "P2003") {
      return (
        `it points at a row that is not in this database — the parent row is ` +
        `missing from the backup or failed to import first (${target})`
      );
    }
    if (error.code === "P2025") {
      return `the row it was meant to update disappeared mid-import (${target})`;
    }
    return `Prisma ${error.code}: ${lastLine(error.message)}`;
  }

  return lastLine(error instanceof Error ? error.message : String(error));
}

/** Prisma puts the explanation on the final line; keep that, trimmed. */
function lastLine(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const line = lines[lines.length - 1] ?? message;
  return line.length > 200 ? `${line.slice(0, 200)}...` : line;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const parsed: unknown = JSON.parse(readFileSync(options.source, "utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${options.source} is not a backup file — expected an object of tables, ` +
        `the kind \`npm run data:export\` writes.`,
    );
  }
  const data = parsed as Record<string, unknown>;

  console.log(
    `${options.dryRun ? "DRY RUN: inspecting" : "Importing"} ${options.source} ` +
      `into ${describeTarget()}\n`,
  );

  // (1) Does this file still match the schema?
  //
  // The same guarantee export-data.ts makes, applied from the other side. If
  // the file is missing a table the schema has — because it was taken by an
  // older export, before that table was covered — importing it would restore a
  // database that is quietly incomplete. Refuse instead.
  try {
    assertExportCoverage({
      schemaModels: Prisma.dmmf.datamodel.models,
      collectedKeys: Object.keys(data).filter((key) =>
        Array.isArray(data[key]),
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${options.source} does not match this database's schema, so importing ` +
        `it would leave gaps.\n\n${message}`,
    );
  }

  // (2) Describe every table from the schema, and make sure we can reach all
  // of them, BEFORE writing anything. Failing on table fifteen after writing
  // fourteen is the state nobody wants to be in.
  const shapes = buildShapes(Prisma.dmmf.datamodel.models);
  const delegates = new Map<string, Delegate>();
  for (const shape of shapes) delegates.set(shape.table, delegateFor(shape));

  // (3) Is this the right database?
  await runIdentityGuard(data, shapes, delegates, options);

  // (4) Plan every table. Reads only — the plan is what both modes print, and
  // what the real run then carries out, so the dry run cannot disagree with
  // the run it is predicting.
  const outcomes: TableOutcome[] = [];
  const plans: {
    shape: TableShape;
    plan: ReturnType<typeof planTable>;
    delegate: Delegate;
  }[] = [];

  for (const shape of shapes) {
    const delegate = delegates.get(shape.table);
    if (delegate === undefined) continue; // unreachable: built above.

    const incomingRows = rowsFor(data, shape.table);
    const existingRows = await delegate.findMany();
    const plan = planTable({ shape, existingRows, incomingRows });

    plans.push({ shape, plan, delegate });
    outcomes.push(outcomeFromPlan(plan));
  }

  if (options.dryRun) {
    finish(outcomes, options);
    return;
  }

  // (5) Write. In BACKUP_TABLES order, which is parents-before-children, so a
  // company exists by the time the job pointing at it is created.
  const written: TableOutcome[] = [];

  for (const { shape, plan, delegate } of plans) {
    let created = 0;
    let updated = 0;
    const skipped: SkippedRow[] = [...outcomeFromPlan(plan).skipped];

    for (const action of plan.actions) {
      try {
        if (action.kind === "create") {
          await delegate.create({ data: action.data });
          created += 1;
        } else if (action.kind === "update") {
          await delegate.update({
            where: { [shape.idField]: action.id },
            data: action.data,
          });
          updated += 1;
        }
      } catch (error) {
        // The row could not be written. It is counted and named — never
        // folded into "already there", which is the lie this rewrite exists
        // to remove. The run continues so one bad row doesn't strand the
        // other 2,799.
        skipped.push({ id: action.id, reason: describeError(error) });
      }
    }

    const planned = outcomeFromPlan(plan);
    written.push({
      ...planned,
      created,
      updated,
      // Anything planned as a write that then failed has moved into `skipped`,
      // so recompute `unchanged` from what is left rather than trusting the
      // plan's number. The four buckets have to keep adding up.
      unchanged: planned.inFile - created - updated - skipped.length,
      skipped,
    });

    process.stdout.write(
      `${shape.table.padEnd(22)} ${created} created, ${updated} updated\n`,
    );
  }

  console.log("");
  finish(written, options);
}

/** Every row the file holds for one table, with the missing case handled. */
function rowsFor(
  data: Record<string, unknown>,
  table: string,
): Record<string, unknown>[] {
  const value = data[table];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

/**
 * Stop if this database does not look like the one the backup came from.
 *
 * See src/lib/backup/guard.ts for the reasoning. In a dry run the verdict is
 * printed but not obeyed — a dry run writes nothing, and seeing the plan is
 * the fastest way to confirm you are pointed somewhere unexpected.
 */
async function runIdentityGuard(
  data: Record<string, unknown>,
  shapes: readonly TableShape[],
  delegates: ReadonlyMap<string, Delegate>,
  options: Options,
): Promise<void> {
  const backupEmails = rowsFor(data, "candidates")
    .map((row) => row.email)
    .filter((email): email is string => typeof email === "string");

  const targetCandidates = await db.candidate.findMany({
    select: { email: true },
  });

  let targetRowCount = 0;
  for (const shape of shapes) {
    const delegate = delegates.get(shape.table);
    if (delegate !== undefined) targetRowCount += await delegate.count();
  }

  const verdict = checkTargetIdentity({
    backupEmails,
    targetEmails: targetCandidates.map((candidate) => candidate.email),
    targetRowCount,
  });

  if (verdict.ok) {
    console.log(`Target check: ${verdict.note}.\n`);
    return;
  }

  if (options.dryRun) {
    console.log("WOULD REFUSE TO RUN\n");
    console.log(verdict.reason);
    console.log("\nShowing the plan anyway — a dry run writes nothing.\n");
    return;
  }

  if (options.force) {
    console.log("GUARD OVERRIDDEN BY --force\n");
    console.log(verdict.reason);
    console.log("\nContinuing because --force was given.\n");
    return;
  }

  throw new Error(`${verdict.reason}\n\n${describeForceEscapeHatch()}`);
}

/**
 * Print the summary, and set an exit code that matches it.
 *
 * Non-zero whenever rows could not be imported, in either mode. A script that
 * exits 0 having failed to move part of your data is the same category of
 * mistake as a summary that says "imported" when it skipped.
 */
function finish(outcomes: readonly TableOutcome[], options: Options): void {
  console.log(formatOutcomes(outcomes, options));

  // Last-resort arithmetic check on the reporting itself. If this ever fires,
  // the numbers above are wrong and should not be believed.
  for (const outcome of outcomes) {
    if (!isFullyAccountedFor(outcome)) {
      console.log(
        `\nWARNING: ${outcome.table} has ${outcome.inFile} rows in the file ` +
          `but only ${outcome.created + outcome.updated + outcome.unchanged + outcome.skipped.length} ` +
          `were accounted for. Do not trust the numbers above — this is a bug.`,
      );
      process.exitCode = 1;
    }
  }

  // Say again what was deliberately left out, so "where are my ResumeImport
  // rows" has an answer at restore time and not just at export time.
  console.log("");
  for (const [model, reason] of Object.entries(EXCLUDED_MODELS)) {
    console.log(`Never included in a backup: ${model} — ${reason}`);
  }

  console.log(`\n${headline(outcomes, options)}`);

  if (totals(outcomes).skipped > 0) process.exitCode = 1;
}

/** The destination, with the password stripped — this gets printed. */
function describeTarget(): string {
  const url = process.env.DATABASE_URL ?? "(DATABASE_URL not set)";
  return url.replace(/(:\/\/[^:]*:)[^@]*@/, "$1***@");
}

main()
  .catch((error: unknown) => {
    console.error(
      `\nImport stopped — nothing further was written.\n\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
