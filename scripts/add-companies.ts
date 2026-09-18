/**
 * Bulk-add company boards to the registry, one live check at a time.
 *
 * The scanner can only find jobs at companies it knows about, so the size of
 * the company registry (spec §4) is the ceiling on everything downstream. This
 * script raises that ceiling without lowering the bar: it takes a list of
 * *guessed* board slugs (scripts/company-candidates.ts), asks each platform
 * whether that board is real, and only then offers to write anything.
 *
 * ---------------------------------------------------------------------------
 * READ THE SAMPLE TITLES. A PASS IS NOT PROOF.
 * ---------------------------------------------------------------------------
 * Verification answers one question only: "does this slug return jobs?" It
 * cannot answer "are they THIS company's jobs?" A slug that happens to belong
 * to a different real company returns that company's postings and passes
 * cleanly — and if committed, its jobs land in the database under the wrong
 * employer name, quietly corrupting the registry.
 *
 * The only defense is a human reading the sample titles printed next to every
 * PASS and asking whether they sound like the company on that row. If the row
 * says "Cruise" and the titles are about insurance claims, that slug belongs
 * to someone else. Delete it from the candidate list before committing.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   npx tsx scripts/add-companies.ts             # dry run — writes nothing
 *   npx tsx scripts/add-companies.ts --commit    # insert the rows that passed
 *
 * Dry run is the default on purpose: this hits real third-party APIs and then
 * proposes real database rows, and both deserve a look before they happen.
 * Requests are issued sequentially with a short pause between them so that a
 * hundred-candidate run reads as a trickle rather than a flood.
 */

import { AtsType as DbAtsType } from "@prisma/client";
import { db } from "../src/lib/db";
import { verifyBoard } from "../src/lib/companies/verify";
import type { AtsType } from "../src/lib/jobs/types";
import {
  COMPANY_CANDIDATES,
  type CompanyCandidate,
} from "./company-candidates";

/** Milliseconds to wait between two ATS requests. Politeness, not performance. */
const REQUEST_DELAY_MS = 400;

/**
 * Only these three have a working client (src/lib/ats/index.ts). Anything else
 * would fail verification anyway, but failing here says why more clearly.
 */
const SUPPORTED: readonly AtsType[] = ["greenhouse", "lever", "ashby"];

/** Code-side ATS name -> the enum value Prisma stores. */
const ATS_TO_DB: Record<string, DbAtsType> = {
  greenhouse: DbAtsType.GREENHOUSE,
  lever: DbAtsType.LEVER,
  ashby: DbAtsType.ASHBY,
};

/** Where a human goes to look at this board with their own eyes. */
function careersUrlFor(atsType: AtsType, identifier: string): string | null {
  switch (atsType) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${identifier}`;
    case "lever":
      return `https://jobs.lever.co/${identifier}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${identifier}`;
    default:
      return null;
  }
}

/** What happened to one candidate. */
type Outcome =
  | { kind: "pass"; jobCount: number; sampleTitles: string[] }
  | { kind: "fail"; reason: string }
  | { kind: "duplicate"; reason: string };

