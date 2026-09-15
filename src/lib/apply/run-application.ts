/**
 * Running one application, independent of who asked.
 *
 * The CLI and the background daemon both call this. It existed as the body of
 * scripts/shadow-apply.ts first; the daemon needed the same sequence —
 * profile, answers, documents, history, mailbox, run, persist — and two copies
 * of that would have drifted the first time either was touched.
 *
 * Narration goes through `log` rather than to the console directly, so the
 * daemon can route a run's output to whoever asked for it.
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "playwright";
import type { PrismaClient } from "@prisma/client";
import { getProfile } from "../candidate/store";
import { historyForApply } from "../candidate/history";
import { documentsForApply } from "../documents/store";
import { inboxConfig } from "../email/inbox";
import { senderDomainFor } from "../email/detect-field";
import { conceptOf } from "../answers/concepts";
import { applicationUrlFor } from "./application-url";
import { worthStoring } from "./ask-plan";
import { runShadowApply, type FilledHandle, type ShadowRunResult } from "./shadow";
import type { AnswerEntry } from "../answers/match";

/** Where screenshots go. */
const SHOT_DIR = resolve("./shadow-runs");

/**
 * Where the browser session is kept between runs.
 *
 * Under ./storage, which is gitignored. This file holds live session cookies
 * for every ATS the candidate has signed into — as sensitive as a password,
 * and treated that way.
 */
export const SESSION_STATE_PATH = resolve("./storage/browser-session.json");

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

export interface RunApplicationOptions {
  jobId: string;
  /** Leave the window open for inspection, guard still on. */
  keepOpen?: boolean;
  /** Fill it, then lift the guard and hand the window over. */
  handoff?: boolean;
  /** Called once filling is done, with the page still live. See shadow.ts. */
  onFilled?: (handle: FilledHandle) => Promise<void>;
  /** Ask for the fields nothing could fill. Defaults on when a human is watching. */
  ask?: boolean;
  /** Read an emailed verification code from the configured mailbox. */
  verify?: boolean;
  /** A warm browser to borrow. The daemon supplies one; the CLI does not. */
  browser?: Browser;
  /** Keep cookies between runs, so a portal login survives. */
  persistSession?: boolean;
  /** Where narration goes. */
  log?: (line: string) => void;
}

export interface RunApplicationOutcome {
  /** The ShadowRun row's id, for recording a verdict against. */
  runId: string;
  result: ShadowRunResult;
  jobTitle: string;
  companyName: string;
  url: string;
  screenshotPath: string;
}

export class ApplicationRunError extends Error {}

