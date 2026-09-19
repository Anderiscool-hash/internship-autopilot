// ============================================================================
// Working out what an import WOULD do, before it does anything.
//
// The old import script had one move: try to create the row, and if Postgres
// said "that id already exists", call it "already there" and move on. That
// reads as safe, and it is the opposite of safe. It means the second import —
// the catch-up run you do after the old machine kept working for another day
// — writes nothing at all, and prints a cheerful summary while doing it. The
// row on the new server keeps yesterday's values forever, and nothing in the
// output tells you.
//
// So the decision moves here, out of the try/catch and into a function that
// takes two lists of rows and says, for every single one, which of four things
// is true:
//
//   create     — no row with this id on the target yet
//   update     — a row with this id exists and some column differs
//   unchanged  — a row with this id exists and every column matches
//   blocked    — this row cannot be written, and here is the reason why
//
// Everything in this file is pure: rows in, decisions out, no database and no
// clock. That is deliberate. It means `--dry-run` and the real run share one
// brain — the dry run is not a second implementation that might disagree with
// the first — and it means the counting can be tested with fixtures instead of
// against somebody's real data.
// ============================================================================

/**
 * What one table looks like, as far as planning is concerned.
 *
 * In the real script this is built from `Prisma.dmmf` — the metadata Prisma
 * generates from schema.prisma — so it cannot drift from the schema. It is
 * plain data here so a test can describe a two-column table in four lines.
 */
export interface TableShape {
  /** The field name in the backup file, e.g. "shadowRuns". */
  table: string;
  /** The Prisma model name, e.g. "ShadowRun". Only used in messages. */
  model: string;
  /** The primary key column. Always "id" in this schema. */
  idField: string;
  /**
   * Every column the table actually has. Anything in the file that isn't
   * here is a leftover from an older schema and gets dropped (and reported)
   * rather than handed to Prisma, which would just throw.
   */
  scalarFields: readonly string[];
  /**
   * Columns typed DateTime. JSON has no date type, so these arrive as
   * strings like "2026-03-02T11:00:00.000Z" and have to be turned back into
   * Date objects — otherwise every comparison against the database says
   * "different" and every row looks like it needs an update, forever.
   */
  dateFields: readonly string[];
  /**
   * Uniqueness rules other than the primary key, each as the list of columns
   * it covers — so `[["fingerprint"], ["companyId", "sourceJobId"]]`.
   *
   * These matter because of one specific, nasty case: the target already has
   * a row with the same fingerprint as an incoming row, but under a DIFFERENT
   * id. Upserting by id would try to insert a second row and Postgres would
   * refuse. Catching it here means the dry run can warn you about it instead
   * of the real run discovering it halfway through.
   */
  uniqueKeys: readonly (readonly string[])[];
}

/** What we decided to do with one row, and why. */
export interface RowAction {
  /** The row's id from the file, or "(no id)" when it didn't have one. */
  id: string;
  kind: "create" | "update" | "unchanged" | "blocked";
  /** For "update": which columns differ. Named so the summary can show them. */
  changedFields: string[];
  /** For "blocked": a sentence a non-programmer can act on. */
  reason?: string;
  /**
   * The payload to hand Prisma — the whole row for a create, only the changed
   * columns for an update. Empty for unchanged and blocked rows.
   */
  data: Record<string, unknown>;
}

/** Everything planned for one table. */
export interface TablePlan {
  table: string;
  model: string;
  actions: RowAction[];
  /** How many rows fall into each bucket. Derived, but computed once here. */
  counts: { create: number; update: number; unchanged: number; blocked: number };
  /**
   * Columns that were in the file but are not in the schema any more. Reported
   * rather than ignored: a column quietly disappearing between the export and
   * the import is exactly the sort of thing you want told to your face.
   */
  droppedColumns: string[];
}

// ---------------------------------------------------------------------------
// Turning JSON back into values the database can be compared against
// ---------------------------------------------------------------------------

/**
 * Rebuild the Date objects that JSON.stringify flattened into strings.
 *
 * Which columns are dates is passed in from the schema rather than guessed
 * from the column name. The previous version of this logic used a regex over
 * field names (`/At$|Date$|.../`), which works right up until someone adds a
 * DateTime column called `deadline` — then that one column silently stays a
 * string and every row containing it looks permanently out of date.
 */
export function reviveDates(
  row: Record<string, unknown>,
  dateFields: readonly string[],
): Record<string, unknown> {
  const dates = new Set(dateFields);
  const revived: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (!dates.has(key) || value === null || value === undefined) {
      revived[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      // A DateTime[] column, e.g. Application.interviewDates.
      revived[key] = value.map((item) =>
        typeof item === "string" ? toDateOrKeep(item) : item,
      );
    } else if (typeof value === "string") {
      revived[key] = toDateOrKeep(value);
    } else {
      revived[key] = value;
    }
  }

  return revived;
}

/**
 * Parse a date string, but hand back the original if it isn't one.
 *
 * Passing an Invalid Date to Prisma produces a confusing error a long way from
 * the cause; passing the original string through means the row fails with a
 * message that at least contains the bad value.
 */
function toDateOrKeep(value: string): Date | string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

/**
 * Reduce any value to a string that two equal values always share.
 *
 * Needed because "is this row different?" has to work across the JSON round
 * trip. A Date and its ISO string are the same value; `{a:1,b:2}` and
 * `{b:2,a:1}` are the same Json column; `null` and a missing key are both
 * "no value". Plain `===` says no to all three.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "bigint") return `num:${value.toString()}`;
  if (typeof value === "object") {
    // Sort the keys so two Json blobs written in different key orders — which
    // Postgres is entirely free to do — still compare as equal.
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(",")}}`;
  }
  return `${typeof value}:${JSON.stringify(value)}`;
}

/**
 * Which columns actually differ between the row on the target and the row in
 * the file.
 *
 * Only columns PRESENT in the incoming row are considered. A column the file
 * doesn't mention is left exactly as it is on the target rather than being
 * overwritten with null — an older backup missing a column added since should
 * not wipe that column out.
 */
