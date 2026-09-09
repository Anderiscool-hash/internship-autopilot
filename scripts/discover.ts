/**
 * One-shot job discovery run.
 *
 * This is the whole discovery half of the pipeline executed once, by hand:
 *
 *   read the company registry -> fetch that company's board -> normalize
 *   -> classify -> fingerprint -> save
 *
 * Phase 2 turns this into a continuous, scheduled loop (spec §5). For now it
 * exists so we can point the code at real employer boards and find out what
 * actually breaks — which is not something unit tests with fixture data can
 * tell us.
 *
 * Run it with:  npm run discover
 */

import { db } from "../src/lib/db";
import { getAtsJobFetcher, UnsupportedAtsError } from "../src/lib/ats/index";
import { classifyStudentRole } from "../src/lib/jobs/classify";
import { upsertJob } from "../src/lib/jobs/persist";
import type { AtsType } from "../src/lib/jobs/types";

/**
 * The database stores ATS names in SCREAMING_CASE (GREENHOUSE); the client
 * code uses lowercase ("greenhouse"). Convert on the way out of the database.
 * SAP is the one value where a plain lowercase() is not enough.
 */
function dbAtsToCode(dbValue: string): AtsType {
  if (dbValue === "SAP_SUCCESSFACTORS") return "sap";
  return dbValue.toLowerCase() as AtsType;
}

async function main(): Promise<void> {
  // Only scan companies the registry says are active AND that have a board
  // identifier. A company with a null identifier (like the seeded Microsoft
  // entry) is one whose board slug we never confirmed — scanning it would
  // either 404 or, worse, silently pull some other company's jobs.
  // atsType is nullable too (a company can be in the registry before we have
  // worked out which ATS it uses), so it has to be excluded here as well —
  // otherwise the first such company would crash the whole run.
  const companies = await db.company.findMany({
    where: {
      active: true,
      atsIdentifier: { not: null },
      atsType: { not: null },
    },
    orderBy: { name: "asc" },
  });

  console.log(`Scanning ${companies.length} active companies.\n`);

  // Running totals, reported at the end.
  let totalFetched = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let keep = 0;
  let reject = 0;
  let ambiguous = 0;
  const failures: string[] = [];

  for (const company of companies) {
    const identifier = company.atsIdentifier;
    const atsType = company.atsType;
    // Narrowing for TypeScript's benefit; the query above already excludes
    // nulls, but the compiler cannot know that.
    if (!identifier || !atsType) continue;

    const label = `${company.name} (${company.atsType})`;

    try {
      const fetchJobs = getAtsJobFetcher(dbAtsToCode(atsType));
      const jobs = await fetchJobs(identifier, company.name);
      totalFetched += jobs.length;

      let created = 0;
      let updated = 0;

      for (const job of jobs) {
        // The cheap keyword filter from spec §9. Note we still SAVE every job
        // regardless of verdict — the canonical record is worth keeping, and
        // a classifier we improve later can be re-run over stored rows. The
        // verdict is what gates expensive AI analysis downstream, not storage.
        const verdict = classifyStudentRole(job.title).verdict;
        if (verdict === "keep") keep++;
        else if (verdict === "reject") reject++;
        else ambiguous++;

        const outcome = await upsertJob(db, company.id, job);
        if (outcome === "created") created++;
        else updated++;
      }

      totalCreated += created;
      totalUpdated += updated;
      console.log(
        `  ${label}: ${jobs.length} fetched, ${created} new, ${updated} refreshed`,
      );
    } catch (error) {
      // One bad board must not abort the whole run. Record it and continue —
      // this is exactly how the Phase 2 scanner will need to behave.
      const message = error instanceof Error ? error.message : String(error);
      const kind = error instanceof UnsupportedAtsError ? "unsupported" : "error";
      failures.push(`${label}: [${kind}] ${message}`);
      console.log(`  ${label}: FAILED (${kind})`);
    }

    // Update the registry's scan bookkeeping (spec §4) whether or not the
    // fetch succeeded, so adaptive polling can tell a board was attempted.
    await db.company.update({
      where: { id: company.id },
      data: { lastScan: new Date() },
    });
  }

  console.log("\n--- summary ---");
  console.log(`jobs fetched:      ${totalFetched}`);
  console.log(`rows created:      ${totalCreated}`);
  console.log(`rows refreshed:    ${totalUpdated}`);
  console.log(`classifier keep:   ${keep}`);
  console.log(`classifier reject: ${reject}`);
  console.log(`classifier maybe:  ${ambiguous}`);

  if (failures.length > 0) {
    console.log(`\nfailures (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
  }
}

main()
  .catch((error) => {
    console.error("Discovery run failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
