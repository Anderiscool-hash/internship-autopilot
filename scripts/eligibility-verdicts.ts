/**
 * What the hard eligibility engine (spec §11) actually decides, in aggregate.
 *
 * `eligibility:report` measures how often the extractor FINDS a requirement.
 * This measures the consequence: of the postings that are really student
 * roles, how many get ruled out, and which single check did the ruling out.
 *
 * Run it before and after any change to extraction or the engine. A fix that
 * moves the "ruled ineligible" count without you being able to say which
 * check moved and why is a fix you cannot trust — a wrongly-extracted
 * requirement hides a job the candidate could have had, which is the one
 * error they can never discover for themselves.
 *
 * Run it with:  npm run eligibility:verdicts
 */

import { db } from "../src/lib/db";
import { extractRequirements } from "../src/lib/eligibility/extract";
import { classifyStudentRole } from "../src/lib/jobs/classify";
import { checkEligibility } from "../src/lib/eligibility/engine";
import { getProfile } from "../src/lib/candidate/store";
import { toEligibilityProfile } from "../src/lib/fit/profile";

async function main(): Promise<void> {
  const stored = await getProfile(db);
  if (!stored) {
    console.log("No profile saved — eligibility cannot run.");
    return;
  }
  const profile = toEligibilityProfile(stored);

  const jobs = await db.job.findMany({ select: { title: true, description: true } });
  const student = jobs.filter((j) => classifyStudentRole(j.title).verdict !== "reject");

  let pass = 0;
  let fail = 0;
  // Which reason codes appear on failing jobs, counted once per job.
  const reasons: Record<string, number> = {};

  for (const job of student) {
    const result = checkEligibility(profile, extractRequirements(job.description));
    if (result.verdict === "ineligible") {
      fail += 1;
      for (const b of result.blockers) reasons[b.label] = (reasons[b.label] ?? 0) + 1;
    } else {
      pass += 1;
    }
  }

  console.log(`student-role postings: ${student.length} (of ${jobs.length} total)`);
  console.log(`  eligible / unconfirmed : ${pass}`);
  console.log(`  ruled ineligible   : ${fail}`);
  console.log("\nreasons on ineligible postings:");
  for (const [key, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(24)} ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
