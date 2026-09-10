/**
 * One-shot discovery run.
 *
 * Scans every active company's board right now, regardless of whether it is
 * due, and prints what happened. Useful for seeing a change take effect
 * without waiting for the continuous scanner (`npm run scan`) to come round to
 * it, and for pointing the code at real employer boards to find out what
 * breaks — which unit tests with fixture data cannot tell us.
 *
 * The actual scanning logic lives in src/lib/scan/scanner.ts and is shared
 * with the continuous scanner, so what you see here is exactly what the 24/7
 * process does. This script only decides *which* companies to scan (all of
 * them) and how to print the result.
 *
 * Run it with:  npm run discover
 */

import { db } from "../src/lib/db";
import { classifyStudentRole } from "../src/lib/jobs/classify";
import { scanCompany } from "../src/lib/scan/scanner";

async function main(): Promise<void> {
  // Companies with a null atsIdentifier or atsType are ones whose board we
  // never confirmed (spec §4). scanCompany() records them as a failure rather
  // than guessing an identifier, which would scan someone else's jobs.
  const companies = await db.company.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  console.log(`Scanning ${companies.length} active companies.\n`);

  const now = new Date();
  let totalFetched = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalClosed = 0;
  const failures: string[] = [];

  for (const company of companies) {
    const outcome = await scanCompany(db, company, now);

    if (!outcome.ok) {
      failures.push(`${company.name}: ${outcome.error}`);
      console.log(`  ${company.name}: FAILED`);
      continue;
    }

    totalFetched += outcome.fetched;
    totalCreated += outcome.created;
    totalUpdated += outcome.updated;
    totalClosed += outcome.closed;

    console.log(
      `  ${company.name} (${company.atsType}): ${outcome.fetched} fetched, ` +
        `${outcome.created} new, ${outcome.updated} refreshed, ` +
        `${outcome.closed} closed — next scan in ${outcome.nextInterval}m`,
    );
  }

  // Classifier breakdown over everything currently stored, not just this run:
  // it is the number worth watching as the classifier changes (spec §9).
  const stored = await db.job.findMany({ select: { title: true } });
  let keep = 0;
  let reject = 0;
  let ambiguous = 0;
  for (const job of stored) {
    const verdict = classifyStudentRole(job.title).verdict;
    if (verdict === "keep") keep += 1;
    else if (verdict === "reject") reject += 1;
    else ambiguous += 1;
  }

  console.log("\n--- summary ---");
  console.log(`jobs fetched:      ${totalFetched}`);
  console.log(`rows created:      ${totalCreated}`);
  console.log(`rows refreshed:    ${totalUpdated}`);
  console.log(`rows closed:       ${totalClosed}`);
  console.log(`\nstored jobs:       ${stored.length}`);
  console.log(`classifier keep:   ${keep}`);
  console.log(`classifier reject: ${reject}`);
  console.log(`classifier maybe:  ${ambiguous}`);

  if (failures.length > 0) {
    console.log(`\nfailures (${failures.length}):`);
    for (const failure of failures) console.log(`  ${failure}`);
  }
}

main()
  .catch((error) => {
    console.error("Discovery run failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
