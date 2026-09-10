/**
 * How much the rule-based requirement extractor actually finds.
 *
 * Runs extraction (spec §10) over every stored posting and reports how often
 * each requirement was stated. This is the number that decides whether the AI
 * pass in Phase 3 is worth its cost: if the regexes already read sponsorship
 * out of most postings, the model does not need to be asked about sponsorship.
 *
 * It also prints a few examples of each finding so they can be eyeballed for
 * false positives — a wrongly-extracted requirement hides a job the candidate
 * could have applied to, so the examples matter more than the totals.
 *
 * Run it with:  npm run eligibility:report
 */

import { db } from "../src/lib/db";
import { extractRequirements } from "../src/lib/eligibility/extract";
import { classifyStudentRole } from "../src/lib/jobs/classify";

/** How many example titles to print per finding. */
const EXAMPLES = 3;

async function main(): Promise<void> {
  const jobs = await db.job.findMany({
    select: { title: true, description: true },
  });

  console.log(`Extracting requirements from ${jobs.length} stored postings.\n`);

  const counts = {
    education: 0,
    graduation: 0,
    experience: 0,
    noSponsorship: 0,
    sponsorship: 0,
    citizenship: 0,
    clearance: 0,
    anything: 0,
  };
  const examples: Record<string, string[]> = {};

  /** Record an example title under a finding, up to the cap. */
  function example(key: string, title: string): void {
    const list = (examples[key] ??= []);
    if (list.length < EXAMPLES) list.push(title);
  }

  // Student-role postings are the ones eligibility actually runs on, so they
  // get counted separately — coverage over 600 senior job ads is not the
  // number that matters.
  let studentRoles = 0;
  let studentRolesWithSomething = 0;

  for (const job of jobs) {
    const requirements = extractRequirements(job.description);
    const isStudentRole = classifyStudentRole(job.title).verdict !== "reject";
    if (isStudentRole) studentRoles += 1;

    let found = false;

    if (requirements.educationLevel) {
      counts.education += 1;
      example(`education:${requirements.educationLevel}`, job.title);
      found = true;
    }
    if (requirements.graduationWindow) {
      counts.graduation += 1;
      example("graduation", job.title);
      found = true;
    }
    if (requirements.minimumExperienceYears !== null) {
      counts.experience += 1;
      example(`experience:${requirements.minimumExperienceYears}`, job.title);
      found = true;
    }
    if (requirements.sponsorship === "none") {
      counts.noSponsorship += 1;
      example("no-sponsorship", job.title);
      found = true;
    }
    if (requirements.sponsorship === "available") {
      counts.sponsorship += 1;
      example("sponsorship", job.title);
      found = true;
    }
    if (requirements.citizenshipRequired) {
      counts.citizenship += 1;
      example("citizenship", job.title);
      found = true;
    }
    if (requirements.clearanceRequired) {
      counts.clearance += 1;
      example("clearance", job.title);
      found = true;
    }

    if (found) {
      counts.anything += 1;
      if (isStudentRole) studentRolesWithSomething += 1;
    }
  }

  const percent = (n: number, total: number) =>
    total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`;

  console.log("--- how often each requirement is stated ---");
  console.log(`degree level:        ${counts.education} (${percent(counts.education, jobs.length)})`);
  console.log(`graduation window:   ${counts.graduation} (${percent(counts.graduation, jobs.length)})`);
  console.log(`experience minimum:  ${counts.experience} (${percent(counts.experience, jobs.length)})`);
  console.log(`refuses sponsorship: ${counts.noSponsorship} (${percent(counts.noSponsorship, jobs.length)})`);
  console.log(`offers sponsorship:  ${counts.sponsorship} (${percent(counts.sponsorship, jobs.length)})`);
  console.log(`citizenship:         ${counts.citizenship} (${percent(counts.citizenship, jobs.length)})`);
  console.log(`clearance:           ${counts.clearance} (${percent(counts.clearance, jobs.length)})`);
  console.log(
    `\nany requirement:     ${counts.anything} of ${jobs.length} (${percent(counts.anything, jobs.length)})`,
  );
  console.log(
    `student roles:       ${studentRolesWithSomething} of ${studentRoles} (${percent(studentRolesWithSomething, studentRoles)})`,
  );

  console.log("\n--- examples (check these for false positives) ---");
  for (const [key, titles] of Object.entries(examples).sort()) {
    console.log(`\n${key}:`);
    for (const title of titles) console.log(`  ${title}`);
  }
}

main()
  .catch((error) => {
    console.error("Eligibility report failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
