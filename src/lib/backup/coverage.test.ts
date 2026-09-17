/**
 * Tests for the backup coverage guard.
 *
 * This exists for one failure: a model gets added to prisma/schema.prisma,
 * nobody adds it to the export, and every backup taken from that day forward
 * is quietly missing a table. Nothing complains, because the export's summary
 * can only report the tables it knows about. The gap surfaces at restore time
 * — the one moment when the rows are already gone.
 *
 * That is not hypothetical. ShadowRun, CandidateDocument and SubmissionAttempt
 * sat outside the export for months; ShadowRun alone is the human-verified
 * evidence base the trust ladder reads before letting an adapter submit
 * anything, so restoring one of those backups would have reset every adapter
 * to untested with no sign that anything had been lost.
 *
 * The case that matters most is "a model nobody decided about": the schema
 * with one unfamiliar model in it must throw, and name it. The rest check the
 * declaration against the schema as it actually stands today, which is what
 * makes tomorrow's new model break this file instead of a restore.
 *
 * No database is touched. The guard compares two lists of names, and Prisma's
 * DMMF is metadata generated from the schema file — reading it opens no
 * connection.
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  BACKUP_TABLES,
  EXCLUDED_MODELS,
  assertExportCoverage,
  findCoverageGaps,
} from "./coverage";

/**
 * The schema as it really is. Scenarios below are edits to this rather than
 * two- or three-model inventions, because the interesting mistakes are all
 * "the real schema, plus/minus one thing" — and a hand-built stub would
 * report every unmentioned model as missing and drown the case under test.
 */
const REAL_SCHEMA: { name: string }[] = Prisma.dmmf.datamodel.models.map(
  (model) => ({ name: model.name }),
);

/** The schema after somebody adds a model and stops there. */
function schemaPlus(...added: string[]): { name: string }[] {
  return [...REAL_SCHEMA, ...added.map((name) => ({ name }))];
}

/** The schema after somebody renames a model. */
function schemaRenaming(from: string, to: string): { name: string }[] {
  return REAL_SCHEMA.map((model) => ({
    name: model.name === from ? to : model.name,
  }));
}

/** Everything collect() is declared to return, i.e. a complete export. */
const ALL_TABLES = Object.keys(BACKUP_TABLES);

describe("the declaration against the real schema", () => {
  it("accounts for every model in prisma/schema.prisma", () => {
    // collect() cannot be called here — it needs a database — so this checks
    // the declaration against the schema. The export script runs the same
    // check against what collect() actually returned, at export time.
    const gaps = findCoverageGaps({
      schemaModels: REAL_SCHEMA,
      collectedKeys: ALL_TABLES,
    });

    // Failing here means a model was added and nobody decided what backups
    // should do with it. Export it, or exclude it with a reason.
    expect(gaps.unexported).toEqual([]);
    expect(gaps.stale).toEqual([]);
  });

  it("backs up the three tables that used to be missing", () => {
    // Pinned by name, not by count: a future model arriving is fine, one of
    // these three leaving is the regression this file was written for.
    const exported = Object.values(BACKUP_TABLES);
    expect(exported).toContain("ShadowRun");
    expect(exported).toContain("CandidateDocument");
    expect(exported).toContain("SubmissionAttempt");
  });

  it("leaves ResumeImport out without that counting as a gap", () => {
    // The one omission that is supposed to be there. It has to be invisible
    // to the guard for the right reason — a written-down exclusion — and not
    // because the guard happens not to look at it.
    expect(REAL_SCHEMA.map((model) => model.name)).toContain("ResumeImport");
    expect(Object.values(BACKUP_TABLES)).not.toContain("ResumeImport");
    expect(EXCLUDED_MODELS.ResumeImport).toBeDefined();
  });

  it("states a reason for every deliberate omission", () => {
    // An exclusion with no reason is indistinguishable from an oversight,
    // which is exactly what this mechanism exists to tell apart.
    for (const [model, reason] of Object.entries(EXCLUDED_MODELS)) {
      expect(reason.length, `${model} has no stated reason`).toBeGreaterThan(20);
    }
  });
});

describe("assertExportCoverage", () => {
  it("passes on a complete export of the current schema", () => {
    expect(() =>
      assertExportCoverage({
        schemaModels: REAL_SCHEMA,
        collectedKeys: ALL_TABLES,
      }),
    ).not.toThrow();
  });

  it("throws and names a model that is neither exported nor excluded", () => {
    // The whole point: a model nobody has made a decision about stops the
    // export instead of vanishing from it.
    expect(() =>
      assertExportCoverage({
        schemaModels: schemaPlus("InterviewFeedback"),
        collectedKeys: ALL_TABLES,
      }),
    ).toThrow(/InterviewFeedback/);
  });

  it("refuses to write a file, rather than warning about one", () => {
    let message = "";
    try {
      assertExportCoverage({
        schemaModels: schemaPlus("InterviewFeedback"),
        collectedKeys: ALL_TABLES,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // A warning printed under a successful-looking backup gets read once and
    // forgotten, so the message has to say nothing was written, and say what
    // the two ways out are.
    expect(message).toContain("nothing was written");
    expect(message).toContain("EXCLUDED_MODELS");
  });

  it("flags a declared table that the export did not produce", () => {
    // The mirror-image mistake: the table is declared here but the line that
    // reads it never made it into collect(), so the file omits the field
    // entirely and the summary just prints one fewer number.
    const gaps = findCoverageGaps({
      schemaModels: REAL_SCHEMA,
      collectedKeys: ALL_TABLES.filter((field) => field !== "shadowRuns"),
    });

    expect(gaps.uncollected).toEqual(["shadowRuns"]);
  });

  it("flags a declared name the schema no longer has", () => {
    // A rename is the sneaky version: the old name still looks handled, and
    // the new one reads as a model nobody decided about. Both must show.
    const gaps = findCoverageGaps({
      schemaModels: schemaRenaming("ShadowRun", "ShadowApplicationRun"),
      collectedKeys: ALL_TABLES,
    });

    expect(gaps.stale).toEqual(["ShadowRun"]);
    expect(gaps.unexported).toHaveLength(1);
    expect(gaps.unexported[0]!).toBe("ShadowApplicationRun");
  });
});
