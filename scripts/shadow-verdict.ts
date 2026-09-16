/**
 * Record whether a shadow run filled the form correctly (spec §20).
 *
 * This is the measurement spec §21 needs before an adapter is trusted with
 * anything more: an adapter is promoted on evidence of real runs, not on the
 * fact that the code looks right.
 *
 * There is now a UI for this at /shadow-runs, which is the better tool for
 * working through a backlog because it shows the screenshot next to the fields.
 * This script stays for the cases a page is bad at — scripting, a run id copied
 * out of a log, correcting one verdict without loading the queue.
 *
 * Both paths write through recordVerdict in src/lib/shadow/verdicts.ts rather
 * than touching the columns directly. Two writers for the same three columns is
 * how "verified" and "verifiedAt" quietly stop agreeing.
 *
 * Run it with:  npm run shadow:verdict -- <runId> correct
 *               npm run shadow:verdict -- <runId> wrong "the phone went in the zip field"
 */

import { db } from "../src/lib/db";
import { atsStandings, recordVerdict } from "../src/lib/shadow/verdicts";

async function main(): Promise<void> {
  const [runId, verdict, ...note] = process.argv.slice(2);

  if (!runId || (verdict !== "correct" && verdict !== "wrong")) {
    console.error('Usage: npm run shadow:verdict -- <runId> correct|wrong ["note"]');
    process.exitCode = 1;
    return;
  }

  const run = await db.shadowRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.error(`No shadow run with id ${runId}.`);
    process.exitCode = 1;
    return;
  }

  await recordVerdict(db, runId, verdict, note.join(" ") || null);

  // Per-ATS reliability, which is the number spec §21 promotes on.
  const standings = await atsStandings(db);
  const standing = standings.find((entry) => entry.atsType === run.atsType);

  console.log(`Recorded: ${verdict}`);
  if (standing) {
    console.log(
      `${run.atsType}: ${standing.correct} of ${standing.verified} verified runs filled correctly ` +
        `(trust level ${standing.level}).`,
    );
    if (standing.verified < 5) {
      console.log(
        "Too few runs to mean much yet — spec §21 promotes adapters on evidence, not on a couple of good ones.",
      );
    }
  }
}

main()
  .catch((error) => {
    console.error("Failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