export function differingFields(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  scalarFields: readonly string[],
): string[] {
  const differing: string[] = [];

  for (const field of scalarFields) {
    if (!Object.hasOwn(incoming, field)) continue;
    if (canonicalize(existing[field]) !== canonicalize(incoming[field])) {
      differing.push(field);
    }
  }

  return differing;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Build the key a uniqueness rule compares on, or null if the row doesn't
 * carry every column the rule covers (in which case it can't collide here).
 */
function uniqueKeyOf(
  row: Record<string, unknown>,
  columns: readonly string[],
): string | null {
  const parts: string[] = [];
  for (const column of columns) {
    if (!Object.hasOwn(row, column) || row[column] === null) return null;
    parts.push(canonicalize(row[column]));
  }
  return `${columns.join("+")}=${parts.join("|")}`;
}

/**
 * Decide what to do with every row of one table.
 *
 * `existingRows` is what the target database currently holds for this table;
 * `incomingRows` is what the backup file holds. Nothing is written — this only
 * produces the list of intentions, which `--dry-run` prints and a real run
 * then carries out.
 */
export function planTable(input: {
  shape: TableShape;
  existingRows: readonly Record<string, unknown>[];
  incomingRows: readonly Record<string, unknown>[];
}): TablePlan {
  const { shape, existingRows, incomingRows } = input;
  const known = new Set(shape.scalarFields);

  // Index the target's rows by id, and by each uniqueness rule, so every
  // lookup below is a map hit rather than a scan per row.
  const byId = new Map<string, Record<string, unknown>>();
  const byUnique = new Map<string, string>(); // unique key -> owning row id

  for (const row of existingRows) {
    const id = row[shape.idField];
    if (typeof id !== "string") continue;
    byId.set(id, row);
    for (const columns of shape.uniqueKeys) {
      const key = uniqueKeyOf(row, columns);
      if (key !== null) byUnique.set(key, id);
    }
  }

  const actions: RowAction[] = [];
  const droppedColumns = new Set<string>();
  const seenIds = new Set<string>();

  for (const raw of incomingRows) {
    const id = raw[shape.idField];

    // A row with no id cannot be matched to anything, and creating it would
    // invent a new id — which quietly breaks every foreign key pointing at the
    // row it was supposed to be. Refuse, loudly.
    if (typeof id !== "string" || id === "") {
      actions.push({
        id: "(no id)",
        kind: "blocked",
        changedFields: [],
        reason: `row has no ${shape.idField}, so it cannot be matched or safely created`,
        data: {},
      });
      continue;
    }

    // The same id twice in one file. The first one wins; the second is named
    // rather than silently applied on top of it.
    if (seenIds.has(id)) {
      actions.push({
        id,
        kind: "blocked",
        changedFields: [],
        reason: "this id appears more than once in the backup file",
        data: {},
      });
      continue;
    }
    seenIds.add(id);

    // Drop columns the schema no longer has, and remember their names.
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (known.has(key)) payload[key] = value;
      else droppedColumns.add(key);
    }

    const incoming = reviveDates(payload, shape.dateFields);
    const existing = byId.get(id);

    // A different row already owns one of this row's unique values. Writing
    // this one is impossible until that is resolved by hand, so say which row
    // is in the way instead of failing halfway through the real run.
    const collision = findCollision(incoming, id, shape, byUnique);
    if (collision !== null) {
      actions.push({
        id,
        kind: "blocked",
        changedFields: [],
        reason: collision,
        data: {},
      });
      continue;
    }

    if (existing === undefined) {
      actions.push({ id, kind: "create", changedFields: [], data: incoming });
      continue;
    }

    const changedFields = differingFields(existing, incoming, shape.scalarFields);

    if (changedFields.length === 0) {
      actions.push({ id, kind: "unchanged", changedFields: [], data: {} });
      continue;
    }

    // Send only what changed. Narrower than replacing the whole row, and it
    // means the reported field list is exactly what will be written.
    const update: Record<string, unknown> = {};
    for (const field of changedFields) update[field] = incoming[field];

    actions.push({ id, kind: "update", changedFields, data: update });
  }

  return {
    table: shape.table,
    model: shape.model,
    actions,
    counts: {
      create: actions.filter((action) => action.kind === "create").length,
      update: actions.filter((action) => action.kind === "update").length,
      unchanged: actions.filter((action) => action.kind === "unchanged").length,
      blocked: actions.filter((action) => action.kind === "blocked").length,
    },
    droppedColumns: [...droppedColumns].sort(),
  };
}

/**
 * Is some OTHER row already holding a value this row needs to be unique?
 *
 * Returns the explanation, or null when the row is clear to write. Note the
 * "other": a row matching itself on its own fingerprint is the normal case for
 * a re-import and must not be treated as a collision.
 */
function findCollision(
  incoming: Record<string, unknown>,
  id: string,
  shape: TableShape,
  byUnique: ReadonlyMap<string, string>,
): string | null {
  for (const columns of shape.uniqueKeys) {
    const key = uniqueKeyOf(incoming, columns);
    if (key === null) continue;

    const owner = byUnique.get(key);
    if (owner !== undefined && owner !== id) {
      const values = columns
        .map((column) => `${column}=${JSON.stringify(incoming[column])}`)
        .join(", ");
      return (
        `a different row (id ${owner}) already has ${values}, which must be ` +
        `unique — this row cannot be written until one of the two is removed`
      );
    }
  }

  return null;
}