/** Do one application, end to end. */
export async function runApplication(
  db: PrismaClient,
  options: RunApplicationOptions,
): Promise<RunApplicationOutcome> {
  const log = options.log ?? ((line: string) => console.log(line));

  const job = await db.job.findUnique({
    where: { id: options.jobId },
    include: { company: { select: { name: true, atsIdentifier: true } } },
  });
  if (!job) throw new ApplicationRunError(`No job with id ${options.jobId}.`);

  const profile = await getProfile(db);
  if (!profile) {
    throw new ApplicationRunError(
      "No profile saved. Fill in /profile first — there is nothing to fill the form with.",
    );
  }

  const answers: AnswerEntry[] = await db.answerBankEntry.findMany({
    where: { candidateId: profile.id },
    select: { id: true, question: true, answer: true, isLegal: true },
  });

  const documents = await documentsForApply(db, profile.id);
  const history = await historyForApply(db, profile.id);

  // Opt-in twice: the mailbox variables have to be set AND verification asked
  // for, because nothing should connect to a personal mailbox as a side effect
  // of filling in a form.
  const mailbox = options.verify ? inboxConfig() : null;
  if (options.verify && mailbox === null) {
    log(
      "Verification was asked for but no mailbox is configured. " +
        "Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD in .env (see .env.example).",
    );
  }
  const runStartedAt = new Date();

  const url = applicationUrlFor({
    atsType: job.atsType,
    atsIdentifier: job.company.atsIdentifier,
    sourceJobId: job.sourceJobId,
    canonicalUrl: job.canonicalUrl,
  });

  mkdirSync(SHOT_DIR, { recursive: true });
  const screenshotPath = resolve(SHOT_DIR, `${job.id}-${Date.now()}.png`);

  log(`\nShadow run — ${job.title} at ${job.company.name}`);
  log(url);
  log("Nothing will be submitted: every non-GET request is blocked while this runs.\n");

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
      work: history.work,
      education: history.education,
    },
    answers,
    documents,
    screenshotPath,
    keepOpen: options.keepOpen,
    handoff: options.handoff,
    onFilled: options.onFilled,
    browser: options.browser,

    // Only restore a session that exists — Playwright throws on a missing file.
    storageState:
      options.persistSession && existsSync(SESSION_STATE_PATH) ? SESSION_STATE_PATH : undefined,
    saveStateTo: options.persistSession ? SESSION_STATE_PATH : undefined,

    // Asking only makes sense when someone is watching the window. A run that
    // nobody is sitting in front of would stop at the first question and wait
    // forever.
    ask: options.ask ?? Boolean(options.handoff || options.keepOpen),

    verification: mailbox
      ? {
          config: mailbox,
          since: runStartedAt,
          fromDomain: senderDomainFor(url) ?? undefined,
          timeoutMs: 120_000,
        }
      : undefined,

    async onAnswer(question, answer) {
      // Store it for next time — unless it is an answer about this employer or
      // this particular posting, which would be wrong on the next form rather
      // than merely unhelpful.
      if (!worthStoring(question, job.company.name)) {
        log(`  (not saved: "${question.slice(0, 50)}" is specific to this application)`);
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
      log(`  saved for next time: "${question.slice(0, 50)}" -> "${answer.slice(0, 40)}"`);
    },
  });

  const filled = result.outcomes.filter(
    (o) => o.status === "filled" || o.status === "chosen" || o.status === "attached",
  );
  const skipped = result.outcomes.filter((o) => o.status === "skipped");
  const failed = result.outcomes.filter((o) => o.status === "failed");

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

  return {
    runId: run.id,
    result,
    jobTitle: job.title,
    companyName: job.company.name,
    url,
    screenshotPath,
  };
}

/** The run report, as the CLI prints it. */
export function reportRun(outcome: RunApplicationOutcome, log: (line: string) => void): void {
  const { result } = outcome;

  const filled = result.outcomes.filter(
    (o) => o.status === "filled" || o.status === "chosen" || o.status === "attached",
  );
  const skipped = result.outcomes.filter((o) => o.status === "skipped");
  const failed = result.outcomes.filter((o) => o.status === "failed");

  log("\nFilled:");
  for (const outcome_ of filled) {
    log(`  ${outcome_.label}: ${outcome_.detail}  [${outcome_.source}]`);
  }

  if (failed.length > 0) {
    log("\nCould not fill:");
    for (const outcome_ of failed) log(`  ${outcome_.label}: ${outcome_.detail}`);
  }

  log(`\nLeft for you (${skipped.length}):`);
  for (const outcome_ of skipped.slice(0, 12)) {
    log(`  ${outcome_.label}: ${outcome_.detail}`);
  }
  if (skipped.length > 12) log(`  ...and ${skipped.length - 12} more`);

  if (result.captcha) log("\nCAPTCHA present — this form cannot be automated past this point.");
  if (result.loginRequired) log("\nThis form is behind a login.");

  log(
    `\nGuard: ${result.blockedTrackers} third-party beacons blocked (normal — ATS pages are full of them).`,
  );
  if (result.blockedSubmissions.length > 0) {
    log("!! Blocked a request to the form's own host — something tried to submit:");
    for (const request of result.blockedSubmissions) log(`  ${request}`);
  } else {
    log("Guard: no submission attempt was made.");
  }
  if (result.allowedUploads.length > 0) {
    log(
      `Guard: ${result.allowedUploads.length} upload request(s) allowed while attaching a ` +
        "document (never to the form's own host, so none could be a submission):",
    );
    for (const request of result.allowedUploads) log(`  ${request}`);
  }

  log(`\nWould have applied: ${result.blockingGaps.length === 0 ? "YES" : "NO"}`);
  if (result.blockingGaps.length > 0) {
    log(`Required fields still empty: ${result.blockingGaps.join(", ")}`);
  }
  log(`\nScreenshot: ${outcome.screenshotPath}`);
  log("\nAll fields correct? Record it so adapter reliability can be measured:");
  log(`  npm run shadow:verdict -- ${outcome.runId} correct`);
  log(`  npm run shadow:verdict -- ${outcome.runId} wrong "what was wrong"`);
  log("\nNothing was submitted.");
}
