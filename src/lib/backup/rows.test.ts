/**
 * Tests for the import planner.
 *
 * The bug this file is the guard against: the old import script inserted rows
 * and treated "that id already exists" as success. A second import — the
 * catch-up run you do after the old machine kept working for another day —
 * therefore wrote nothing at all while printing a summary that read as though
 * it had worked. The new server kept stale rows, silently, forever.
 *
 * So the case that matters most here is not "a new row gets created". It is
 * "a row that already exists but has CHANGED is reported as an update and
 * carries the new values". Everything else in this file exists to make sure
 * that distinction survives the JSON round trip, where dates become strings
 * and Json columns come back with their keys in a different order.
 *
 * No database is touched: rows go in as plain objects and decisions come out.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalize,
  differingFields,
  planTable,
  reviveDates,
  type TableShape,
} from "./rows";

/** A small stand-in for a real table: an id, a name, a date, a unique code. */
const SHAPE: TableShape = {
  table: "widgets",
  model: "Widget",
  idField: "id",
  scalarFields: ["id", "name", "updatedAt", "code", "tags", "payload"],
  dateFields: ["updatedAt"],
  uniqueKeys: [["code"]],
};

/** One row as the database hands it back — real Date objects. */
function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    name: "Widget One",
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
    code: "AAA",
    tags: ["a", "b"],
    payload: { alpha: 1, beta: 2 },
    ...overrides,
  };
}

/** The same row as it appears in a backup file — dates are strings. */
function fromFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    name: "Widget One",
    updatedAt: "2026-03-01T10:00:00.000Z",
    code: "AAA",
    tags: ["a", "b"],
    payload: { alpha: 1, beta: 2 },
    ...overrides,
  };
}

describe("reviveDates", () => {
  it("turns date strings back into Date objects", () => {
    // Without this, every comparison against the database says "different",
    // every row looks like it needs updating, and the import churns forever.
    const revived = reviveDates(fromFile(), SHAPE.dateFields);
    expect(revived.updatedAt).toBeInstanceOf(Date);
    expect((revived.updatedAt as Date).toISOString()).toBe(
      "2026-03-01T10:00:00.000Z",
    );
  });

  it("leaves non-date columns alone even when they look like dates", () => {
    // `name` is not in dateFields, so a value that happens to parse as a date
    // must stay a string. Guessing by column name is what the old regex did.
    const revived = reviveDates(
      fromFile({ name: "2026-03-01" }),
      SHAPE.dateFields,
    );
    expect(revived.name).toBe("2026-03-01");
  });

  it("handles a list of dates", () => {
    const revived = reviveDates(
      { interviewDates: ["2026-04-01T09:00:00.000Z"] },
      ["interviewDates"],
    );
    const list = revived.interviewDates as unknown[];
    expect(list[0]).toBeInstanceOf(Date);
  });

  it("keeps an unparseable value rather than storing Invalid Date", () => {
    // Invalid Date fails much later with a message that doesn't contain the
    // offending value; the original string at least names itself.
    const revived = reviveDates({ updatedAt: "not a date" }, ["updatedAt"]);
    expect(revived.updatedAt).toBe("not a date");
  });

  it("passes nulls straight through", () => {
    const revived = reviveDates({ updatedAt: null }, ["updatedAt"]);
    expect(revived.updatedAt).toBeNull();
  });
});

