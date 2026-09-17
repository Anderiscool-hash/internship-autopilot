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
 * "Every table" is checked, not assumed: src/lib/backup/coverage.ts holds the
 * declaration of what a backup must contain, and this script refuses to write
 * a file that doesn't match the schema. See that file for why.
 *
 * Run it with:  npm run data:export -- ./backup.json
 */

import { writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  EXCLUDED_MODELS,
  assertExportCoverage,
} from "../src/lib/backup/coverage";

/** Everything worth moving, in dependency order. */
async function collect() {
  return {
    exportedAt: new Date().toISOString(),
    // Parents first: companies before jobs, candidates before their children.
    companies: await db.company.findMany(),
    jobs: await db.job.findMany(),
    candidates: await db.candidate.findMany(),
    // The document registry, including which file is isDefault per kind. The
    // bytes stay on disk — this is the index that says what they are.
    candidateDocuments: await db.candidateDocument.findMany(),
    workExperiences: await db.workExperience.findMany(),
    projects: await db.project.findMany(),
    education: await db.education.findMany(),
    truthFacts: await db.truthFact.findMany(),
    candidatePreferences: await db.candidatePreferences.findMany(),
    answerBankEntries: await db.answerBankEntry.findMany(),
    applications: await db.application.findMany(),
    // Shadow runs carry the human verdicts the trust ladder reads to decide
    // whether an adapter may submit at all. Losing them resets every adapter
    // to untested, so they travel with everything else.
    shadowRuns: await db.shadowRun.findMany(),
    submissionAttempts: await db.submissionAttempt.findMany(),
    eventLogs: await db.eventLog.findMany(),
    aiSettings: await db.aiSettings.findMany(),
    // Deliberately NOT resumeImport — see EXCLUDED_MODELS in
    // src/lib/backup/coverage.ts, which is what makes that omission a decision
    // the guard below can check rather than a line someone forgot to write.
  };
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? "./backup.json";

  console.log("Reading...");
  const data = await collect();

  // Before anything is written: does this cover the schema as it stands today?
  // Checked here rather than in collect() so the message names the real keys
  // that came back, not the ones we meant to produce.
  assertExportCoverage({
    schemaModels: Prisma.dmmf.datamodel.models,
    collectedKeys: Object.keys(data),
  });

  writeFileSync(target, JSON.stringify(data, null, 2), "utf-8");

  const counts = Object.entries(data)
    .filter(([, value]) => Array.isArray(value))
    .map(([name, value]) => `${name}=${(value as unknown[]).length}`)
    .join(" ");

  console.log(`Wrote ${target}`);
  console.log(counts);

  // Print what was left out too. The whole reason three tables went missing
  // for so long is that a summary listing only what it collected looks
  // complete no matter how much it skipped.
  for (const [model, reason] of Object.entries(EXCLUDED_MODELS)) {
    console.log(`Not included: ${model} — ${reason}`);
  }

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
