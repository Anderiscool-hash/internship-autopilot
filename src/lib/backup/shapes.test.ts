/**
 * Tests for the per-table descriptions the import planner runs on.
 *
 * These are checked against the REAL schema, the same way coverage.test.ts is,
 * because the mistakes worth catching are all "the schema changed and this
 * didn't". Prisma's DMMF is metadata generated from schema.prisma — reading it
 * opens no database connection.
 *
 * The specific silent failure here: a DateTime column that nobody notices is a
 * DateTime. Dates survive a backup as strings, so if a column isn't known to
 * be a date it is compared as a string against a Date and reports as different
 * on every single run. The import would then "update" thousands of rows
 * forever, writing values identical to the ones already there, and the summary
 * would never settle down to "unchanged" — which is the one signal that tells
 * you a transfer is complete.
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { BACKUP_TABLES } from "./coverage";
import { buildShapes, delegateName, type SchemaModel } from "./shapes";

const REAL_SCHEMA = Prisma.dmmf.datamodel.models;
const SHAPES = buildShapes(REAL_SCHEMA);

/** Look one up by its field name in the backup file. */
function shape(table: string) {
  const found = SHAPES.find((item) => item.table === table);
  expect(found, `no shape built for ${table}`).toBeDefined();
  return found!;
}

describe("buildShapes against the real schema", () => {
  it("describes every table a backup carries", () => {
    expect(SHAPES.map((item) => item.table)).toEqual(Object.keys(BACKUP_TABLES));
  });

  it("keeps BACKUP_TABLES order, which is foreign-key order", () => {
    // Companies must be written before jobs, candidates before everything
    // they own. The import walks this array top to bottom, so the order here
    // IS the write order — not a coincidence to be preserved by luck.
    const order = SHAPES.map((item) => item.table);
    expect(order.indexOf("companies")).toBeLessThan(order.indexOf("jobs"));
    expect(order.indexOf("candidates")).toBeLessThan(
      order.indexOf("applications"),
    );
    expect(order.indexOf("applications")).toBeLessThan(
      order.indexOf("submissionAttempts"),
    );
  });

  it("gives every table an id column to match rows by", () => {
    // Matching by id is the entire basis of a re-runnable import.
    for (const item of SHAPES) {
      expect(item.idField, `${item.model} has no @id`).toBe("id");
    }
  });

  it("finds the DateTime columns instead of guessing from the name", () => {
    expect(shape("applications").dateFields).toContain("appliedAt");
    // A DateTime[] column — the case a naive `endsWith("Date")` misses.
    expect(shape("applications").dateFields).toContain("interviewDates");
    expect(shape("jobs").dateFields).toContain("firstSeenAt");
  });

  it("does not mistake a plain string column for a date", () => {
    expect(shape("candidates").dateFields).not.toContain("email");
    expect(shape("candidates").dateFields).toContain("graduationDate");
  });

  it("treats a foreign key as a column but a relation as not", () => {
    // `companyId` is a real column the import must copy; `company` is the
    // other side of the relation and would make Prisma throw if sent.
    expect(shape("jobs").scalarFields).toContain("companyId");
    expect(shape("jobs").scalarFields).not.toContain("company");
  });

  it("keeps enum columns, which travel as plain strings", () => {
    expect(shape("applications").scalarFields).toContain("status");
  });

  it("picks up single-column and multi-column uniqueness rules", () => {
    const keys = shape("jobs").uniqueKeys.map((key) => key.join("+"));
    expect(keys).toContain("fingerprint");
    expect(keys).toContain("companyId+sourceJobId");
  });

  it("does not list the primary key as a uniqueness collision rule", () => {
    // Matching by id is what the import DOES; it is never a case of "someone
    // else already holds this value".
    for (const item of SHAPES) {
      for (const key of item.uniqueKeys) {
        expect(key).not.toEqual(["id"]);
      }
    }
  });

  it("knows the Application row is one per candidate and job", () => {
    // Spec §8's anti-duplicate rule. If this constraint ever stops being
    // visible to the planner, a re-import could try to create a second
    // application for the same job and fail mid-run instead of in the plan.
    const keys = shape("applications").uniqueKeys.map((key) => key.join("+"));
    expect(keys).toContain("candidateId+jobId");
  });
});

describe("buildShapes when the schema has drifted", () => {
  it("refuses outright when a declared model has been renamed away", () => {
    // Importing fourteen of fifteen tables and calling it done is the exact
    // class of failure this whole module exists to prevent.
    const renamed: SchemaModel[] = REAL_SCHEMA.filter(
      (model) => model.name !== "ShadowRun",
    ).map((model) => ({ name: model.name, fields: model.fields }));

    expect(() => buildShapes(renamed)).toThrow(/ShadowRun/);
  });

  it("refuses a model with no single primary key", () => {
    const broken: SchemaModel[] = [
      { name: "Company", fields: [{ name: "name", kind: "scalar", type: "String" }] },
    ];

    expect(() => buildShapes(broken)).toThrow(/no single @id/);
  });
});

describe("delegateName", () => {
  it("lower-cases only the first letter, as Prisma does", () => {
    expect(delegateName("Job")).toBe("job");
    expect(delegateName("CandidateDocument")).toBe("candidateDocument");
    expect(delegateName("AiSettings")).toBe("aiSettings");
    expect(delegateName("CandidatePreferences")).toBe("candidatePreferences");
  });
});
