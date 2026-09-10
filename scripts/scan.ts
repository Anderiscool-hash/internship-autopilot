/**
 * The continuous scanner (spec §5: "The scraper should run 24/7").
 *
 * Start it with `npm run scan` and leave it running. Every cycle it asks the
 * database which company boards are due, scans those, and goes back to sleep.
 * Nothing is scheduled in memory — the next-due time lives on each company row
 * — so killing this process and starting it again tomorrow resumes exactly
 * where it left off, with no missed work and no duplicate scans.
 *
 * Options, all via environment variables:
 *
 *   SCAN_CYCLE_SECONDS   how long to sleep between cycles (default 60)
 *   SCAN_LIMIT           most companies to scan in one cycle (default 25)
 *   ALERT_WEBHOOK_URL    where to post alerts (optional; Discord-compatible)
 *
 * Pass `--once` to run a single cycle and exit, which is what you want when
 * checking a change rather than actually monitoring boards.
 */

import { db } from "../src/lib/db";
import { channelsFromEnv } from "../src/lib/alerts/channels";
import { dispatchAlerts } from "../src/lib/alerts/dispatch";
import { runScanCycle, type ScanOutcome } from "../src/lib/scan/scanner";

const CYCLE_SECONDS = Number(process.env.SCAN_CYCLE_SECONDS ?? 60);
const LIMIT = Number(process.env.SCAN_LIMIT ?? 25);
const RUN_ONCE = process.argv.includes("--once");

/** Set by SIGINT/SIGTERM so the loop finishes its cycle before exiting. */
let stopping = false;

/** Timestamped log line, so a long-running process leaves a readable trail. */
function log(message: string): void {
  console.log(`${new Date().toISOString()}  ${message}`);
}

/**
 * Report a company's scan, but only when it is worth reading.
 *
 * A scanner running for days produces one line per company per cycle if you
 * let it. Boards that returned exactly what they returned last time are the
 * overwhelming majority and say nothing, so they stay quiet — new jobs,
 * removed jobs and failures are what actually deserve a line.
 */
function reportOutcome(outcome: ScanOutcome): void {
  if (!outcome.ok) {
    log(`  ✗ ${outcome.companyName}: ${outcome.error} (retry in ${outcome.nextInterval}m)`);
    return;
  }
  if (outcome.created > 0 || outcome.closed > 0) {
    const parts = [`${outcome.fetched} listed`];
    if (outcome.created > 0) parts.push(`${outcome.created} NEW`);
    if (outcome.closed > 0) parts.push(`${outcome.closed} closed`);
    log(`  • ${outcome.companyName}: ${parts.join(", ")} (next in ${outcome.nextInterval}m)`);
  }
}

/**
 * Sleep between cycles, waking early if a shutdown signal arrives.
 *
 * Polling a deadline every quarter-second rather than one long timer is what
 * makes Ctrl-C feel instant instead of hanging for up to a full cycle.
 */
function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + seconds * 1000;
    const tick = setInterval(() => {
      if (stopping || Date.now() >= deadline) {
        clearInterval(tick);
        resolve();
      }
    }, 250);
  });
}

async function main(): Promise<void> {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) process.exit(1); // second Ctrl-C: give up waiting
      stopping = true;
      log("shutdown requested — finishing the current cycle");
    });
  }

  const channels = channelsFromEnv();

  log(
    RUN_ONCE
      ? `scanning once (limit ${LIMIT})`
      : `scanner started — cycle every ${CYCLE_SECONDS}s, up to ${LIMIT} boards per cycle`,
  );
  log(
    channels.length > 1
      ? `alerts: console + webhook`
      : `alerts: console only (set ALERT_WEBHOOK_URL to add a webhook)`,
  );

  do {
    const summary = await runScanCycle(db, new Date(), {
      limit: LIMIT,
      onOutcome: reportOutcome,
    });

    if (summary.scanned > 0) {
      log(
        `cycle: ${summary.scanned} boards, ${summary.fetched} jobs listed, ` +
          `${summary.created} new, ${summary.updated} refreshed, ` +
          `${summary.closed} closed, ${summary.failed} failed`,
      );
    }

    // Alerts go out after the whole cycle rather than per board, so one
    // message covers everything found this minute (spec §28).
    if (summary.createdJobIds.length > 0) {
      const alerts = await dispatchAlerts(
        db,
        summary.createdJobIds,
        new Date(),
        channels,
      );
      if (alerts.alerted > 0) {
        log(`alerted on ${alerts.alerted} new student-role postings`);
      }
      for (const failure of alerts.failures) {
        log(`  ✗ alert channel failed: ${failure}`);
      }
    }

    if (RUN_ONCE || stopping) break;
    await sleep(CYCLE_SECONDS);
  } while (!stopping);

  log("scanner stopped");
}

main()
  .catch((error) => {
    console.error("Scanner crashed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
