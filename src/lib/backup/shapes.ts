// ============================================================================
// Describing each table from the schema itself, never by hand.
//
// The planner in rows.ts needs to know, per table: which columns exist, which
// of them are dates, and which combinations have to stay unique. All three are
// already written down in prisma/schema.prisma, and Prisma hands them back as
// metadata (`Prisma.dmmf`) without opening a connection.
//
// Reading them from there rather than retyping them is the same argument
// coverage.ts makes about the table list: a hand-maintained copy of a schema
// detail is correct exactly until the schema changes, and then it is wrong
// silently. A new DateTime column that nobody adds to a hand-written list of
// date fields doesn't crash — it just makes that column compare as different
// on every run, so every row looks like it needs updating forever.
//
// This file takes the schema metadata as an argument instead of importing it,
// so the tests can describe an invented table without a database or a
// generated client.
// ============================================================================

import { BACKUP_TABLES } from "./coverage";
import type { TableShape } from "./rows";

/** The parts of a Prisma DMMF field this file actually reads. */
export interface SchemaField {
  readonly name: string;
  /** "scalar", "enum" or "object". Object fields are relations, not columns. */
  readonly kind: string;
  /** "String", "DateTime", "Json", an enum name, or a model name. */
  readonly type: string;
  readonly isId?: boolean;
  readonly isUnique?: boolean;
}

/** The parts of a Prisma DMMF model this file actually reads. */
export interface SchemaModel {
  readonly name: string;
  readonly fields: readonly SchemaField[];
  /** Multi-column @@unique constraints, each as its list of columns. */
  readonly uniqueFields?: readonly (readonly string[])[];
}

/**
 * The property name on the Prisma client for a model — `Job` becomes
 * `db.job`, `CandidateDocument` becomes `db.candidateDocument`.
 *
 * This is Prisma's own rule (lower-case the first letter and nothing else),
 * which is why deriving it is safe and a hand-written map of fifteen
 * model-to-property pairs was fifteen chances to typo. The import script
 * checks the property actually exists before using it, so if Prisma ever
 * changed the rule the script would refuse to run rather than skip a table.
 */
export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Build the description of every table a backup carries, in the order they
 * must be written — parents before children, straight from BACKUP_TABLES.
 *
 * Throws if the schema has no model by a declared name. That can only happen
 * after a rename, and coverage.ts already refuses to export in that case; this
 * makes the import refuse too, rather than quietly importing fourteen of
 * fifteen tables.
 */
export function buildShapes(
  schemaModels: readonly SchemaModel[],
): TableShape[] {
  const byName = new Map(schemaModels.map((model) => [model.name, model]));
  const shapes: TableShape[] = [];

  for (const [table, modelName] of Object.entries(BACKUP_TABLES)) {
    const model = byName.get(modelName);
    if (model === undefined) {
      throw new Error(
        `BACKUP_TABLES declares the model "${modelName}" (as "${table}") but ` +
          `prisma/schema.prisma has no such model. A rename leaves the old ` +
          `name behind — update src/lib/backup/coverage.ts.`,
      );
    }

    shapes.push(shapeOf(table, model));
  }

  return shapes;
}

/** One model's columns, dates and uniqueness rules. */
function shapeOf(table: string, model: SchemaModel): TableShape {
  // Relations (kind "object") are not columns — they are the other end of a
  // foreign key, and the export never writes them. Enums are columns, and
  // travel as plain strings, so they stay.
  const columns = model.fields.filter((field) => field.kind !== "object");

  const idField = columns.find((field) => field.isId === true)?.name;
  if (idField === undefined) {
    throw new Error(
      `Model "${model.name}" has no single @id column, so rows in it cannot ` +
        `be matched by id on re-import. Give it one, or exclude it from ` +
        `backups in src/lib/backup/coverage.ts with a reason.`,
    );
  }

  // Single-column @unique, plus every multi-column @@unique. The id is left
  // out on purpose: matching by id is what the import does, so it is never a
  // "someone else already has this value" collision.
  const uniqueKeys: string[][] = [];
  for (const field of columns) {
    if (field.isUnique === true && field.name !== idField) {
      uniqueKeys.push([field.name]);
    }
  }
  for (const combination of model.uniqueFields ?? []) {
    if (combination.length > 0) uniqueKeys.push([...combination]);
  }

  return {
    table,
    model: model.name,
    idField,
    scalarFields: columns.map((field) => field.name),
    dateFields: columns
      .filter((field) => field.type === "DateTime")
      .map((field) => field.name),
    uniqueKeys,
  };
}
