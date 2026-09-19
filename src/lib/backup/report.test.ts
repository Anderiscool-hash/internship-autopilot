/**
 * Tests for the import summary.
 *
 * The old script printed "jobs  0 written, 2800 already there" and that line
 * was the problem. It reads as "everything is present and correct" and it
 * actually means "I compared nothing" — the 2,800 were counted by catching a
 * unique-constraint error, not by looking at a single column. A migration
 * summary that overstates itself is worse than no summary, because it is the
 * thing you check before shutting down the old machine.
 *
 * So these tests are mostly about wording and arithmetic: the four buckets add
 * up, "unchanged" is a claim the planner actually verified, and a row that
 * could not be written is named rather than absorbed into a total.
 */

import { describe, it, expect } from "vitest";
import {
  formatOutcomes,
  headline,
  isFullyAccountedFor,
  outcomeFromPlan,
  totals,
  type TableOutcome,
} from "./report";
import { planTable, type TableShape } from "./rows";

const SHAPE: TableShape = {
  table: "widgets",
  model: "Widget",
  idField: "id",
  scalarFields: ["id", "name"],
  dateFields: [],
  uniqueKeys: [],
};

/** Build an outcome without spelling out every field each time. */
function outcome(overrides: Partial<TableOutcome> = {}): TableOutcome {
  return {
    table: "widgets",
    model: "Widget",
    inFile: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    droppedColumns: [],
    changedFieldSamples: [],
    ...overrides,
  };
}

describe("outcomeFromPlan", () => {
  it("carries the planner's four buckets across unchanged", () => {
    const plan = planTable({
      shape: SHAPE,
      existingRows: [{ id: "a", name: "A" }],
      incomingRows: [
        { id: "a", name: "A" }, // unchanged
        { id: "b", name: "B" }, // create
        { name: "no id" }, // blocked
      ],
    });

    const result = outcomeFromPlan(plan);
    expect(result.inFile).toBe(3);
    expect(result.created).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(isFullyAccountedFor(result)).toBe(true);
  });

  it("gives every skipped row a reason", () => {
    // A skipped row with no explanation is the same dead end as a silent
    // drop: you know something is missing and not what or why.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [],
      incomingRows: [{ name: "no id" }],
    });

    for (const row of outcomeFromPlan(plan).skipped) {
      expect(row.reason.length).toBeGreaterThan(10);
    }
  });

  it("collects the names of columns an update would touch", () => {
    const plan = planTable({
      shape: SHAPE,
      existingRows: [{ id: "a", name: "A" }],
      incomingRows: [{ id: "a", name: "Renamed" }],
    });

    expect(outcomeFromPlan(plan).changedFieldSamples).toEqual(["name"]);
  });
});

describe("isFullyAccountedFor", () => {
  it("catches numbers that do not add up to the file", () => {
    // If this ever fires for real, a row went through the import uncounted.
    expect(
      isFullyAccountedFor(outcome({ inFile: 10, created: 4, unchanged: 5 })),
    ).toBe(false);
  });
});

describe("formatOutcomes", () => {
  it("says plainly that a dry run wrote nothing", () => {
    const text = formatOutcomes([outcome({ inFile: 3, created: 3 })], {
      dryRun: true,
    });

    expect(text).toContain("DRY RUN");
    expect(text).toContain("nothing below was written");
  });

  it("never says 'imported' about a row it skipped", () => {
    // The precise wording failure of the old script: skipped rows counted
    // under a heading that implied they were fine.
    const text = formatOutcomes(
      [
        outcome({
          inFile: 2,
          created: 1,
          skipped: [{ id: "w2", reason: "its company is not in this database" }],
        }),
      ],
      { dryRun: false },
    );

    expect(text).toContain("NOT imported");
    expect(text).toContain("w2");
    expect(text).toContain("its company is not in this database");
  });

  it("names skipped rows individually rather than just counting them", () => {
    const skipped = [
      { id: "one", reason: "reason one" },
      { id: "two", reason: "reason two" },
    ];
    const text = formatOutcomes(
      [outcome({ inFile: 2, skipped })],
      { dryRun: false },
    );

    expect(text).toContain("one");
    expect(text).toContain("two");
  });

  it("caps a huge skip list but says how many it held back", () => {
    // Twenty names is enough to see the pattern; the count keeps the claim
    // honest, and --verbose exists for the rest.
    const skipped = Array.from({ length: 50 }, (_, index) => ({
      id: `row-${index}`,
      reason: "blocked",
    }));
    const text = formatOutcomes([outcome({ inFile: 50, skipped })], {
      dryRun: false,
    });

    expect(text).toContain("...and 30 more");
    expect(text).not.toContain("row-49");

    const full = formatOutcomes([outcome({ inFile: 50, skipped })], {
      dryRun: false,
      verbose: true,
    });
    expect(full).toContain("row-49");
  });

  it("explains what a large 'unchanged' number means", () => {
    // On a healthy re-import this is the biggest number on the page, and it
    // must not read as a failure or as a row that was skipped.
    const text = formatOutcomes([outcome({ inFile: 2800, unchanged: 2800 })], {
      dryRun: false,
    });

    expect(text).toContain("already matched the backup exactly");
  });

  it("reports columns dropped because the schema no longer has them", () => {
    const text = formatOutcomes(
      [outcome({ inFile: 1, created: 1, droppedColumns: ["oldColumn"] })],
      { dryRun: false },
    );

    expect(text).toContain("oldColumn");
    expect(text).toContain("left behind");
  });
});

describe("totals and headline", () => {
  it("adds the tables up", () => {
    const sum = totals([
      outcome({ inFile: 3, created: 3 }),
      outcome({ table: "jobs", inFile: 5, updated: 2, unchanged: 3 }),
    ]);

    expect(sum).toEqual({
      inFile: 8,
      created: 3,
      updated: 2,
      unchanged: 3,
      skipped: 0,
    });
  });

  it("leads with the failure when rows could not be imported", () => {
    const line = headline(
      [outcome({ inFile: 1, skipped: [{ id: "x", reason: "no" }] })],
      { dryRun: false },
    );

    expect(line).toContain("NOT imported");
    expect(line).toContain("incomplete");
  });

  it("says nothing needed doing when nothing did", () => {
    // The expected result of a dry run straight after an export: proof the
    // planner compared the rows and found them equal, not proof it skipped.
    const line = headline([outcome({ inFile: 2800, unchanged: 2800 })], {
      dryRun: true,
    });

    expect(line).toContain("already matches the backup exactly");
  });

  it("tells you how to apply a dry run", () => {
    const line = headline([outcome({ inFile: 5, created: 5 })], {
      dryRun: true,
    });

    expect(line).toContain("Would create 5");
    expect(line).toContain("--dry-run");
  });
});
