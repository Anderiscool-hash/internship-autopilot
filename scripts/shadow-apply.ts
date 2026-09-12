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
 *               npm run shadow -- <jobId> --verify     (read the emailed code)
 *
 * Add --no-daemon to launch a browser for this run instead of borrowing the
 * warm one from `npm run daemon`.
 *
 * Afterwards it prints what it filled, what it could not, and where the
 * screenshot is. Record whether the fields were right with:
 *   npm run shadow:verdict -- <runId> correct
 *   npm run shadow:verdict -- <runId> wrong "what was wrong"
 *
 * The sequence itself lives in src/lib/apply/run-application.ts, because the
 * daemon runs exactly the same one.
 */

import { db } from "../src/lib/db";
import {
  ApplicationRunError,
  reportRun,
  runApplication,
} from "../src/lib/apply/run-application";
import { daemonStatus, submitToDaemon } from "../src/lib/apply/daemon-client";

async function main(): Promise<void> {
  const jobId = process.argv[2];
  const keepOpen = process.argv.includes("--keep-open");
  const handoff = process.argv.includes("--handoff");
  const verify = process.argv.includes("--verify");
  const noDaemon = process.argv.includes("--no-daemon");
  const ask = handoff || keepOpen || process.argv.includes("--ask");

  if (!jobId) {
    console.error(
      "Usage: npm run shadow -- <jobId> [--keep-open] [--handoff] [--ask] [--verify] [--no-daemon]",
    );
    process.exitCode = 1;
    return;
  }

  // Hand it to the daemon when one is up: it already has a browser warm and a
  // database connection open, which is most of this process's startup cost.
  // The run happens in a visible window either way.
  if (!noDaemon) {
    const status = await daemonStatus();
    if (status) {
      console.log(`Handing this to the running daemon (pid ${status.pid}).`);
      const accepted = await submitToDaemon({ jobId, keepOpen, handoff, verify, ask });
      if (accepted) {
        console.log(
          "Accepted. The window opens shortly; the daemon's terminal carries the report.",
        );
        return;
      }
      console.log("The daemon refused it — running here instead.");
    }
  }

  const outcome = await runApplication(db, {
    jobId,
    keepOpen,
    handoff,
    verify,
    ask,
    persistSession: true,
  });

  reportRun(outcome, (line) => console.log(line));
}

main()
  .catch((error) => {
    if (error instanceof ApplicationRunError) {
      console.error(error.message);
    } else {
      console.error("Shadow run failed:", error);
    }
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
