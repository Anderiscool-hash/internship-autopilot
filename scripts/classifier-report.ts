/**
 * Classifier Report Tool
 *
 * Measures the job title classifier against all titles in the Job table.
 * Run this tool whenever the classifier rules change to see the impact on
 * real data: before/after counts of keep/reject/ambiguous, plus examples
 * of each verdict.
 *
 * Usage:
 *   npm run classifier:report
 *
 * The counts help answer: "Are we filtering more jobs? Fewer? Are we sending
 * more to the expensive AI?" The example titles help answer: "Did we just
 * filter out a real internship by mistake?"
 */

import { db } from "../src/lib/db";
import { classifyStudentRole } from "../src/lib/jobs/classify";

async function main() {
  console.log("Fetching all job titles from database...");
  const jobs = await db.job.findMany({
    select: { id: true, title: true },
  });

  console.log(`Found ${jobs.length} jobs. Classifying...`);

  // Classify each job and collect results
  const results: {
    keep: string[];
    reject: string[];
    ambiguous: string[];
  } = {
    keep: [],
    reject: [],
    ambiguous: [],
  };

  for (const job of jobs) {
    const classification = classifyStudentRole(job.title);
    results[classification.verdict].push(job.title);
  }

  // Print summary counts
  console.log("\n" + "=".repeat(70));
  console.log("CLASSIFICATION SUMMARY");
  console.log("=".repeat(70));
  console.log(`Total jobs: ${jobs.length}`);
  console.log(`Keep:       ${results.keep.length} (${((results.keep.length / jobs.length) * 100).toFixed(1)}%)`);
  console.log(`Reject:     ${results.reject.length} (${((results.reject.length / jobs.length) * 100).toFixed(1)}%)`);
  console.log(`Ambiguous:  ${results.ambiguous.length} (${((results.ambiguous.length / jobs.length) * 100).toFixed(1)}%)`);

  // Print examples (up to 20 per category)
  const exampleLimit = 20;

  console.log("\n" + "=".repeat(70));
  console.log("KEEP EXAMPLES (up to 20)");
  console.log("=".repeat(70));
  results.keep.slice(0, exampleLimit).forEach((title, idx) => {
    console.log(`${idx + 1}. ${title}`);
  });

  console.log("\n" + "=".repeat(70));
  console.log("AMBIGUOUS EXAMPLES (up to 20)");
  console.log("=".repeat(70));
  results.ambiguous.slice(0, exampleLimit).forEach((title, idx) => {
    console.log(`${idx + 1}. ${title}`);
  });

  console.log("\n" + "=".repeat(70));
  console.log("REJECT EXAMPLES (up to 20)");
  console.log("=".repeat(70));
  results.reject.slice(0, exampleLimit).forEach((title, idx) => {
    console.log(`${idx + 1}. ${title}`);
  });

  console.log("\n" + "=".repeat(70));
  console.log("COMPARISON TO BASELINE");
  console.log("=".repeat(70));
  console.log("Before changes (from task description):");
  console.log("  Keep:       116");
  console.log("  Reject:     1,132");
  console.log("  Ambiguous:  1,487");
  console.log("\nAfter changes:");
  console.log(
    `  Keep:       ${results.keep.length}`
  );
  console.log(
    `  Reject:     ${results.reject.length}`
  );
  console.log(
    `  Ambiguous:  ${results.ambiguous.length}`
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
