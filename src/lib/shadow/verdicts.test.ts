/**
 * Tests for the shadow-run verdict store (spec §20/§21).
 *
 * These run against a hand-rolled stand-in for Prisma rather than a real
 * database, because what matters here is not the SQL but what is allowed into
 * the `verdict` column and what is counted coming back out of it.
 *
 * The failures worth preventing are all quiet ones. `verdict` is an
 * unconstrained String, so a mistyped verdict would be stored happily and then
 * counted as neither correct nor wrong; an empty note stored as "" would read
 * as a note that exists; and counting anything that is not exactly "correct" as
 * a pass would inflate the pass rate that promotes an adapter toward submitting
 * real applications unattended. Each of those has a negative test below, and
 * those are the point of the file.
 */

import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  atsStandings,
  clearVerdict,
  nextUnverifiedRun,
  recordVerdict,
  verificationProgress,
} from "./verdicts";

interface FakeRun {
  id: string;
  url: string;
  atsType: string;
  fieldsTotal: number;
  fieldsFilled: number;
  fieldsSkipped: number;
  fieldsFailed: number;
  blockingGaps: string[];
  captcha: boolean;
  loginRequired: boolean;
  screenshotPath: string;
  outcomes: unknown;
  verdict: string | null;
  verdictNote: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

const EPOCH = new Date("2026-09-01T00:00:00.000Z");

function run(id: string, overrides: Partial<FakeRun> = {}): FakeRun {
  return {
    id,
    url: `https://boards.example.com/${id}`,
    atsType: "GREENHOUSE",
    fieldsTotal: 10,
    fieldsFilled: 9,
    fieldsSkipped: 1,
    fieldsFailed: 0,
    blockingGaps: [],
    captcha: false,
    loginRequired: false,
    screenshotPath: `shots/${id}.png`,
    outcomes: {},
    verdict: null,
    verdictNote: null,
    verifiedAt: null,
    createdAt: EPOCH,
    ...overrides,
  };
}

/** Days after EPOCH, so ordering in a test reads as a number. */
function day(n: number): Date {
  return new Date(EPOCH.getTime() + n * 24 * 60 * 60 * 1000);
}

type Where = {
  id?: string;
  atsType?: string;
  verdict?: null | { not: null };
};

function matches(row: FakeRun, where: Where | undefined): boolean {
  if (!where) return true;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.atsType !== undefined && row.atsType !== where.atsType) return false;
  if (where.verdict === null && row.verdict !== null) return false;
  if (where.verdict && "not" in where.verdict && row.verdict === null) return false;
  return true;
}

/** A stand-in for the two Prisma models this module reads. */
function fakeDb(rows: FakeRun[]) {
  const updates: { id: string; data: Partial<FakeRun> }[] = [];

  const db = {
    shadowRun: {
      findUnique: async ({ where }: { where: Where }) =>
        rows.find((row) => matches(row, where)) ?? null,
      findFirst: async ({ where }: { where?: Where }) =>
        // Sorted here rather than returned in insertion order, so a test can
        // prove the ordering by handing the fake its rows shuffled on purpose.
        [...rows]
          .filter((row) => matches(row, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null,
      findMany: async ({ where }: { where?: Where } = {}) =>
        rows.filter((row) => matches(row, where)),
      count: async ({ where }: { where?: Where } = {}) =>
        rows.filter((row) => matches(row, where)).length,
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeRun> }) => {
        updates.push({ id: where.id, data });
        // The write is applied to the stored row as well as recorded, so a
        // test can record a verdict and then ask the read functions what the
        // queue looks like afterwards. Without this a round trip could only
        // ever be checked against the writes it issued, which is the thing
        // being tested rather than evidence about it.
        const target = rows.find((row) => row.id === where.id);
        if (target) {
          Object.assign(target, data);
          return target;
        }
        return { ...run(where.id), ...data };
      },
    },
    // Submissions are a separate ladder; nothing in these fixtures has sent
    // anything, and level 4 is out of reach without an opt-in regardless.
    submissionAttempt: { findMany: async () => [] },
  };

  return { db: db as unknown as PrismaClient, updates };
}