interface Row {
  candidate: CompanyCandidate;
  outcome: Outcome;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pad/trim a cell so the table columns line up in a terminal. */
function cell(value: string, width: number): string {
  if (value.length > width) return `${value.slice(0, width - 1)}…`;
  return value.padEnd(width, " ");
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");

  // Pull the whole existing registry once. It is small (tens of rows), and
  // holding it in memory means duplicate checks cost nothing per candidate.
  const existing = await db.company.findMany({
    select: { name: true, domain: true, atsType: true, atsIdentifier: true },
  });

  // Board identity is (platform, slug) — the same slug on two platforms is two
  // different boards, so the key has to include both.
  const existingBoards = new Set(
    existing
      .filter((c) => c.atsType !== null && c.atsIdentifier !== null)
      .map((c) => `${c.atsType}:${c.atsIdentifier!.toLowerCase()}`),
  );
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
  const existingDomains = new Set(
    existing
      .filter((c) => c.domain !== null)
      .map((c) => c.domain!.toLowerCase()),
  );

  // Candidates can collide with each other too, not just with the database
  // (two rows proposing the same board, or the same name twice).
  const seenBoards = new Set<string>();
  const seenNames = new Set<string>();

  console.log(
    `Checking ${COMPANY_CANDIDATES.length} candidate boards against the live ` +
      `ATS APIs, one at a time (${REQUEST_DELAY_MS}ms apart).`,
  );
  console.log(
    commit
      ? "Mode: COMMIT — verified, non-duplicate candidates will be inserted.\n"
      : "Mode: DRY RUN — nothing will be written. Pass --commit to insert.\n",
  );

  const rows: Row[] = [];

  for (const candidate of COMPANY_CANDIDATES) {
    const boardKey = `${ATS_TO_DB[candidate.atsType] ?? candidate.atsType}:${candidate.identifier.toLowerCase()}`;
    const nameKey = candidate.name.toLowerCase();
    const domainKey = candidate.domain?.toLowerCase();

    // --- Duplicate checks first. No point spending a request on a row we
    // --- already have, and it keeps the request count honest.
    if (!SUPPORTED.includes(candidate.atsType)) {
      rows.push({
        candidate,
        outcome: {
          kind: "fail",
          reason: `ATS "${candidate.atsType}" has no client yet — cannot verify.`,
        },
      });
      continue;
    }
    if (existingBoards.has(boardKey)) {
      rows.push({
        candidate,
        outcome: { kind: "duplicate", reason: "board already in the registry" },
      });
      continue;
    }
    if (existingNames.has(nameKey)) {
      rows.push({
        candidate,
        outcome: { kind: "duplicate", reason: "a company with this name exists" },
      });
      continue;
    }
    if (domainKey !== undefined && existingDomains.has(domainKey)) {
      rows.push({
        candidate,
        outcome: { kind: "duplicate", reason: "a company with this domain exists" },
      });
      continue;
    }
    if (seenBoards.has(boardKey)) {
      rows.push({
        candidate,
        outcome: { kind: "duplicate", reason: "listed twice in the candidate file" },
      });
      continue;
    }
    if (seenNames.has(nameKey)) {
      rows.push({
        candidate,
        outcome: { kind: "duplicate", reason: "name listed twice in the candidate file" },
      });
      continue;
    }
    seenBoards.add(boardKey);
    seenNames.add(nameKey);

    // --- Live check. One candidate failing (network blip, DNS, a 500 from the
    // --- platform) must never take the rest of the run down with it, so every
    // --- error is caught and recorded against this row alone.
    let outcome: Outcome;
    try {
      const result = await verifyBoard(
        candidate.atsType,
        candidate.identifier,
        candidate.name,
      );
      outcome = result.ok
        ? {
            kind: "pass",
            jobCount: result.jobCount,
            sampleTitles: result.sampleTitles,
          }
        : { kind: "fail", reason: result.reason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = { kind: "fail", reason: `unexpected error: ${message}` };
    }

    rows.push({ candidate, outcome });

    const mark =
      outcome.kind === "pass" ? `PASS (${outcome.jobCount})` : "FAIL";
    console.log(`  [${rows.length}/${COMPANY_CANDIDATES.length}] ${candidate.name} — ${mark}`);

    await sleep(REQUEST_DELAY_MS);
  }

  // -------------------------------------------------------------------------
  // The table. Sample titles get their own full-width line under each pass,
  // because they are the part a human actually has to read — squeezing them
  // into a truncated column would defeat the whole point of printing them.
  // -------------------------------------------------------------------------
  console.log("\n" + "=".repeat(100));
  console.log("RESULTS");
  console.log("=".repeat(100));
  console.log(
    `${cell("COMPANY", 28)} ${cell("ATS", 11)} ${cell("SLUG", 22)} ${cell("RESULT", 12)} JOBS`,
  );
  console.log("-".repeat(100));

  for (const { candidate, outcome } of rows) {
    const label =
      outcome.kind === "pass"
        ? "PASS"
        : outcome.kind === "duplicate"
          ? "DUPLICATE"
          : "FAIL";
    const jobs = outcome.kind === "pass" ? String(outcome.jobCount) : "-";

    console.log(
      `${cell(candidate.name, 28)} ${cell(candidate.atsType, 11)} ` +
        `${cell(candidate.identifier, 22)} ${cell(label, 12)} ${jobs}`,
    );

    if (outcome.kind === "pass") {
      for (const title of outcome.sampleTitles) {
        console.log(`      · ${title}`);
      }
    } else {
      console.log(`      → ${outcome.reason}`);
    }
  }

  const passes = rows.filter((r) => r.outcome.kind === "pass");
  const failures = rows.filter((r) => r.outcome.kind === "fail");
  const duplicates = rows.filter((r) => r.outcome.kind === "duplicate");

  // -------------------------------------------------------------------------
  // Writing, only when explicitly asked.
  // -------------------------------------------------------------------------
  let inserted = 0;
  if (commit) {
    for (const { candidate } of passes) {
      const dbAts = ATS_TO_DB[candidate.atsType];
      if (!dbAts) continue; // unreachable: unsupported types never reach "pass"

      await db.company.create({
        data: {
          name: candidate.name,
          domain: candidate.domain ?? null,
          careersUrl: careersUrlFor(candidate.atsType, candidate.identifier),
          atsType: dbAts,
          atsIdentifier: candidate.identifier,
          // scanPriority (50), pollInterval (30), failureCount (0) and
          // active (true) are left at the schema defaults, which is exactly
          // what the seeded companies use.
          active: true,
        },
      });
      inserted += 1;
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  console.log(`  verified (PASS): ${passes.length}`);
  console.log(`  failed:          ${failures.length}`);
  console.log(`  duplicates:      ${duplicates.length}`);
  console.log(
    commit
      ? `  inserted:        ${inserted}`
      : "  inserted:        dry run — nothing written (re-run with --commit)",
  );
  console.log(
    "\nBefore committing: read the sample titles above. Verification proves a " +
      "board exists,\nnot that it belongs to the company named on the row.",
  );
}

main()
  .catch((error) => {
    console.error("add-companies failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
