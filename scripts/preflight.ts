/**
 * Application preflight (spec §19) — read only.
 *
 * Runs the checks spec §19 lists immediately before submitting, and prints the
 * checklist. It does not submit anything, and there is no code path here that
 * could: the apply workers of spec §22 are not built.
 *
 * What it does:
 *   job still open? not already applied? eligibility still passes?
 *   -> open the real application form in a browser and read it
 *   -> match its questions against the profile and the answer bank
 *   -> compute application confidence (spec §17)
 *   -> print what the auto-apply rules would decide (spec §18)
 *
 * Run it with:  npm run preflight -- <jobId>
 * The job id is the one in the dashboard URL, /jobs/<id>.
 */

import { db } from "../src/lib/db";
import { getProfile } from "../src/lib/candidate/store";
import { checkEligibility } from "../src/lib/eligibility/engine";
import { extractRequirements } from "../src/lib/eligibility/extract";
import { readStoredRequirements } from "../src/lib/eligibility/stored";
import { toEligibilityProfile } from "../src/lib/fit/profile";
import { findAnswer, type AnswerEntry } from "../src/lib/answers/match";
import { applicationUrlFor } from "../src/lib/apply/application-url";
import { launchBrowser, readApplicationForm } from "../src/lib/apply/read-form";
import { scoreConfidence, type ParsedField } from "../src/lib/apply/confidence";
import {
  computeTrustLevel,
  gatherTrustEvidence,
  reliabilityForTrustLevel,
} from "../src/lib/apply/trust";
import {
  decideAutoApply,
  readAtsModes,
  DEFAULT_RULES,
} from "../src/lib/autoapply/rules";

const TICK = "yes";
const CROSS = "NO";

/** One checklist line, in the shape spec §19 draws it. */
function line(label: string, value: string): void {
  console.log(`${label.padEnd(32)} ${value}`);
}

/** The profile fields the standard-field check looks at. */
interface ProfileCoverage {
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  school: string | null;
  degree: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  graduationDate: Date | null;
}