describe("recordVerdict", () => {
  it("writes the verdict, the note and the time it was checked", async () => {
    const { db, updates } = fakeDb([run("r1")]);

    await recordVerdict(db, "r1", "wrong", "the phone went in the zip field");

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("r1");
    expect(updates[0]!.data.verdict).toBe("wrong");
    expect(updates[0]!.data.verdictNote).toBe("the phone went in the zip field");
    expect(updates[0]!.data.verifiedAt).toBeInstanceOf(Date);
  });

  it("stores an empty or whitespace-only note as null", async () => {
    const { db, updates } = fakeDb([run("r1"), run("r2")]);

    await recordVerdict(db, "r1", "correct", "");
    await recordVerdict(db, "r2", "correct", "   \n ");

    expect(updates[0]!.data.verdictNote).toBeNull();
    expect(updates[1]!.data.verdictNote).toBeNull();
  });

  it("refuses a verdict that is not exactly correct or wrong", async () => {
    const { db, updates } = fakeDb([run("r1")]);

    await expect(
      // The column would take this happily; the point is that this function
      // does not, because nothing downstream would ever count it.
      recordVerdict(db, "r1", "Correct" as unknown as "correct", null),
    ).rejects.toThrow(/expected "correct" or "wrong"/);

    expect(updates).toHaveLength(0);
  });

  it("rejects a bad verdict before it even looks the run up", async () => {
    // Order matters: validating first means an invalid verdict fails the same
    // way whether or not the id happens to exist.
    const { db, updates } = fakeDb([]);

    await expect(
      recordVerdict(db, "missing", "maybe" as unknown as "correct", null),
    ).rejects.toThrow(/expected "correct" or "wrong"/);

    expect(updates).toHaveLength(0);
  });

  it("throws a readable error when the run id does not exist", async () => {
    const { db, updates } = fakeDb([run("r1")]);

    await expect(recordVerdict(db, "nope", "correct", null)).rejects.toThrow(
      "No shadow run with id nope.",
    );

    expect(updates).toHaveLength(0);
  });
});

describe("clearVerdict", () => {
  it("clears the verdict and the time it was checked", async () => {
    const { db, updates } = fakeDb([
      run("r1", { verdict: "wrong", verifiedAt: day(2) }),
    ]);

    await clearVerdict(db, "r1");

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("r1");
    expect(updates[0]!.data.verdict).toBeNull();
    expect(updates[0]!.data.verifiedAt).toBeNull();
  });

  it("keeps the note, because the note is what the misclick was about", async () => {
    // The whole reason this function exists: someone writes up what went
    // wrong, presses the wrong button, and undoes it. Throwing the note away
    // there would make the undo cost more than the mistake did.
    const stored = run("r1", {
      verdict: "correct",
      verdictNote: "the phone went in the zip field",
      verifiedAt: day(2),
    });
    const { db, updates } = fakeDb([stored]);

    await clearVerdict(db, "r1");

    // Two halves of the same claim: the write never mentions the column, and
    // the row still has the note afterwards.
    expect(updates[0]!.data).not.toHaveProperty("verdictNote");
    expect(stored.verdictNote).toBe("the phone went in the zip field");
  });

  it("writes nothing when the run is already unverified", async () => {
    // A double-clicked Undo link lands here. It must be quiet, not an error
    // and not a second write.
    const { db, updates } = fakeDb([run("r1")]);

    await clearVerdict(db, "r1");

    expect(updates).toHaveLength(0);
  });

  it("throws a readable error when the run id does not exist", async () => {
    const { db, updates } = fakeDb([run("r1", { verdict: "correct" })]);

    await expect(clearVerdict(db, "nope")).rejects.toThrow("No shadow run with id nope.");

    expect(updates).toHaveLength(0);
  });

  it("keeps a misclick out of the trust ladder: a cleared run counts as unverified again", async () => {
    // The property that matters. A verdict nobody meant to give would
    // otherwise sit in the evidence that promotes an adapter toward
    // submitting real applications, and undoing it has to remove it from
    // there and not merely from the screen.
    const { db } = fakeDb([run("r1")]);

    await recordVerdict(db, "r1", "correct", "clicked this by mistake");
    expect(await verificationProgress(db)).toEqual({ total: 1, verified: 1, pending: 0 });

    await clearVerdict(db, "r1");

    expect(await verificationProgress(db)).toEqual({ total: 1, verified: 0, pending: 1 });
    expect((await nextUnverifiedRun(db))?.id).toBe("r1");
    expect((await atsStandings(db))[0]!.verified).toBe(0);
  });
});

