/**
 * Fill in `Job.requirements` for postings stored before extraction existed —
 * or before the extractor last improved.
 *
 * The scanner extracts on every sighting from now on, but a board is only
 * re-scanned on its own schedule, so without this a job discovered last week
 * would carry no requirements until its board next changes. Worse, after the
 * extractor is improved, every stored row is silently out of date.
 *
 * Run it with:  npm run extract:backfill
 *               npm run extract:backfill -- --all   (re-extract everything)
 *
 * Without --all it only touches rows that have never been extracted.
 */

import type { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { extractRequirements } from "../src/lib/eligibility/extract";

/** Rows per database round trip. */
const BATCH = 200;

async function main(): Promise<void> {
  const all = process.argv.includes("--all");

  const jobs = await db.job.findMany({
    where: all ? {} : { requirementsExtractedAt: null },
    select: { id: true, description: true },
  });

  console.log(
    `${jobs.length} postings to extract${all ? " (re-extracting everything)" : ""}.`,
  );
  if (jobs.length === 0) return;

  const now = new Date();
  let done = 0;

  for (let index = 0; index < jobs.length; index += BATCH) {
    const batch = jobs.slice(index, index + BATCH);

    // One transaction per batch rather than one per row: 2,800 separate
    // round trips is slow enough to be annoying, and a batch that fails
    // should not leave half its rows updated.
    await db.$transaction(
      batch.map((job) =>
        db.job.update({
          where: { id: job.id },
          data: {
            // JobRequirements is a fixed-shape interface; Prisma's JSON input
            // type wants an index signature. The values really are plain JSON.
            requirements: extractRequirements(
              job.description,
            ) as unknown as Prisma.InputJsonValue,
            requirementsExtractedAt: now,
          },
        }),
      ),
    );

    done += batch.length;
    console.log(`  ${done}/${jobs.length}`);
  }

  console.log("done.");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