describe("canonicalize", () => {
  it("treats a Date and its ISO string as the same value", () => {
    expect(canonicalize(new Date("2026-03-01T10:00:00.000Z"))).toBe(
      canonicalize(new Date("2026-03-01T10:00:00.000Z")),
    );
  });

  it("ignores Json key order", () => {
    // Postgres is free to give a jsonb column back with its keys reordered.
    // Without this, a Json column would report as changed on every import.
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("does not ignore array order", () => {
    // String[] columns are ordered in Postgres, so a reorder is a real change.
    expect(canonicalize(["a", "b"])).not.toBe(canonicalize(["b", "a"]));
  });

  it("treats null and undefined as the same absence", () => {
    expect(canonicalize(null)).toBe(canonicalize(undefined));
  });

  it("does not confuse the number 1 with the string \"1\"", () => {
    expect(canonicalize(1)).not.toBe(canonicalize("1"));
  });
});

describe("differingFields", () => {
  it("finds nothing when the file matches the database", () => {
    expect(
      differingFields(
        stored(),
        reviveDates(fromFile(), SHAPE.dateFields),
        SHAPE.scalarFields,
      ),
    ).toEqual([]);
  });

  it("names the columns that differ", () => {
    const incoming = reviveDates(
      fromFile({ name: "Widget Renamed", updatedAt: "2026-03-02T10:00:00.000Z" }),
      SHAPE.dateFields,
    );
    expect(differingFields(stored(), incoming, SHAPE.scalarFields)).toEqual([
      "name",
      "updatedAt",
    ]);
  });

  it("ignores columns the file does not mention", () => {
    // An older backup taken before a column existed must not blank it out on
    // the target. Absent means "no opinion", not "set it to null".
    const partial = { id: "w1", name: "Widget One" };
    expect(differingFields(stored(), partial, SHAPE.scalarFields)).toEqual([]);
  });
});

describe("planTable", () => {
  it("creates rows the target does not have", () => {
    const plan = planTable({
      shape: SHAPE,
      existingRows: [],
      incomingRows: [fromFile()],
    });

    expect(plan.counts).toEqual({
      create: 1,
      update: 0,
      unchanged: 0,
      blocked: 0,
    });
    // The id from the file is preserved — everything pointing at this row by
    // foreign key depends on that.
    expect(plan.actions[0]!.data.id).toBe("w1");
    expect(plan.actions[0]!.data.updatedAt).toBeInstanceOf(Date);
  });

  it("reports an existing, identical row as unchanged — not as written", () => {
    // The re-import case. "unchanged" is a true claim; the old script's
    // "already there" was printed next to rows it had never compared.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored()],
      incomingRows: [fromFile()],
    });

    expect(plan.counts.unchanged).toBe(1);
    expect(plan.counts.update).toBe(0);
  });

  it("UPDATES an existing row whose values have changed", () => {
    // This is the bug. The old script hit a unique-constraint error here,
    // called it "already there", and left the stale row in place.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored()],
      incomingRows: [fromFile({ name: "Widget Renamed" })],
    });

    expect(plan.counts.update).toBe(1);
    const action = plan.actions[0]!;
    expect(action.kind).toBe("update");
    expect(action.changedFields).toEqual(["name"]);
    // Only the changed column is sent, so what is reported is exactly what
    // gets written.
    expect(action.data).toEqual({ name: "Widget Renamed" });
  });

  it("notices a changed Json column", () => {
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored()],
      incomingRows: [fromFile({ payload: { alpha: 1, beta: 99 } })],
    });

    expect(plan.actions[0]!.changedFields).toEqual(["payload"]);
  });

  it("does not report a Json column as changed just because keys moved", () => {
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored()],
      incomingRows: [fromFile({ payload: { beta: 2, alpha: 1 } })],
    });

    expect(plan.counts.unchanged).toBe(1);
  });

  it("blocks a row whose unique value belongs to a different row", () => {
    // The target already has code AAA, under another id. Upserting by id
    // would try to insert a second AAA and Postgres would refuse. Catching it
    // in the plan is what lets --dry-run warn before anything is written.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored({ id: "other", name: "Someone else's row" })],
      incomingRows: [fromFile()],
    });

    expect(plan.counts.blocked).toBe(1);
    expect(plan.actions[0]!.reason).toContain("other");
    expect(plan.actions[0]!.reason).toContain("code");
  });

  it("does not treat a row matching its own unique value as a collision", () => {
    // The ordinary re-import: the row in the way IS this row.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored()],
      incomingRows: [fromFile()],
    });

    expect(plan.counts.blocked).toBe(0);
  });

  it("blocks a row with no id instead of inventing one", () => {
    // Creating it would generate a fresh cuid, quietly orphaning every
    // foreign key that pointed at the original row.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [],
      incomingRows: [{ name: "No id here" }],
    });

    expect(plan.counts.blocked).toBe(1);
    expect(plan.actions[0]!.reason).toContain("no id");
  });

  it("blocks the second copy of a duplicated id in the file", () => {
    const plan = planTable({
      shape: SHAPE,
      existingRows: [],
      incomingRows: [fromFile(), fromFile({ name: "A second w1" })],
    });

    expect(plan.counts.create).toBe(1);
    expect(plan.counts.blocked).toBe(1);
    expect(plan.actions[1]!.reason).toContain("more than once");
  });

  it("drops columns the schema no longer has, and says which", () => {
    const plan = planTable({
      shape: SHAPE,
      existingRows: [],
      incomingRows: [fromFile({ retiredColumn: "value" })],
    });

    expect(plan.droppedColumns).toEqual(["retiredColumn"]);
    expect(plan.actions[0]!.data).not.toHaveProperty("retiredColumn");
    // The rest of the row still imports — schema drift is survivable, as long
    // as it is not silent.
    expect(plan.counts.create).toBe(1);
  });

  it("puts every row in exactly one bucket", () => {
    // The property the whole report rests on: no row can pass through
    // uncounted, which is how the old script lost rows without noticing.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored(), stored({ id: "w2", code: "BBB" })],
      incomingRows: [
        fromFile(), // unchanged
        fromFile({ id: "w2", code: "BBB", name: "Changed" }), // update
        fromFile({ id: "w3", code: "CCC" }), // create
        { name: "no id" }, // blocked
      ],
    });

    const { create, update, unchanged, blocked } = plan.counts;
    expect(create + update + unchanged + blocked).toBe(4);
    expect(plan.actions).toHaveLength(4);
  });

  it("handles an empty table without inventing work", () => {
    const plan = planTable({ shape: SHAPE, existingRows: [], incomingRows: [] });
    expect(plan.actions).toEqual([]);
    expect(plan.counts).toEqual({
      create: 0,
      update: 0,
      unchanged: 0,
      blocked: 0,
    });
  });

  it("handles a multi-column unique rule", () => {
    // Job has @@unique([companyId, sourceJobId]) — a collision needs BOTH to
    // match, and a row differing on one of them is fine.
    const shape: TableShape = {
      ...SHAPE,
      scalarFields: ["id", "companyId", "sourceJobId"],
      dateFields: [],
      uniqueKeys: [["companyId", "sourceJobId"]],
    };

    const clash = planTable({
      shape,
      existingRows: [{ id: "other", companyId: "c1", sourceJobId: "s1" }],
      incomingRows: [{ id: "j1", companyId: "c1", sourceJobId: "s1" }],
    });
    expect(clash.counts.blocked).toBe(1);

    const fine = planTable({
      shape,
      existingRows: [{ id: "other", companyId: "c1", sourceJobId: "s1" }],
      incomingRows: [{ id: "j1", companyId: "c1", sourceJobId: "s2" }],
    });
    expect(fine.counts.create).toBe(1);
  });

  it("does not treat two null unique values as colliding", () => {
    // Postgres lets null repeat in a unique column, so two rows with a null
    // code are not in each other's way.
    const plan = planTable({
      shape: SHAPE,
      existingRows: [stored({ id: "other", code: null })],
      incomingRows: [fromFile({ id: "w9", code: null })],
    });

    expect(plan.counts.create).toBe(1);
    expect(plan.counts.blocked).toBe(0);
  });
});