describe("nextUnverifiedRun", () => {
  it("returns the oldest run nobody has checked", async () => {
    const { db } = fakeDb([
      run("newest", { createdAt: day(3) }),
      run("oldest", { createdAt: day(1) }),
      run("middle", { createdAt: day(2) }),
    ]);

    expect((await nextUnverifiedRun(db))?.id).toBe("oldest");
  });

  it("skips runs that already have a verdict, however old", async () => {
    const { db } = fakeDb([
      run("done", { createdAt: day(1), verdict: "correct" }),
      run("waiting", { createdAt: day(5) }),
    ]);

    expect((await nextUnverifiedRun(db))?.id).toBe("waiting");
  });

  it("returns null when every run has been checked", async () => {
    const { db } = fakeDb([run("done", { verdict: "wrong" })]);
    expect(await nextUnverifiedRun(db)).toBeNull();
  });

  it("returns null when there are no runs at all", async () => {
    const { db } = fakeDb([]);
    expect(await nextUnverifiedRun(db)).toBeNull();
  });
});

describe("verificationProgress", () => {
  it("splits the runs into verified and pending", async () => {
    const { db } = fakeDb([
      run("a", { verdict: "correct" }),
      run("b", { verdict: "wrong" }),
      run("c"),
      run("d"),
      run("e"),
    ]);

    expect(await verificationProgress(db)).toEqual({ total: 5, verified: 2, pending: 3 });
  });

  it("reports nothing pending once every run is checked", async () => {
    const { db } = fakeDb([run("a", { verdict: "correct" }), run("b", { verdict: "wrong" })]);

    expect(await verificationProgress(db)).toEqual({ total: 2, verified: 2, pending: 0 });
  });

  it("reports zeroes rather than a negative remainder when there are no runs", async () => {
    const { db } = fakeDb([]);
    expect(await verificationProgress(db)).toEqual({ total: 0, verified: 0, pending: 0 });
  });
});

describe("atsStandings", () => {
  it("counts only an exact correct as a pass", async () => {
    // "Correct" is the trap. A count written as `verdict !== "wrong"` would
    // score this 5 of 6 and clear the 80% bar for level 2 — promoting an
    // adapter on the strength of a verdict nobody ever recorded.
    const { db } = fakeDb([
      run("a", { verdict: "correct" }),
      run("b", { verdict: "correct" }),
      run("c", { verdict: "correct" }),
      run("d", { verdict: "correct" }),
      run("e", { verdict: "wrong" }),
      run("f", { verdict: "Correct" }),
    ]);

    const greenhouse = (await atsStandings(db))[0]!;

    expect(greenhouse.verified).toBe(6);
    expect(greenhouse.correct).toBe(4);
    expect(greenhouse.level).toBe(1);
  });

  it("lists an ATS that has runs but no verdicts yet", async () => {
    const { db } = fakeDb([run("a", { atsType: "LEVER" }), run("b", { atsType: "LEVER" })]);

    expect(await atsStandings(db)).toEqual([
      { atsType: "LEVER", verified: 0, correct: 0, level: 1 },
    ]);
  });

  it("gives an ATS with no adapter level 0 however its runs went", async () => {
    const { db } = fakeDb([
      run("a", { atsType: "WORKDAY", verdict: "correct" }),
      run("b", { atsType: "WORKDAY", verdict: "correct" }),
    ]);

    expect(await atsStandings(db)).toEqual([
      { atsType: "WORKDAY", verified: 2, correct: 2, level: 0 },
    ]);
  });

  it("returns one entry per ATS that has at least one run", async () => {
    const { db } = fakeDb([
      run("a", { atsType: "LEVER", verdict: "correct" }),
      run("b", { atsType: "GREENHOUSE" }),
      run("c", { atsType: "LEVER", verdict: "wrong" }),
    ]);

    const standings = await atsStandings(db);

    expect(standings.map((standing) => standing.atsType)).toEqual(["GREENHOUSE", "LEVER"]);
    expect(standings.find((standing) => standing.atsType === "LEVER")).toEqual({
      atsType: "LEVER",
      verified: 2,
      correct: 1,
      level: 1,
    });
  });

  it("returns nothing when no runs exist", async () => {
    const { db } = fakeDb([]);
    expect(await atsStandings(db)).toEqual([]);
  });
});