/** Does the profile already hold a value for this standard field? */
function profileCovers(label: string, profile: ProfileCoverage): boolean {
  const text = label.toLowerCase();
  if (/name/.test(text)) return profile.name.length > 0;
  if (/e-?mail/.test(text)) return profile.email.length > 0;
  if (/phone|mobile|telephone/.test(text)) return profile.phone !== null;
  if (/city|state|country|location|address|zip|postal/.test(text)) {
    return profile.address !== null;
  }
  if (/linked\s?in/.test(text)) return profile.linkedinUrl !== null;
  if (/github/.test(text)) return profile.githubUrl !== null;
  if (/website|portfolio|personal site/.test(text)) return profile.portfolioUrl !== null;
  if (/school|university|college/.test(text)) return profile.school !== null;
  if (/degree|discipline|major|field of study/.test(text)) return profile.degree !== null;
  if (/graduation|grad date/.test(text)) return profile.graduationDate !== null;
  return false;
}

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: npm run preflight -- <jobId>");
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
    console.error("No profile saved. Fill in /profile first.");
    process.exitCode = 1;
    return;
  }

  console.log(`\n${job.title} - ${job.company.name}`);
  console.log(`${job.canonicalUrl}\n`);
  console.log("Preflight");
  console.log("-".repeat(48));

  // --- checks that need no browser ---------------------------------------

  const stillOpen = job.status === "OPEN";
  line("Job still open?", stillOpen ? TICK : CROSS);

  const existing = await db.application.findUnique({
    where: { candidateId_jobId: { candidateId: profile.id, jobId: job.id } },
  });
  line("Not previously applied?", existing?.appliedAt == null ? TICK : CROSS);

  const requirements =
    readStoredRequirements(job.requirements) ?? extractRequirements(job.description);
  const eligibility = checkEligibility(toEligibilityProfile(profile), requirements);
  line(
    "Eligibility still passes?",
    eligibility.verdict === "ineligible"
      ? CROSS
      : eligibility.verdict === "eligible"
        ? TICK
        : "unconfirmed",
  );
  for (const blocker of eligibility.blockers) {
    console.log(`    ${blocker.reason}`);
  }

  // --- read the real form ------------------------------------------------

  // Read the ATS-native form URL, not the employer's marketing page — see
  // src/lib/apply/application-url.ts for why they are usually different.
  const formUrl = applicationUrlFor({
    atsType: job.atsType,
    atsIdentifier: job.company.atsIdentifier,
    sourceJobId: job.sourceJobId,
    canonicalUrl: job.canonicalUrl,
  });

  console.log(`\nReading the application form...\n${formUrl}`);
  const browser = await launchBrowser();
  let form;
  try {
    form = await readApplicationForm(browser, formUrl);
  } finally {
    await browser.close();
  }

  const answers: AnswerEntry[] = await db.answerBankEntry.findMany({
    where: { candidateId: profile.id },
    select: { id: true, question: true, answer: true, isLegal: true },
  });

  // A field counts as answered when the profile covers it (standard fields) or
  // the answer bank has a close enough match (spec §16). Anything else is
  // unknown, which is exactly what should stop an unattended run. File uploads
  // are never "answered" — documents are Phase 4 and do not exist yet.
  const fields: ParsedField[] = form.fields.map((field) => ({
    label: field.label,
    kind: field.kind,
    required: field.required,
    answered:
      field.kind === "standard"
        ? profileCovers(field.label, profile)
        : field.kind === "file"
          ? false
          : findAnswer(field.label, answers) !== null,
  }));

  console.log("");
  line("Fields detected:", String(fields.length));
  line("Known answers:", String(fields.filter((field) => field.answered).length));
  line(
    "Required and unanswered:",
    String(fields.filter((field) => field.required && !field.answered).length),
  );
  line("Unrecognized by the parser:", String(form.unrecognizedFields));
  line("CAPTCHA detected?", form.captcha ? "YES" : "No");
  line("Login required?", form.loginRequired ? "YES" : "No");
  line("Resume upload on the form?", form.resumeRequired ? "Yes" : "No");
  line("Cover letter upload?", form.coverLetterRequired ? "Yes" : "No");

  // Documents are Phase 4, so readiness is honestly false rather than assumed.
  const evidence = await gatherTrustEvidence(db, job.atsType, false);
  const confidence = scoreConfidence(
    { ...form, fields },
    { resumeReady: false, coverLetterReady: false },
    reliabilityForTrustLevel(computeTrustLevel(evidence)),
  );

  console.log("");
  line("Application confidence:", `${confidence.score}%`);
  for (const component of confidence.components) {
    const points = Math.round(component.score * 100)
      .toString()
      .padStart(3);
    console.log(`    ${component.name.padEnd(18)} ${points}  ${component.detail}`);
  }

  if (confidence.blockers.length > 0) {
    console.log("");
    for (const blocker of confidence.blockers) console.log(`  ${blocker}`);
  }

  if (confidence.unanswered.length > 0) {
    console.log("\nRequired questions with no stored answer:");
    for (const question of confidence.unanswered) console.log(`  - ${question}`);
    console.log("Add these at /answers - spec §16 says an unknown answer pauses the run.");
  }

  // --- what the auto-apply rules would say -------------------------------

  const prefs = await db.candidatePreferences.findUnique({
    where: { candidateId: profile.id },
  });
  const rules = prefs
    ? { ...prefs, atsModes: readAtsModes(prefs.atsAutoApplyModes) }
    : DEFAULT_RULES;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [applicationsToday, applicationsToCompany] = await Promise.all([
    db.application.count({
      where: { candidateId: profile.id, appliedAt: { gte: startOfToday } },
    }),
    db.application.count({
      where: {
        candidateId: profile.id,
        appliedAt: { not: null },
        job: { companyId: job.companyId },
      },
    }),
  ]);

  const decision = decideAutoApply(
    rules,
    {
      fitScore: existing?.fitScore ?? null,
      applicationConfidence: confidence.score,
      eligibility: eligibility.verdict,
      jobOpen: stillOpen,
      firstSeenAt: job.firstSeenAt,
      atsType: job.atsType,
      applicationsToday,
      applicationsToCompany,
    },
    new Date(),
  );

  console.log("");
  console.log("-".repeat(48));
  console.log(
    decision.verdict === "auto"
      ? "AUTO APPLY WOULD BE AUTHORIZED"
      : decision.verdict === "review"
        ? "WOULD STOP AND ASK YOU"
        : "BLOCKED - WOULD NOT APPLY",
  );
  for (const reason of decision.reasons) console.log(`  ${reason}`);

  console.log(
    "\nNothing was submitted. This command only reads; the apply workers (spec §22) are not built.",
  );
}

main()
  .catch((error) => {
    console.error("Preflight failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
