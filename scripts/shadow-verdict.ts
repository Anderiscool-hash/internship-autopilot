/**
 * Record whether a shadow run filled the form correctly (spec §20).
 *
 * This is the measurement spec §21 needs before an adapter is trusted with
 * anything more: an adapter is promoted on evidence of real runs, not on the
 * fact that the code looks right.
 *
 * Run it with:  npm run shadow:verdict -- <runId> correct
 *               npm run shadow:verdict -- <runId> wrong "the phone went in the zip field"
 */

import { db } from "../src/lib/db";

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

  await db.shadowRun.update({
    where: { id: runId },
    data: { verdict, verdictNote: note.join(" ") || null, verifiedAt: new Date() },
  });

  // Per-ATS reliability, which is the number spec §21 promotes on.
  const runs = await db.shadowRun.findMany({
    where: { atsType: run.atsType, verdict: { not: null } },
    select: { verdict: true },
  });
  const correct = runs.filter((item) => item.verdict === "correct").length;

  console.log(`Recorded: ${verdict}`);
  console.log(
    `${run.atsType}: ${correct} of ${runs.length} verified runs filled correctly.`,
  );
  if (runs.length < 5) {
    console.log(
      "Too few runs to mean much yet — spec §21 promotes adapters on evidence, not on a couple of good ones.",
    );
  }
}

main()
  .catch((error) => {
    console.error("Failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
