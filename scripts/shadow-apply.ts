/**
 * Shadow Mode (spec §20).
 *
 * Fills a real application form and stops before Submit. Nothing is sent: the
 * browser context blocks every non-GET request while this runs, so submission
 * is impossible rather than merely unimplemented.
 *
 * Run it with:  npm run shadow -- <jobId>
 *               npm run shadow -- <jobId> --keep-open  (inspect, still locked)
 *               npm run shadow -- <jobId> --handoff    (fill, then it is yours)
 *
 * Afterwards it prints what it filled, what it could not, and where the
 * screenshot is. Record whether the fields were right with:
 *   npm run shadow:verdict -- <runId> correct
 *   npm run shadow:verdict -- <runId> wrong "what was wrong"
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/lib/db";
import { getProfile } from "../src/lib/candidate/store";
import { applicationUrlFor } from "../src/lib/apply/application-url";
import { runShadowApply } from "../src/lib/apply/shadow";
import { worthStoring } from "../src/lib/apply/ask-plan";
import { conceptOf } from "../src/lib/answers/concepts";
import type { AnswerEntry } from "../src/lib/answers/match";

/**
 * Mark work-authorization, sponsorship, age and the like as legal answers.
 *
 * The flag matters downstream: a legal answer is never reworded (spec §16),
 * because a paraphrase of "yes, I am authorized" is a different legal claim.
 */
function isLegalQuestion(question: string): boolean {
  const concept = conceptOf(question);
  return (
    concept === "work-authorization" ||
    concept === "sponsorship" ||
    concept === "age-18" ||
    concept === "security-clearance" ||
    concept === "criminal-record"
  );
}

const SHOT_DIR = resolve("./shadow-runs");

async function main(): Promise<void> {
  const jobId = process.argv[2];
  const keepOpen = process.argv.includes("--keep-open");
  // Handoff: fill it, then give the window to the person so they can submit.
  const handoff = process.argv.includes("--handoff");

  if (!jobId) {
    console.error("Usage: npm run shadow -- <jobId> [--keep-open]");
    process.exitCode = 1;
    return;
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { company: { select: { name: true, atsIdentifier: true } } },
  });
  if (!job) {
    console.error(`No job with id ${jobId}.`);
    process.exitCode = 1;
    return;
  }

  const profile = await getProfile(db);
  if (!profile) {
    console.error("No profile saved. Fill in /profile first — there is nothing to fill the form with.");
    process.exitCode = 1;
    return;
  }

  const answers: AnswerEntry[] = await db.answerBankEntry.findMany({
    where: { candidateId: profile.id },
    select: { id: true, question: true, answer: true, isLegal: true },
  });

  const url = applicationUrlFor({
    atsType: job.atsType,
    atsIdentifier: job.company.atsIdentifier,
    sourceJobId: job.sourceJobId,
    canonicalUrl: job.canonicalUrl,
  });

  mkdirSync(SHOT_DIR, { recursive: true });
  const screenshotPath = resolve(SHOT_DIR, `${job.id}-${Date.now()}.png`);

  console.log(`\nShadow run — ${job.title} at ${job.company.name}`);
  console.log(url);
  console.log("Nothing will be submitted: every non-GET request is blocked while this runs.\n");

  const result = await runShadowApply({
    url,
    profile: {
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      address: profile.address,
      school: profile.school,
      degree: profile.degree,
      graduationDate: profile.graduationDate,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
      portfolioUrl: profile.portfolioUrl,
    },
    answers,
    screenshotPath,
    keepOpen,
    handoff,
    // Asking only makes sense when someone is watching the window. A run that
    // nobody is sitting in front of would stop at the first question and wait
    // forever.
    ask: handoff || keepOpen || process.argv.includes("--ask"),

    async onAnswer(question, answer) {
      // Store it for next time — unless it is an answer about this employer or
      // this particular posting, which would be wrong on the next form rather
      // than merely unhelpful.
      if (!worthStoring(question, job.company.name)) {
        console.log(`  (not saved: "${question.slice(0, 50)}" is specific to this application)`);
        return;
      }

      const existing = await db.answerBankEntry.findFirst({
        where: { candidateId: profile.id, question },
      });

      if (existing) {
        await db.answerBankEntry.update({ where: { id: existing.id }, data: { answer } });
      } else {
        await db.answerBankEntry.create({
          data: { candidateId: profile.id, question, answer, isLegal: isLegalQuestion(question) },
        });
      }
      console.log(`  saved for next time: "${question.slice(0, 50)}" -> "${answer.slice(0, 40)}"`);
    },
  });

  const filled = result.outcomes.filter((o) => o.status === "filled" || o.status === "chosen");
  const skipped = result.outcomes.filter((o) => o.status === "skipped");
  const failed = result.outcomes.filter((o) => o.status === "failed");

  console.log("\nFilled:");
  for (const outcome of filled) {
    console.log(`  ${outcome.label}: ${outcome.detail}  [${outcome.source}]`);
  }

  if (failed.length > 0) {
    console.log("\nCould not fill:");
    for (const outcome of failed) console.log(`  ${outcome.label}: ${outcome.detail}`);
  }

  console.log(`\nLeft for you (${skipped.length}):`);
  for (const outcome of skipped.slice(0, 12)) {
    console.log(`  ${outcome.label}: ${outcome.detail}`);
  }
  if (skipped.length > 12) console.log(`  ...and ${skipped.length - 12} more`);

  if (result.captcha) console.log("\nCAPTCHA present — this form cannot be automated past this point.");
  if (result.loginRequired) console.log("\nThis form is behind a login.");

  console.log(
    `\nGuard: ${result.blockedTrackers} third-party beacons blocked (normal — ATS pages are full of them).`,
  );
  if (result.blockedSubmissions.length > 0) {
    console.log("!! Blocked a request to the form's own host — something tried to submit:");
    for (const request of result.blockedSubmissions) console.log(`  ${request}`);
  } else {
    console.log("Guard: no submission attempt was made.");
  }

  const run = await db.shadowRun.create({
    data: {
      jobId: job.id,
      candidateId: profile.id,
      url,
      atsType: job.atsType,
      fieldsTotal: result.outcomes.length,
      fieldsFilled: filled.length,
      fieldsSkipped: skipped.length,
      fieldsFailed: failed.length,
      blockingGaps: result.blockingGaps,
      captcha: result.captcha,
      loginRequired: result.loginRequired,
      screenshotPath,
      outcomes: result.outcomes as never,
    },
    select: { id: true },
  });

  console.log(`\nWould have applied: ${result.blockingGaps.length === 0 ? "YES" : "NO"}`);
  if (result.blockingGaps.length > 0) {
    console.log(`Required fields still empty: ${result.blockingGaps.join(", ")}`);
  }
  console.log(`\nScreenshot: ${screenshotPath}`);
  console.log("\nAll fields correct? Record it so adapter reliability can be measured:");
  console.log(`  npm run shadow:verdict -- ${run.id} correct`);
  console.log(`  npm run shadow:verdict -- ${run.id} wrong "what was wrong"`);
  console.log("\nNothing was submitted.");
}

main()
  .catch((error) => {
    console.error("Shadow run failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
