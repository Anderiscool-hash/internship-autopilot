/**
 * Copy this database to another one — local to hosted, usually.
 *
 * Writes every table to a single JSON file, in an order that respects foreign
 * keys, so `import-data.ts` can replay it into an empty database that has had
 * migrations applied.
 *
 * Why not pg_dump: it needs the Postgres client tools installed and matching
 * major versions, and it moves the schema as well as the data — which fights
 * with Prisma migrations owning the schema. This moves only rows, into a
 * database whose shape Prisma has already created.
 *
 * Run it with:  npm run data:export -- ./backup.json
 */

import { writeFileSync } from "node:fs";
import { db } from "../src/lib/db";

/** Everything worth moving, in dependency order. */
async function collect() {
  return {
    exportedAt: new Date().toISOString(),
    // Parents first: companies before jobs, candidates before their children.
    companies: await db.company.findMany(),
    jobs: await db.job.findMany(),
    candidates: await db.candidate.findMany(),
    workExperiences: await db.workExperience.findMany(),
    projects: await db.project.findMany(),
    education: await db.education.findMany(),
    truthFacts: await db.truthFact.findMany(),
    candidatePreferences: await db.candidatePreferences.findMany(),
    answerBankEntries: await db.answerBankEntry.findMany(),
    applications: await db.application.findMany(),
    eventLogs: await db.eventLog.findMany(),
    aiSettings: await db.aiSettings.findMany(),
    // Deliberately NOT resumeImport: those rows hold the full text of an
    // uploaded resume and exist only to carry a parse across one redirect.
    // There is no reason for them to travel to a server.
  };
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? "./backup.json";

  console.log("Reading...");
  const data = await collect();

  writeFileSync(target, JSON.stringify(data, null, 2), "utf-8");

  const counts = Object.entries(data)
    .filter(([, value]) => Array.isArray(value))
    .map(([name, value]) => `${name}=${(value as unknown[]).length}`)
    .join(" ");

  console.log(`Wrote ${target}`);
  console.log(counts);
  console.log(
    "\nThis file contains your profile and Truth Ledger. Treat it like the " +
      "personal document it is — it is git-ignored, keep it out of anywhere public.",
  );
}

main()
  .catch((error) => {
    console.error("Export failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
