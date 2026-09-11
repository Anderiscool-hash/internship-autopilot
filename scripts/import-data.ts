/**
 * Replay an export into this database.
 *
 * Point DATABASE_URL at the destination and run it. The destination must
 * already have the schema (`npx prisma migrate deploy`); this moves rows, not
 * structure.
 *
 * Run it with:  npm run data:import -- ./backup.json
 *
 * Safe to re-run: every row is written with its original id and skipped if it
 * is already there. An interrupted import can simply be run again, which is
 * the property that matters when moving 2,800 rows over a home connection.
 */

import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";

/** Rows arrive as JSON, so dates are strings and must be revived. */
const DATE_FIELDS = /At$|Date$|^lastScan$|^lastChange$|^interviewDates$/;

function reviveDates(row: Record<string, unknown>): Record<string, unknown> {
  const revived: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && DATE_FIELDS.test(key)) {
      const parsed = new Date(value);
      revived[key] = Number.isNaN(parsed.getTime()) ? value : parsed;
    } else if (Array.isArray(value) && DATE_FIELDS.test(key)) {
      revived[key] = value.map((item) =>
        typeof item === "string" ? new Date(item) : item,
      );
    } else {
      revived[key] = value;
    }
  }
  return revived;
}

/**
 * Insert rows one table at a time, skipping any that already exist.
 *
 * createMany with skipDuplicates would be faster, but it does not report which
 * rows it skipped, and on a first migration you want to know whether you moved
 * 2,800 jobs or 0.
 */
async function load(
  name: string,
  rows: Record<string, unknown>[],
  create: (data: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  if (rows.length === 0) {
    console.log(`${name.padEnd(22)} nothing to move`);
    return;
  }

  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await create(reviveDates(row));
      written += 1;
    } catch (error) {
      // A unique-constraint collision means the row is already there, which is
      // exactly what a re-run should do quietly. Anything else is real.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Unique constraint")) {
        skipped += 1;
      } else {
        throw error;
      }
    }
  }

  console.log(
    `${name.padEnd(22)} ${written} written${skipped > 0 ? `, ${skipped} already there` : ""}`,
  );
}

async function main(): Promise<void> {
  const source = process.argv[2] ?? "./backup.json";
  const data = JSON.parse(readFileSync(source, "utf-8")) as Record<string, unknown[]>;

  console.log(`Importing ${source} into ${describeTarget()}\n`);

  // Order matters: a job cannot reference a company that is not there yet.
  await load("companies", data.companies as never, (row) =>
    db.company.create({ data: row as never }),
  );
  await load("jobs", data.jobs as never, (row) =>
    db.job.create({ data: row as never }),
  );
  await load("candidates", data.candidates as never, (row) =>
    db.candidate.create({ data: row as never }),
  );
  await load("workExperiences", (data.workExperiences ?? []) as never, (row) =>
    db.workExperience.create({ data: row as never }),
  );
  await load("projects", (data.projects ?? []) as never, (row) =>
    db.project.create({ data: row as never }),
  );
  await load("education", (data.education ?? []) as never, (row) =>
    db.education.create({ data: row as never }),
  );
  await load("truthFacts", (data.truthFacts ?? []) as never, (row) =>
    db.truthFact.create({ data: row as never }),
  );
  await load("candidatePreferences", (data.candidatePreferences ?? []) as never, (row) =>
    db.candidatePreferences.create({ data: row as never }),
  );
  await load("answerBankEntries", (data.answerBankEntries ?? []) as never, (row) =>
    db.answerBankEntry.create({ data: row as never }),
  );
  await load("applications", (data.applications ?? []) as never, (row) =>
    db.application.create({ data: row as never }),
  );
  await load("eventLogs", (data.eventLogs ?? []) as never, (row) =>
    db.eventLog.create({ data: row as never }),
  );
  await load("aiSettings", (data.aiSettings ?? []) as never, (row) =>
    db.aiSettings.create({ data: row as never }),
  );

  console.log("\nDone.");
}

/** The destination, with the password stripped — this gets printed. */
function describeTarget(): string {
  const url = process.env.DATABASE_URL ?? "(DATABASE_URL not set)";
  return url.replace(/(:\/\/[^:]*:)[^@]*@/, "$1***@");
}

main()
  .catch((error) => {
    console.error("Import failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
