# Apply Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ApplicationStatus.APPLYING` and everything after it reachable — an application can be filled, reviewed by a human, and actually submitted — without weakening the property that a defect in the filling code cannot send an application.

**Architecture:** Filling and submitting stay separate phases. `runShadowApply` keeps its context-level submit guard armed unconditionally for the whole fill. After the result object is built, an optional `onFilled` callback receives the live page plus a narrow `openSubmitWindow` closure; that closure is the *only* way to let a POST through, it lives inside `shadow.ts`, it is scoped to the form's own host, it is time-bounded, and it closes in a `finally`. The submit module decides *whether* to open the window and detects the outcome; it can never lift the guard itself. Per-ATS adapters own only three things — finding the submit button, recognising success, recognising an error — because the filling code is already generic and works.

**Tech Stack:** TypeScript, Next.js (App Router, server actions), Prisma + Postgres 17, Playwright, Vitest 2.1.

**Spec:** `docs/superpowers/specs/2026-09-13-apply-workers-design.md`

---

## Global Constraints

- **Tests never submit to a real employer's form.** Not once, not "carefully", not to check a selector. Every browser test drives the local fixture server from Task 3 or a `file://` fixture.
- **The negative is tested explicitly.** For every gate, a test asserts that when the gate fails the POST is aborted and the attempt is recorded as refused. A suite that only tests the happy path would not notice the guard being deleted.
- **The guard-lift never leaves `src/lib/apply/shadow.ts`.** No other file may call `context.route`, `context.unroute`, or mutate the window state. Task 7's module receives a closure, never the context.
- **Vitest runs on defaults — there is no `vitest.config.ts`.** So: **no `@/` path alias in tests**, use relative imports; `describe`/`it`/`expect` must be imported by name from `"vitest"`; test environment is `node`.
- **Tests are co-located** as `<module>.test.ts` beside `<module>.ts`. Every test file opens with a `/** ... */` block saying *why the test exists and what failure it prevents*. This house style is applied consistently across all 45 existing test files — match it.
- **No real database in tests.** Prisma is hand-rolled as an object literal cast `as unknown as PrismaClient` (canonical example: `src/lib/alerts/dispatch.test.ts:28-50`). `vi.mock` is used nowhere in this repo. Every new function that touches the DB takes `db: PrismaClient` as its **first parameter**.
- **Verification command after every task:** `npm run typecheck && npm test`. Before the final commit also run `npm run build`. CI runs `npm ci && npx prisma generate && npm run typecheck && npm test && npm run build`.
- **Never run `npm run build` while `npm run dev` is up** — it overwrites `.next` and the dev server 500s with MODULE_NOT_FOUND. Stop the dev server first. Likewise `prisma generate` fails EPERM while the dev server holds the query engine DLL.
- **Migrations:** `npm run db:migrate -- --name <snake_case_name>`.
- **Ships gated at trust level 3** (fill → human review → submit). Level 4 (auto-submit) is implemented but unreachable without both the evidence bar *and* an explicit manual opt-in that no code path can set on its own.

### Assumptions carried from the design doc

Two values in the design were flagged as the user's to confirm and were **not** confirmed before this plan was written. Both are isolated so they are cheap to change:

1. **Trust thresholds** — the proposed ladder is used. It lives in one exported constant, `TRUST_THRESHOLDS` in `src/lib/apply/trust.ts` (Task 1). Changing it is one edit plus the table-driven test.
   **→ RESOLVED 2026-09-16: reviewed with the user and kept unchanged.** See "The trust thresholds, resolved" in the design doc. The comment above the constant in Task 1's code block still reads as the original assumption; the shipped file no longer does.
2. **Review surface** — the `/applications` tracker's existing "Needs you" column is reused rather than a dedicated queue page (Task 11).
   **→ Still unconfirmed.** It shipped this way and has not been objected to, which is not the same as being chosen. Revisit if the "Needs you" column gets crowded.

Safe to defer because level 3 stops for human approval on *every* application, and level 4 cannot switch itself on.

### Facts established by research, which the design did not know

- The guard is **`context.route("**/*")`** at `shadow.ts:211`, armed per-context (a fresh context per run, deliberately — `shadow.ts:189-192`), not per-page.
- **Handoff is not a function to mirror.** It is one inline `await context.unroute("**/*")` at `shadow.ts:394` that never re-arms. This plan does **not** copy it. It copies the `uploadWindow` pattern at `shadow.ts:234` instead: one permanently-installed route handler consulting a mutable window variable. Re-arming is then automatic and cannot be forgotten.
- **No caller can get a live `Page`.** `runShadowApply` creates and tears down its own context in a `finally` (`shadow.ts:436-455`) on every exit path. Task 6 adds the seam.
- **Confidence never reaches the apply pipeline.** `scoreConfidence` is called from exactly one production site, `scripts/preflight.ts:185`, is never persisted, and is absent from `ShadowRunResult`. Task 2 makes it usable as a gate.
- **`Application` has no queue columns** — no lease, attempt counter, or next-attempt time. Task 5 adds them.
- **`decideAutoApply` is advisory only** — nothing under `src/` calls it, and the `CandidatePreferences` → `AutoApplyRules` mapping is duplicated inconsistently between `scripts/preflight.ts:213-218` and `src/app/settings/page.tsx:60-64`. Task 8 gives it one home.
- **`canTransition` permits one pipeline step at a time** (`machine.ts:117-130`). The approve path is therefore three writes: `WAITING_FOR_USER → QUEUED → APPLYING → SUBMITTED_PENDING_CONFIRMATION`. No state machine change and no new `ApplicationStatus` — adding one would break the coverage tests at `machine.test.ts:160-173`.
- **There is no verdict UI and no local HTTP fixture server.** The only browser test uses `file://` pages and says outright that it does not exercise the guard (`shadow.test.ts:19-22`). Task 3 introduces the repo's first fixture server.

---

## File Structure

**Created:** `src/lib/apply/trust.ts` (+test), `src/lib/apply/adapters/{types,greenhouse,lever,ashby,generic,index}.ts` (+`adapters.test.ts`), `src/lib/apply/fixture-server.ts` (+test), `src/lib/apply/submit.ts` (+test), `src/lib/apply/submit-window.test.ts`, `src/lib/apply/worker.ts` (+test), `src/lib/autoapply/load-rules.ts` (+test), `src/app/applications/review-panel.tsx`.

**Modified:** `prisma/schema.prisma`, `src/lib/apply/shadow.ts`, `src/lib/apply/confidence.ts` (+test), `src/lib/apply/run-application.ts`, `scripts/preflight.ts`, `src/app/settings/page.tsx`, `scripts/apply-daemon.ts`, `src/lib/apply/daemon-client.ts`, `src/app/applications/{application-card.tsx,actions.ts,page.tsx}`, `docs/ARCHITECTURE.md`.

---

## Task 1: Trust ladder

**Files:**
- Create: `src/lib/apply/trust.ts`
- Test: `src/lib/apply/trust.test.ts`

**Interfaces:**
- Produces: `type TrustLevel = 0 | 1 | 2 | 3 | 4`; `interface TrustEvidence`; `const TRUST_THRESHOLDS`; `computeTrustLevel(evidence: TrustEvidence): TrustLevel`; `correctRate(evidence: TrustEvidence): number | null`; `reliabilityForTrustLevel(level: TrustLevel): number`; `gatherTrustEvidence(db: PrismaClient, atsType: AtsType, autoSubmitOptIn: boolean): Promise<TrustEvidence>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/apply/trust.test.ts`:

```ts
/**
 * Tests for the adapter trust ladder (spec §21).
 *
 * Two properties matter more than the specific thresholds, and both are the
 * reason this file exists: evidence can make an ATS *eligible* for auto-submit
 * but must never *promote* it — that last step is a human's — and an
 * unverified run is not evidence of anything. A regression in either one would
 * mean applications going out on the strength of runs nobody ever checked.
 */

import { describe, it, expect } from "vitest";
import {
  computeTrustLevel,
  correctRate,
  gatherTrustEvidence,
  reliabilityForTrustLevel,
  TRUST_THRESHOLDS,
  type TrustEvidence,
} from "./trust";
import type { PrismaClient } from "@prisma/client";

/** Evidence for an ATS that has earned nothing yet. */
function evidence(overrides: Partial<TrustEvidence> = {}): TrustEvidence {
  return {
    hasAdapter: true,
    verifiedRuns: 0,
    correctRuns: 0,
    confirmedSubmissions: 0,
    wrongSubmissions: 0,
    autoSubmitOptIn: false,
    ...overrides,
  };
}

describe("computeTrustLevel", () => {
  it("gives an ATS with no adapter level 0, however good its history", () => {
    const level = computeTrustLevel(
      evidence({
        hasAdapter: false,
        verifiedRuns: 100,
        correctRuns: 100,
        confirmedSubmissions: 50,
        autoSubmitOptIn: true,
      }),
    );
    expect(level).toBe(0);
  });

  it("starts a fresh adapter at level 1", () => {
    expect(computeTrustLevel(evidence())).toBe(1);
  });

  it("reaches level 2 on five verified runs at 80%", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 5, correctRuns: 4 }))).toBe(2);
  });

  it("holds at level 1 when the rate is met but the count is not", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 4, correctRuns: 4 }))).toBe(1);
  });

  it("holds at level 1 when the count is met but the rate is not", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 5, correctRuns: 3 }))).toBe(1);
  });

  it("reaches level 3 — where this ships — on ten verified runs at 90%", () => {
    expect(computeTrustLevel(evidence({ verifiedRuns: 10, correctRuns: 9 }))).toBe(3);
  });

  it("never reaches level 4 on evidence alone", () => {
    const level = computeTrustLevel(
      evidence({
        verifiedRuns: 100,
        correctRuns: 100,
        confirmedSubmissions: 50,
        autoSubmitOptIn: false,
      }),
    );
    expect(level).toBe(3);
  });

  it("reaches level 4 only with the evidence AND the opt-in", () => {
    const level = computeTrustLevel(
      evidence({
        verifiedRuns: 25,
        correctRuns: 24,
        confirmedSubmissions: 10,
        autoSubmitOptIn: true,
      }),
    );
    expect(level).toBe(4);
  });

  it("refuses level 4 while any submission was judged wrong", () => {
    const level = computeTrustLevel(
      evidence({
        verifiedRuns: 100,
        correctRuns: 100,
        confirmedSubmissions: 50,
        wrongSubmissions: 1,
        autoSubmitOptIn: true,
      }),
    );
    expect(level).toBe(3);
  });

  it("refuses level 4 without enough confirmed submissions", () => {
    const level = computeTrustLevel(
      evidence({
        verifiedRuns: 25,
        correctRuns: 25,
        confirmedSubmissions: 9,
        autoSubmitOptIn: true,
      }),
    );
    expect(level).toBe(3);
  });

  it("is monotonic: adding a correct run never lowers the level", () => {
    for (let runs = 0; runs < 40; runs += 1) {
      const before = computeTrustLevel(
        evidence({ verifiedRuns: runs, correctRuns: runs, autoSubmitOptIn: false }),
      );
      const after = computeTrustLevel(
        evidence({ verifiedRuns: runs + 1, correctRuns: runs + 1, autoSubmitOptIn: false }),
      );
      expect(after, `${runs} -> ${runs + 1}`).toBeGreaterThanOrEqual(before);
    }
  });
});

describe("correctRate", () => {
  it("is null with no verified runs, not zero", () => {
    expect(correctRate(evidence())).toBeNull();
  });

  it("is the fraction of verified runs judged correct", () => {
    expect(correctRate(evidence({ verifiedRuns: 4, correctRuns: 3 }))).toBe(0.75);
  });
});

describe("TRUST_THRESHOLDS", () => {
  it("is ordered by level with no gaps", () => {
    const levels = TRUST_THRESHOLDS.map((threshold) => threshold.level);
    expect(levels).toEqual([1, 2, 3, 4]);
  });

  it("never lowers a requirement as the level rises", () => {
    for (let index = 1; index < TRUST_THRESHOLDS.length; index += 1) {
      const previous = TRUST_THRESHOLDS[index - 1];
      const current = TRUST_THRESHOLDS[index];
      expect(current.minVerifiedRuns, `level ${current.level}`).toBeGreaterThanOrEqual(
        previous.minVerifiedRuns,
      );
      expect(current.minCorrectRate, `level ${current.level}`).toBeGreaterThanOrEqual(
        previous.minCorrectRate,
      );
    }
  });

  it("requires a human opt-in at level 4 and nowhere else", () => {
    for (const threshold of TRUST_THRESHOLDS) {
      expect(threshold.requiresOptIn, `level ${threshold.level}`).toBe(
        threshold.level === 4,
      );
    }
  });
});

describe("reliabilityForTrustLevel", () => {
  it("is zero for an ATS that cannot submit", () => {
    expect(reliabilityForTrustLevel(0)).toBe(0);
  });

  it("rises with the level", () => {
    const levels = [0, 1, 2, 3, 4] as const;
    for (let index = 1; index < levels.length; index += 1) {
      expect(
        reliabilityForTrustLevel(levels[index]),
        `level ${levels[index]}`,
      ).toBeGreaterThan(reliabilityForTrustLevel(levels[index - 1]));
    }
  });

  it("never claims certainty", () => {
    expect(reliabilityForTrustLevel(4)).toBeLessThan(1);
  });
});

describe("gatherTrustEvidence", () => {
  it("counts only runs a human actually verified", async () => {
    const runs = [
      { verdict: "correct" },
      { verdict: "correct" },
      { verdict: "wrong" },
      { verdict: null },
      { verdict: null },
    ];
    const db = {
      shadowRun: {
        findMany: async () => runs.filter((run) => run.verdict !== null),
      },
      submissionAttempt: {
        findMany: async () => [] as { outcome: string; verdict: string | null }[],
      },
    } as unknown as PrismaClient;

    const result = await gatherTrustEvidence(db, "GREENHOUSE", false);
    expect(result.verifiedRuns).toBe(3);
    expect(result.correctRuns).toBe(2);
    expect(result.hasAdapter).toBe(true);
  });

  it("reports no adapter for an ATS the registry does not cover", async () => {
    const db = {
      shadowRun: { findMany: async () => [] },
      submissionAttempt: { findMany: async () => [] },
    } as unknown as PrismaClient;

    const result = await gatherTrustEvidence(db, "WORKDAY", false);
    expect(result.hasAdapter).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apply/trust.test.ts`
Expected: FAIL — `Failed to resolve import "./trust"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/apply/trust.ts`:

```ts
/**
 * Adapter trust levels (spec §21).
 *
 * A level is computed from evidence, never stored: the evidence is the
 * ShadowRun verdicts a human has already recorded, plus what past submissions
 * on this ATS actually did. Storing a level would let it drift from the runs
 * that justified it.
 *
 * Two properties are load-bearing:
 *
 *   - Evidence makes an ATS *eligible*; it never *promotes* it. Level 4 needs a
 *     human opt-in on top of the numbers.
 *   - An unverified run is not evidence. A ShadowRun with a null verdict is a
 *     run nobody checked, and it counts for nothing in either direction.
 */

import type { PrismaClient, AtsType } from "@prisma/client";
import { adapterFor } from "./adapters";

/** 0 unsupported, 1 parse, 2 autofill, 3 review+submit, 4 auto-submit. */
export type TrustLevel = 0 | 1 | 2 | 3 | 4;

/** What is known about an ATS's track record. */
export interface TrustEvidence {
  hasAdapter: boolean;
  verifiedRuns: number;
  correctRuns: number;
  confirmedSubmissions: number;
  wrongSubmissions: number;
  /** The explicit manual opt-in. Never set by evidence. */
  autoSubmitOptIn: boolean;
}

export interface TrustThreshold {
  level: TrustLevel;
  minVerifiedRuns: number;
  minCorrectRate: number;
  minConfirmedSubmissions: number;
  requiresOptIn: boolean;
}

/**
 * ASSUMPTION, not yet confirmed by the user. These are the one set of numbers
 * in this feature chosen by the author rather than by the person whose
 * applications are at stake. Deliberately in one place so that changing them is
 * this constant and the table-driven test, nothing else.
 */
export const TRUST_THRESHOLDS: TrustThreshold[] = [
  { level: 1, minVerifiedRuns: 0, minCorrectRate: 0, minConfirmedSubmissions: 0, requiresOptIn: false },
  { level: 2, minVerifiedRuns: 5, minCorrectRate: 0.8, minConfirmedSubmissions: 0, requiresOptIn: false },
  { level: 3, minVerifiedRuns: 10, minCorrectRate: 0.9, minConfirmedSubmissions: 0, requiresOptIn: false },
  { level: 4, minVerifiedRuns: 25, minCorrectRate: 0.95, minConfirmedSubmissions: 10, requiresOptIn: true },
];

/**
 * The share of checked runs that were right, or null if nothing was checked.
 *
 * Null rather than 0 on purpose: zero reads as "always wrong", and "nobody has
 * looked yet" is a different statement.
 */
export function correctRate(evidence: TrustEvidence): number | null {
  if (evidence.verifiedRuns === 0) return null;
  return evidence.correctRuns / evidence.verifiedRuns;
}

function meets(evidence: TrustEvidence, threshold: TrustThreshold): boolean {
  if (threshold.requiresOptIn && !evidence.autoSubmitOptIn) return false;
  if (evidence.verifiedRuns < threshold.minVerifiedRuns) return false;
  if (evidence.confirmedSubmissions < threshold.minConfirmedSubmissions) return false;

  // A wrong submission is disqualifying for auto-submit specifically. A wrong
  // *fill* is already priced into the rate; a wrong *submission* went to a real
  // employer and is not something a percentage should be able to average away.
  if (threshold.level === 4 && evidence.wrongSubmissions > 0) return false;

  if (threshold.minCorrectRate > 0) {
    const rate = correctRate(evidence);
    if (rate === null || rate < threshold.minCorrectRate) return false;
  }

  return true;
}

/** The highest level this ATS's evidence supports. */
export function computeTrustLevel(evidence: TrustEvidence): TrustLevel {
  if (!evidence.hasAdapter) return 0;

  let earned: TrustLevel = 0;
  for (const threshold of TRUST_THRESHOLDS) {
    if (!meets(evidence, threshold)) break;
    earned = threshold.level;
  }
  return earned;
}

/**
 * How much of the confidence score's submission component this level earns
 * (spec §17's last 5%).
 *
 * Replaces the hardcoded SUBMISSION_RELIABILITY map, whose own comment said it
 * could not be a measurement "until an apply worker exists and has actually
 * submitted anything". Level 4 stops short of 1.0 because no adapter is certain.
 */
export function reliabilityForTrustLevel(level: TrustLevel): number {
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 0.25;
    case 2:
      return 0.5;
    case 3:
      return 0.85;
    case 4:
      return 0.95;
  }
}

/**
 * Read this ATS's track record out of the database.
 *
 * The ShadowRun query is the one the @@index([atsType, verdict]) was added for.
 */
export async function gatherTrustEvidence(
  db: PrismaClient,
  atsType: AtsType,
  autoSubmitOptIn: boolean,
): Promise<TrustEvidence> {
  const runs = await db.shadowRun.findMany({
    where: { atsType, verdict: { not: null } },
    select: { verdict: true },
  });

  const attempts = await db.submissionAttempt.findMany({
    where: { atsType },
    select: { outcome: true, verdict: true },
  });

  return {
    hasAdapter: adapterFor(atsType).id !== "generic",
    verifiedRuns: runs.length,
    // Anything that is not exactly "correct" is not a pass. The column is an
    // unconstrained String, so this must not be written as `!== "wrong"`.
    correctRuns: runs.filter((run) => run.verdict === "correct").length,
    confirmedSubmissions: attempts.filter((a) => a.outcome === "submitted").length,
    wrongSubmissions: attempts.filter((a) => a.verdict === "wrong").length,
    autoSubmitOptIn,
  };
}
```

- [ ] **Step 4: Handle the forward dependencies**

This task has a deliberate forward dependency on Tasks 4 and 5 — the ladder is what the rest is calibrated against, so it is written first.

Create a temporary `src/lib/apply/adapters/index.ts`, which Task 4 replaces in full:

```ts
/** Temporary stub — Task 4 replaces this file with the real registry. */
export function adapterFor(atsType: string): { id: string } {
  const known = ["GREENHOUSE", "LEVER", "ASHBY"];
  return { id: known.includes(atsType) ? atsType.toLowerCase() : "generic" };
}
```

For `submissionAttempt`, which does not exist in the generated client until Task 5: comment out that query and use `confirmedSubmissions: 0, wrongSubmissions: 0`, leaving a `// TASK 5: restore` marker. Task 5 restores it as its final step. Do **not** cast the type away.

Run: `npx vitest run src/lib/apply/trust.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply/trust.ts src/lib/apply/trust.test.ts src/lib/apply/adapters/index.ts
git commit -m "Trust ladder: compute an ATS's level from verified runs"
```

---

## Task 2: Confidence takes reliability as a parameter

**Files:**
- Modify: `src/lib/apply/confidence.ts` (delete `SUBMISSION_RELIABILITY` at `:88-101`; change `scoreConfidence` at `:116-120`; add `answeredFromOutcomes`)
- Modify: `src/lib/apply/confidence.test.ts` (the key-set assertion at `:121` and every `scoreConfidence` call)
- Modify: `scripts/preflight.ts:185-189`

**Interfaces:**
- Produces: `scoreConfidence(form: ParsedForm, materials: MaterialsState, reliability: number): ConfidenceResult` — `atsType: string` is **replaced** by `reliability: number`, not added to. Also `answeredFromOutcomes(fields, outcomes): ParsedField[]`.

**Why:** gate 5 needs a confidence number and there isn't one in the apply pipeline. `scoreConfidence` is pure and synchronous and should stay that way, so the trust level is resolved by the caller and passed in as a plain number.

- [ ] **Step 1: Write the failing test**

Remove the `SUBMISSION_RELIABILITY` import at `:13` and its key-set assertion at `:121` from `src/lib/apply/confidence.test.ts`. Update every existing `scoreConfidence(form, materials, "GREENHOUSE")` call to pass a number instead (use `0.9`). Then append:

```ts
describe("scoreConfidence reliability component", () => {
  it("scores the submission component from the reliability it is handed", () => {
    const form: ParsedForm = {
      fields: [{ label: "Full name", required: true, recognized: true, answered: true }],
      unrecognizedFields: 0,
      captcha: false,
      loginRequired: false,
      resumeRequired: false,
      coverLetterRequired: false,
    };
    const materials = { resumeReady: true, coverLetterReady: true };

    const high = scoreConfidence(form, materials, 0.9);
    const low = scoreConfidence(form, materials, 0.2);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("says plainly that an ATS with no adapter cannot be submitted to", () => {
    const form: ParsedForm = {
      fields: [{ label: "Full name", required: true, recognized: true, answered: true }],
      unrecognizedFields: 0,
      captcha: false,
      loginRequired: false,
      resumeRequired: false,
      coverLetterRequired: false,
    };
    const result = scoreConfidence(form, { resumeReady: true, coverLetterReady: true }, 0);
    const submission = result.components.find((c) => c.name === "submission");
    expect(submission?.detail).toContain("No apply adapter");
  });
});

describe("answeredFromOutcomes", () => {
  it("counts a field as answered only when the fill actually resolved it", () => {
    // Preflight has to guess whether a field could be filled. After a run we
    // know. A field the run marked "failed" is not answered, however confident
    // preflight was.
    const fields = [
      { label: "Full name", required: true, recognized: true },
      { label: "Phone", required: true, recognized: true },
      { label: "Why us?", required: true, recognized: false },
    ];
    const outcomes = [
      { label: "Full name", status: "filled" },
      { label: "Phone", status: "failed" },
    ];

    const parsed = answeredFromOutcomes(fields, outcomes);
    expect(parsed.map((field) => field.answered)).toEqual([true, false, false]);
  });

  it("treats every resolved status as answered, not just filled", () => {
    const fields = [
      { label: "Resume", required: true, recognized: true },
      { label: "Start date", required: true, recognized: true },
      { label: "Sponsorship?", required: true, recognized: true },
    ];
    const outcomes = [
      { label: "Resume", status: "attached" },
      { label: "Start date", status: "chosen" },
      { label: "Sponsorship?", status: "answered" },
    ];
    const parsed = answeredFromOutcomes(fields, outcomes);
    expect(parsed.every((field) => field.answered)).toBe(true);
  });
});
```

Add `answeredFromOutcomes` to the imports from `"./confidence"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apply/confidence.test.ts`
Expected: FAIL — `answeredFromOutcomes` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/apply/confidence.ts`, delete the whole `SUBMISSION_RELIABILITY` block (`:88-101`, comment included) and change the signature:

```ts
export function scoreConfidence(
  form: ParsedForm,
  materials: MaterialsState,
  /**
   * How reliable submission is on this ATS, 0-1.
   *
   * Passed in rather than looked up, so this function stays pure and
   * synchronous while the number behind it comes from measured trust
   * (see trust.ts: reliabilityForTrustLevel).
   */
  reliability: number,
): ConfidenceResult {
```

Replace the submission component built at `:181-184` with:

```ts
    {
      name: "submission",
      score: reliability,
      detail:
        reliability === 0
          ? "No apply adapter exists for this ATS."
          : `Adapter reliability ${(reliability * 100).toFixed(0)}%.`,
    },
```

Append to the same file:

```ts
/**
 * Turn a finished run's field outcomes into the `answered` flags the
 * confidence score wants.
 *
 * Preflight has to predict whether a field can be filled. After a run there is
 * nothing to predict: the run either resolved the field or it did not. This is
 * the better input, and it is why the submit gate scores confidence from the
 * run rather than carrying preflight's guess forward.
 */
export function answeredFromOutcomes(
  fields: { label: string; required: boolean; recognized: boolean }[],
  outcomes: { label: string; status: string }[],
): ParsedField[] {
  const RESOLVED = new Set(["filled", "chosen", "attached", "answered"]);
  const resolved = new Set(
    outcomes.filter((outcome) => RESOLVED.has(outcome.status)).map((o) => o.label),
  );

  return fields.map((field) => ({
    label: field.label,
    required: field.required,
    recognized: field.recognized,
    answered: resolved.has(field.label),
  }));
}
```

Update `scripts/preflight.ts:185-189`:

```ts
  const evidence = await gatherTrustEvidence(db, job.atsType, false);
  const confidence = scoreConfidence(
    parsedForm,
    { resumeReady: false, coverLetterReady: false },
    reliabilityForTrustLevel(computeTrustLevel(evidence)),
  );
```

with the import:

```ts
import {
  computeTrustLevel,
  gatherTrustEvidence,
  reliabilityForTrustLevel,
} from "../src/lib/apply/trust";
```

Note: the local variable holding the parsed form in preflight may be named differently — use whatever `scoreConfidence` was already being passed. Do not rename it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/apply/confidence.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply/confidence.ts src/lib/apply/confidence.test.ts scripts/preflight.ts
git commit -m "Score submission reliability from measured trust, not a hardcoded map"
```

---

## Task 3: Local HTTP fixture server

**Files:**
- Create: `src/lib/apply/fixture-server.ts`
- Test: `src/lib/apply/fixture-server.test.ts`

**Interfaces:**
- Produces: `interface RecordedPost { path: string; body: string; contentType: string | null }`; `interface FixtureServer { url: string; posts: RecordedPost[]; close(): Promise<void> }`; `type FixtureKind = "greenhouse" | "lever" | "ashby" | "slow"`; `startFixtureServer(kind: FixtureKind): Promise<FixtureServer>`.

**Why:** this repo's only browser test uses `file://` pages and its header states it does not exercise the guard at all. `file://` origins do not behave like `http://` for same-host comparison or for form POSTs, and the whole point of Tasks 6 and 7 is proving a POST does or does not leave. Test-only: nothing under `src/app` may import it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/apply/fixture-server.test.ts`:

```ts
/**
 * Tests for the local fixture server that the submit tests run against.
 *
 * This is a test of the test harness, which is worth the lines: every claim
 * the submit tests make — "the POST arrived", "the POST was blocked" — is only
 * as trustworthy as this server's recording. If it silently failed to record,
 * a broken guard and a working guard would look identical, and the suite would
 * report success either way.
 *
 * NEVER point any of this at a real employer's form.
 */

import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixtureServer, type FixtureServer } from "./fixture-server";

let server: FixtureServer | null = null;
let browser: Browser | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  await browser?.close().catch(() => undefined);
  browser = null;
});

describe("startFixtureServer", () => {
  it("serves a form on a real http origin", async () => {
    server = await startFixtureServer("greenhouse");
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Submit application");
  });

  it("records a POST with its body, so a test can prove submission happened", async () => {
    server = await startFixtureServer("greenhouse");
    await fetch(`${server.url}/apply`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Ada+Lovelace",
    });

    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].path).toBe("/apply");
    expect(server.posts[0].body).toContain("Ada+Lovelace");
  });

  it("records nothing when only GETs happen", async () => {
    server = await startFixtureServer("lever");
    await fetch(server.url);
    expect(server.posts).toEqual([]);
  });

  it("shows a success page after a real browser submits the form", async () => {
    server = await startFixtureServer("ashby");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/submitted/);

    expect(await page.locator("body").innerText()).toContain("Application submitted");
    expect(server.posts).toHaveLength(1);
  });

  it("gives every ATS fixture a submit control, as the adapters expect", async () => {
    const kinds = ["greenhouse", "lever", "ashby"] as const;
    for (const kind of kinds) {
      const each = await startFixtureServer(kind);
      const html = await (await fetch(each.url)).text();
      expect(html, kind).toContain('type="submit"');
      await each.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apply/fixture-server.test.ts`
Expected: FAIL — `Failed to resolve import "./fixture-server"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/apply/fixture-server.ts`:

```ts
/**
 * A local stand-in for an employer's application form. TEST ONLY.
 *
 * The submit guard's behaviour is the thing this whole feature has to get
 * right, and it cannot be tested against `file://` pages: the guard compares
 * request hosts (shadow.ts's safeHost), and a form POST needs somewhere real to
 * go. So this serves replica Greenhouse/Lever/Ashby markup on 127.0.0.1 and
 * records every POST it receives.
 *
 * Recording is the point. "The application was submitted" and "the guard
 * stopped it" are only distinguishable if something on the other end can say
 * whether the request arrived.
 *
 * Nothing under src/app may import this module.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedPost {
  path: string;
  body: string;
  contentType: string | null;
}

export interface FixtureServer {
  /** Origin, e.g. http://127.0.0.1:53124 */
  url: string;
  /** Every POST this server received, in order. */
  posts: RecordedPost[];
  close(): Promise<void>;
}

export type FixtureKind = "greenhouse" | "lever" | "ashby" | "slow";

/**
 * The three forms differ only in the markup the adapters key off — the submit
 * button and the success marker. The fields are the same because the filling
 * code is generic and is not what these tests exercise.
 */
const FORMS: Record<FixtureKind, string> = {
  greenhouse: `<!doctype html>
<html><body>
  <h1>Apply for this job</h1>
  <form id="application_form" method="POST" action="/apply">
    <label for="first_name">First Name <span>*</span></label>
    <input id="first_name" name="job_application[first_name]" type="text" required />
    <label for="email">Email <span>*</span></label>
    <input id="email" name="job_application[email]" type="email" required />
    <input id="submit_app" type="submit" value="Submit application" />
  </form>
</body></html>`,

  lever: `<!doctype html>
<html><body>
  <h1>Apply for this job</h1>
  <form method="POST" action="/apply" class="application-form">
    <label for="name">Full name<span class="required">*</span></label>
    <input id="name" name="name" type="text" required />
    <label for="email">Email<span class="required">*</span></label>
    <input id="email" name="email" type="email" required />
    <button type="submit" class="template-btn-submit">Submit application</button>
  </form>
</body></html>`,

  ashby: `<!doctype html>
<html><body>
  <h1>Application</h1>
  <form method="POST" action="/apply">
    <label for="_systemfield_name">Name<span>*</span></label>
    <input id="_systemfield_name" name="_systemfield_name" type="text" required />
    <label for="_systemfield_email">Email<span>*</span></label>
    <input id="_systemfield_email" name="_systemfield_email" type="email" required />
    <button type="submit">Submit application</button>
  </form>
</body></html>`,

  // Never responds to the POST. For proving the window closes on its deadline
  // rather than hanging forever.
  slow: `<!doctype html>
<html><body>
  <h1>Apply for this job</h1>
  <form method="POST" action="/slow">
    <label for="first_name">First Name<span>*</span></label>
    <input id="first_name" name="first_name" type="text" required />
    <input id="submit_app" type="submit" value="Submit application" />
  </form>
</body></html>`,
};

const SUCCESS_PAGE = `<!doctype html>
<html><body>
  <h1>Application submitted</h1>
  <p>Thank you for applying. We have received your application.</p>
</body></html>`;

const ERROR_PAGE = `<!doctype html>
<html><body>
  <h1>Application</h1>
  <div role="alert" class="error">This field is required.</div>
  <form method="POST" action="/apply">
    <button type="submit">Submit application</button>
  </form>
</body></html>`;

/**
 * Start a fixture on an ephemeral port.
 *
 * Port 0 rather than a fixed one so tests can run in parallel without
 * colliding, and so a leaked server from a previous run cannot be mistaken for
 * this one.
 */
export async function startFixtureServer(kind: FixtureKind): Promise<FixtureServer> {
  const posts: RecordedPost[] = [];

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];

    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        posts.push({
          path,
          body: Buffer.concat(chunks).toString("utf8"),
          contentType: request.headers["content-type"] ?? null,
        });

        // The slow fixture deliberately never answers, so a test can prove the
        // submit window closes on its own deadline.
        if (kind === "slow") return;

        // 303 so the browser follows with a GET, which is what a real ATS does
        // and what detectSubmitted has to cope with.
        response.writeHead(303, { Location: "/submitted" });
        response.end();
      });
      return;
    }

    if (path.startsWith("/submitted")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(SUCCESS_PAGE);
      return;
    }

    if (path.startsWith("/rejected")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(ERROR_PAGE);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(FORMS[kind]);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    posts,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/apply/fixture-server.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply/fixture-server.ts src/lib/apply/fixture-server.test.ts
git commit -m "Test fixture server: replica ATS forms that record POSTs"
```

---

## Task 4: ATS adapters and registry

**Files:**
- Create: `src/lib/apply/adapters/types.ts`, `greenhouse.ts`, `lever.ts`, `ashby.ts`, `generic.ts`
- Modify: `src/lib/apply/adapters/index.ts` (replace Task 1's stub in full)
- Test: `src/lib/apply/adapters/adapters.test.ts`

**Interfaces:**
- Produces: `interface AtsAdapter { id: string; submitButtons(page: Page): Promise<Locator[]>; detectSubmitted(page: Page): Promise<boolean>; detectError(page: Page): Promise<string | null>; maxTrustLevel: TrustLevel }`; `adapterFor(atsType: string): AtsAdapter`.

**Note on the interface vs. the design doc:** the design wrote `submitButton(page): Locator | null`. It is `submitButtons(page): Promise<Locator[]>` here because gate 6 must distinguish "no button" from "several buttons" — a singular nullable return collapses those two, and "several" is the interesting one: it means the page is not what the adapter thinks it is.

- [ ] **Step 1: Write the failing test**

Create `src/lib/apply/adapters/adapters.test.ts`:

```ts
/**
 * Tests for the per-ATS adapters (spec §22).
 *
 * The adapters own exactly three judgments — which element submits, whether a
 * submission landed, and whether the page is showing an error — and each is a
 * claim about real markup, so each is tested against the replica forms rather
 * than against a mock. A selector that silently matches nothing looks identical
 * to a working one in a unit test with a fake page; here it does not.
 *
 * The count matters as much as the match: gate 6 refuses to submit unless
 * exactly one button resolves, because zero and several both mean the page is
 * not what the adapter believes it is.
 *
 * NEVER point these at a real employer's form.
 */

import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startFixtureServer, type FixtureServer } from "../fixture-server";
import { adapterFor } from "./index";

let server: FixtureServer | null = null;
let browser: Browser | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  await browser?.close().catch(() => undefined);
  browser = null;
});

async function open(kind: "greenhouse" | "lever" | "ashby", path = ""): Promise<Page> {
  server = await startFixtureServer(kind);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${server.url}${path}`);
  return page;
}

describe("adapterFor", () => {
  it("returns the named adapter for each supported ATS", () => {
    expect(adapterFor("GREENHOUSE").id).toBe("greenhouse");
    expect(adapterFor("LEVER").id).toBe("lever");
    expect(adapterFor("ASHBY").id).toBe("ashby");
  });

  it("falls back to generic for everything else", () => {
    expect(adapterFor("WORKDAY").id).toBe("generic");
    expect(adapterFor("ICIMS").id).toBe("generic");
    expect(adapterFor("CUSTOM").id).toBe("generic");
  });

  it("caps the generic adapter below submitting", () => {
    // Level 3 is where submission starts. Generic must never reach it: an
    // unknown ATS is one whose success page we cannot recognise, so we could
    // not tell a sent application from a silently failed one.
    expect(adapterFor("WORKDAY").maxTrustLevel).toBe(2);
  });

  it("lets the three known adapters reach auto-submit at most", () => {
    for (const ats of ["GREENHOUSE", "LEVER", "ASHBY"]) {
      expect(adapterFor(ats).maxTrustLevel, ats).toBe(4);
    }
  });
});

describe("submitButtons", () => {
  it("finds exactly one submit button on the Greenhouse form", async () => {
    const page = await open("greenhouse");
    expect(await adapterFor("GREENHOUSE").submitButtons(page)).toHaveLength(1);
  });

  it("finds exactly one submit button on the Lever form", async () => {
    const page = await open("lever");
    expect(await adapterFor("LEVER").submitButtons(page)).toHaveLength(1);
  });

  it("finds exactly one submit button on the Ashby form", async () => {
    const page = await open("ashby");
    expect(await adapterFor("ASHBY").submitButtons(page)).toHaveLength(1);
  });

  it("finds none on a page that is not an application form", async () => {
    const page = await open("greenhouse", "/submitted");
    expect(await adapterFor("GREENHOUSE").submitButtons(page)).toHaveLength(0);
  });
});

describe("detectSubmitted", () => {
  it("is false while still on the form", async () => {
    const page = await open("greenhouse");
    expect(await adapterFor("GREENHOUSE").detectSubmitted(page)).toBe(false);
  });

  it("is true on the page the form redirects to", async () => {
    const page = await open("lever");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/submitted/);
    expect(await adapterFor("LEVER").detectSubmitted(page)).toBe(true);
  });

  it("is false on an error page, which is not a submission", async () => {
    const page = await open("ashby", "/rejected");
    expect(await adapterFor("ASHBY").detectSubmitted(page)).toBe(false);
  });
});

describe("detectError", () => {
  it("is null on a clean form", async () => {
    const page = await open("greenhouse");
    expect(await adapterFor("GREENHOUSE").detectError(page)).toBeNull();
  });

  it("returns the message the page is showing", async () => {
    const page = await open("greenhouse", "/rejected");
    const error = await adapterFor("GREENHOUSE").detectError(page);
    expect(error).toContain("This field is required");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apply/adapters/adapters.test.ts`
Expected: FAIL — `adapterFor(...).submitButtons is not a function` (Task 1's stub returns only an `id`).

- [ ] **Step 3: Write the implementation**

Create `src/lib/apply/adapters/types.ts`:

```ts
/**
 * What an ATS adapter is responsible for (spec §22).
 *
 * Deliberately narrower than §22 describes. §22 lists a directory per ATS that
 * knows how to detect fields, fill text, select dropdowns, upload documents,
 * answer questions and validate — but all of that already exists in read-form,
 * classify-field, fill-plan and shadow.ts, is generic, and works across all
 * three ATSes. Rewriting working generic code into three near-identical copies
 * to satisfy a directory layout would be churn with real regression risk and no
 * behavioural gain.
 *
 * What is genuinely ATS-specific is narrower: finding the submit button,
 * recognising a successful submission, and recognising an error page.
 */

import type { Locator, Page } from "playwright";
import type { TrustLevel } from "../trust";

export interface AtsAdapter {
  id: string;

  /**
   * Every element that would submit this form.
   *
   * A list rather than a nullable single value because gate 6 has to tell
   * "none" from "several". Both mean the same thing operationally — the page is
   * not what this adapter thinks it is — but they are different bugs, and the
   * attempt row should say which.
   */
  submitButtons(page: Page): Promise<Locator[]>;

  /** Whether this page is the one an ATS shows after a successful submission. */
  detectSubmitted(page: Page): Promise<boolean>;

  /** The error the page is showing, or null. */
  detectError(page: Page): Promise<string | null>;

  /** The ceiling this adapter can reach regardless of evidence. */
  maxTrustLevel: TrustLevel;
}

/** Text an ATS confirmation page shows. Matched case-insensitively. */
export const SUBMITTED_MARKERS = [
  "application submitted",
  "thank you for applying",
  "we have received your application",
];

/** Shared body-text check, used by every adapter that can recognise success. */
export async function bodyMentionsSubmitted(page: Page): Promise<boolean> {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return SUBMITTED_MARKERS.some((marker) => text.includes(marker));
}

/** Shared first-alert reader. */
export async function firstAlertText(
  page: Page,
  selector: string,
): Promise<string | null> {
  const alert = page.locator(selector).first();
  if ((await alert.count()) === 0) return null;
  const text = (await alert.innerText().catch(() => "")).trim();
  return text.length > 0 ? text : null;
}
```

Create `src/lib/apply/adapters/greenhouse.ts`:

```ts
import type { Page, Locator } from "playwright";
import { bodyMentionsSubmitted, firstAlertText, type AtsAdapter } from "./types";

const ERROR_SELECTOR = "[role=alert], .error, .field_with_errors";

export const greenhouseAdapter: AtsAdapter = {
  id: "greenhouse",
  maxTrustLevel: 4,

  async submitButtons(page: Page): Promise<Locator[]> {
    return page
      .locator(
        "#submit_app, form#application_form input[type=submit], " +
          "form#application_form button[type=submit]",
      )
      .all();
  },

  async detectSubmitted(page: Page): Promise<boolean> {
    // An error page can also contain the word "application", so an error being
    // visible disqualifies a success reading before the text is even checked.
    if ((await firstAlertText(page, ERROR_SELECTOR)) !== null) return false;
    return bodyMentionsSubmitted(page);
  },

  async detectError(page: Page): Promise<string | null> {
    return firstAlertText(page, ERROR_SELECTOR);
  },
};
```

Create `src/lib/apply/adapters/lever.ts`:

```ts
import type { Page, Locator } from "playwright";
import { bodyMentionsSubmitted, firstAlertText, type AtsAdapter } from "./types";

const ERROR_SELECTOR = "[role=alert], .error, .application-error";

export const leverAdapter: AtsAdapter = {
  id: "lever",
  maxTrustLevel: 4,

  async submitButtons(page: Page): Promise<Locator[]> {
    return page
      .locator(
        ".template-btn-submit, form.application-form button[type=submit], " +
          "form.application-form input[type=submit]",
      )
      .all();
  },

  async detectSubmitted(page: Page): Promise<boolean> {
    if ((await firstAlertText(page, ERROR_SELECTOR)) !== null) return false;
    return bodyMentionsSubmitted(page);
  },

  async detectError(page: Page): Promise<string | null> {
    return firstAlertText(page, ERROR_SELECTOR);
  },
};
```

Create `src/lib/apply/adapters/ashby.ts`:

```ts
import type { Page, Locator } from "playwright";
import { bodyMentionsSubmitted, firstAlertText, type AtsAdapter } from "./types";

const ERROR_SELECTOR = "[role=alert], .error, [data-error]";

export const ashbyAdapter: AtsAdapter = {
  id: "ashby",
  maxTrustLevel: 4,

  async submitButtons(page: Page): Promise<Locator[]> {
    return page.locator("form button[type=submit], form input[type=submit]").all();
  },

  async detectSubmitted(page: Page): Promise<boolean> {
    if ((await firstAlertText(page, ERROR_SELECTOR)) !== null) return false;
    return bodyMentionsSubmitted(page);
  },

  async detectError(page: Page): Promise<string | null> {
    return firstAlertText(page, ERROR_SELECTOR);
  },
};
```

Create `src/lib/apply/adapters/generic.ts`:

```ts
import type { Page, Locator } from "playwright";
import { firstAlertText, type AtsAdapter } from "./types";

/**
 * The adapter for an ATS nobody has written one for.
 *
 * It can find a submit button well enough to fill and review, but it is capped
 * at trust level 2 and is never eligible to submit. The reason is not caution
 * for its own sake: on an unknown ATS we cannot recognise the confirmation
 * page, so after clicking we would be unable to tell a sent application from a
 * silently failed one — and "we think we applied" is worse than not applying.
 */
export const genericAdapter: AtsAdapter = {
  id: "generic",
  maxTrustLevel: 2,

  async submitButtons(page: Page): Promise<Locator[]> {
    return page.locator("form button[type=submit], form input[type=submit]").all();
  },

  async detectSubmitted(): Promise<boolean> {
    // Not "no" — "cannot know". Since this adapter can never submit, nothing
    // ever calls this in anger, and claiming true would be a lie.
    return false;
  },

  async detectError(page: Page): Promise<string | null> {
    return firstAlertText(page, "[role=alert], .error");
  },
};
```

Replace `src/lib/apply/adapters/index.ts` in full:

```ts
/**
 * The adapter registry.
 *
 * Keyed by the AtsType enum spelling so a job row maps straight to an adapter.
 * Anything not listed gets the generic adapter, which cannot submit — so adding
 * a new ATS to the schema can never accidentally enable submission on it.
 */

import type { AtsAdapter } from "./types";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { ashbyAdapter } from "./ashby";
import { genericAdapter } from "./generic";

const ADAPTERS: Record<string, AtsAdapter> = {
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
};

export function adapterFor(atsType: string): AtsAdapter {
  return ADAPTERS[atsType] ?? genericAdapter;
}

export type { AtsAdapter } from "./types";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/apply/adapters src/lib/apply/trust.test.ts`
Expected: PASS. Task 1's trust tests now run against the real registry.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply/adapters
git commit -m "ATS adapters: submit button, success and error detection only"
```

---

## Task 5: SubmissionAttempt model and queue columns

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/apply/trust.ts` (restore the query stubbed in Task 1)

**Why the queue columns:** the daemon's queue is `let queue: Promise<unknown>` in memory, `shutdown()` does not drain it, and accepted work is silently lost on restart. For a shadow run that is annoying. For a submission it is the difference between "never sent" and "may have been sent twice", and nothing currently records which.

- [ ] **Step 1: Write the schema**

In `model Application`, after `failureReason String?`:

```prisma
  /// Worker lease. Set while a worker holds this row, cleared when it lets go.
  /// A restart leaves a stale lease behind on purpose — a row locked by a dead
  /// worker is a row whose fate is unknown, and it should be looked at rather
  /// than silently retried.
  lockedAt DateTime?
  lockedBy String?

  /// How many times a worker has picked this row up. Not the same as how many
  /// times it was submitted, which is SubmissionAttempt's business.
  attemptCount Int @default(0)

  /// Earliest a worker may try again after a recoverable failure.
  nextAttemptAt DateTime?

  submissionAttempts SubmissionAttempt[]
```

In `model Job`, beside `shadowRuns ShadowRun[]`: `submissionAttempts SubmissionAttempt[]`
In `model Candidate`, beside `shadowRuns ShadowRun[]`: `submissionAttempts SubmissionAttempt[]`

After `model ShadowRun`, add:

```prisma
/// One attempt to actually send an application (spec §21-23).
///
/// Deliberately not an extension of ShadowRun. A shadow run is by definition a
/// run that did not submit; overloading it would make "how many applications
/// did we actually send" an unanswerable question, and that is the one question
/// this table exists to answer.
model SubmissionAttempt {
  id String @id @default(cuid())

  applicationId String
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  jobId String
  job   Job    @relation(fields: [jobId], references: [id], onDelete: Cascade)

  candidateId String
  candidate   Candidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  url       String
  atsType   AtsType
  adapterId String

  /// Who authorized this, and when. Never a boolean defaulting to true.
  authorizationKind  String
  authorizationActor String
  authorizedAt       DateTime

  trustLevel Int
  confidence Int?

  /// Every gate's name, pass/fail and detail, as evaluated immediately before
  /// the lift. Stored whole so a refusal can be explained months later.
  gates Json

  /// The first gate that failed, when outcome is "refused".
  refusedGate String?

  /// Every request that passed through the lifted window, verbatim.
  requests String[]

  /// "submitted" | "refused" | "unconfirmed" | "error"
  outcome      String
  adapterError String?

  screenshotPath String?

  /// "correct" | "wrong", once a human has checked. Null until then — same
  /// rule as ShadowRun: unverified is not evidence.
  verdict     String?
  verdictNote String?
  verifiedAt  DateTime?

  startedAt  DateTime  @default(now())
  finishedAt DateTime?

  @@index([applicationId])
  @@index([atsType, outcome])
}
```

- [ ] **Step 2: Create and apply the migration**

Stop the dev server first — `prisma generate` fails EPERM while it holds the query engine DLL.

Run: `npm run db:migrate -- --name apply_workers`
Expected: a new `prisma/migrations/<timestamp>_apply_workers/migration.sql`, applied, client regenerated.

If no database is reachable, run `npx prisma generate` so the client types exist, and note that the migration still needs applying.

- [ ] **Step 3: Restore the trust query**

In `src/lib/apply/trust.ts`, uncomment the `submissionAttempt.findMany` call marked `// TASK 5: restore` and put back the real counts:

```ts
    confirmedSubmissions: attempts.filter((a) => a.outcome === "submitted").length,
    wrongSubmissions: attempts.filter((a) => a.verdict === "wrong").length,
```

- [ ] **Step 4: Run typecheck and the suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/apply/trust.ts
git commit -m "SubmissionAttempt table and worker lease columns"
```

---

## Task 6: The submit window in shadow.ts

**Files:**
- Modify: `src/lib/apply/shadow.ts` (route handler `:211-243`; options type `:118-182`; after the result is built at `:383`)
- Test: `src/lib/apply/submit-window.test.ts`

**Interfaces:**
- Produces: `interface SubmitWindowResult<T> { value: T; requests: string[] }`; `interface FilledHandle { page: Page; result: ShadowRunResult; openSubmitWindow<T>(ms: number, body: () => Promise<T>): Promise<SubmitWindowResult<T>> }`; the `onFilled?: (handle: FilledHandle) => Promise<void>` option.

**The safety argument this task must preserve:** a defect anywhere in the ~1,100 lines of filling logic cannot cause an application to be sent. It holds today because the guard is armed unconditionally during the fill. It holds after this task because `onFilled` runs strictly after the fill has completed and the result object is built, and because the window is a time-bounded, same-host exception that closes in a `finally` — modelled on the existing `uploadWindow`, not on handoff's one-way `unroute`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/apply/submit-window.test.ts`:

```ts
/**
 * Tests for the bounded submit window in shadow.ts.
 *
 * This is the most important test file in the feature. The guard is the only
 * thing standing between a filling bug and a real application landing in a real
 * employer's inbox, and the window is the single hole deliberately cut in it.
 * So what is proved here is not "submission works" but the shape of the hole:
 * it is shut unless explicitly opened, it only admits the form's own host, it
 * shuts again by itself, and it shuts even when the body throws.
 *
 * A suite that only proved a POST can get through would pass just as happily
 * with the guard deleted entirely. That is why every test here has a negative
 * twin.
 *
 * NEVER point any of this at a real employer's form.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShadowApply } from "./shadow";
import { startFixtureServer, type FixtureServer } from "./fixture-server";

let server: FixtureServer | null = null;
let shots: string | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (shots) rmSync(shots, { recursive: true, force: true });
  shots = null;
});

/** A profile with enough in it to fill the fixture forms. */
const PROFILE = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: null,
  address: null,
  school: null,
  degree: null,
  graduationDate: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
};

function screenshotPath(): string {
  shots = mkdtempSync(join(tmpdir(), "autopilot-submit-window-"));
  return join(shots, "shot.png");
}

describe("the submit guard, with no window opened", () => {
  it("blocks the POST when onFilled clicks submit without opening a window", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        // Exactly the mistake the guard exists to survive: something clicks
        // submit on the filled page without authorization.
        await handle.page.click("#submit_app").catch(() => undefined);
        await handle.page.waitForTimeout(500);
      },
    });

    expect(fixture.posts).toHaveLength(0);
  }, 60_000);

  it("blocks the POST when nothing touches the page at all", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
    });

    expect(fixture.posts).toHaveLength(0);
  }, 60_000);
});

describe("openSubmitWindow", () => {
  it("lets the form's own POST through while it is open", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        await handle.openSubmitWindow(5_000, async () => {
          await handle.page.click("#submit_app");
          await handle.page.waitForURL(/\/submitted/, { timeout: 4_000 });
        });
      },
    });

    expect(fixture.posts).toHaveLength(1);
    expect(fixture.posts[0].path).toBe("/apply");
  }, 60_000);

  it("records every request that passed through the window", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    let recorded: string[] = [];

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        const outcome = await handle.openSubmitWindow(5_000, async () => {
          await handle.page.click("#submit_app");
          await handle.page.waitForURL(/\/submitted/, { timeout: 4_000 });
        });
        recorded = outcome.requests;
      },
    });

    expect(recorded.some((line) => line.startsWith("POST "))).toBe(true);
    expect(recorded.some((line) => line.includes("/apply"))).toBe(true);
  }, 60_000);

  it("closes again when the body returns, so a later POST is blocked", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        await handle.openSubmitWindow(5_000, async () => {
          // Open and shut without submitting.
        });
        // Now the window is closed. This click must not get through.
        await handle.page.click("#submit_app").catch(() => undefined);
        await handle.page.waitForTimeout(500);
      },
    });

    expect(fixture.posts).toHaveLength(0);
  }, 60_000);

  it("closes even when the body throws", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        await handle
          .openSubmitWindow(5_000, async () => {
            throw new Error("adapter blew up mid-submit");
          })
          .catch(() => undefined);

        await handle.page.click("#submit_app").catch(() => undefined);
        await handle.page.waitForTimeout(500);
      },
    });

    expect(fixture.posts).toHaveLength(0);
  }, 60_000);

  it("stops admitting requests once the deadline passes", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        await handle.openSubmitWindow(300, async () => {
          // Outlast the window, then submit. The deadline is a wall clock, not
          // a promise boundary, so this must be refused.
          await handle.page.waitForTimeout(800);
          await handle.page.click("#submit_app").catch(() => undefined);
          await handle.page.waitForTimeout(400);
        });
      },
    });

    expect(fixture.posts).toHaveLength(0);
  }, 60_000);

  it("admits the form's host only, never a third party", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    const other = await startFixtureServer("lever");

    try {
      await runShadowApply({
        url: fixture.url,
        profile: PROFILE,
        answers: [],
        screenshotPath: screenshotPath(),
        onFilled: async (handle) => {
          await handle.openSubmitWindow(5_000, async () => {
            // An analytics beacon to a different origin during the window.
            await handle.page
              .evaluate(
                (target) =>
                  fetch(`${target}/apply`, { method: "POST", body: "tracked" }).catch(
                    () => undefined,
                  ),
                other.url,
              )
              .catch(() => undefined);
            await handle.page.waitForTimeout(500);
          });
        },
      });

      expect(other.posts).toHaveLength(0);
    } finally {
      await other.close();
    }
  }, 60_000);
});

describe("onFilled", () => {
  it("runs only after filling has finished", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    let nameAtCallback: string | null = null;

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        nameAtCallback = await handle.page.inputValue("#first_name");
      },
    });

    expect(nameAtCallback).not.toBe("");
    expect(nameAtCallback).not.toBeNull();
  }, 60_000);

  it("hands over the same result the run returns", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    let seenUrl: string | null = null;

    const result = await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: screenshotPath(),
      onFilled: async (handle) => {
        seenUrl = handle.result.url;
      },
    });

    expect(seenUrl).toBe(result.url);
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apply/submit-window.test.ts`
Expected: FAIL — `onFilled` is not a known property of the options object.

- [ ] **Step 3: Write the implementation**

In `src/lib/apply/shadow.ts`, add the exported types after `ShadowRunResult` (`:110`):

```ts
/** What came of a bounded submit window. */
export interface SubmitWindowResult<T> {
  value: T;
  /** Every request the window admitted, verbatim, in order. */
  requests: string[];
}

/**
 * The filled page, handed to onFilled after the run is otherwise complete.
 *
 * openSubmitWindow is the only way anything outside this file can cause a
 * non-GET request to leave the browser, and it is a closure over this run's
 * context — so the guard never leaves the file that documents it, and a caller
 * cannot hold onto the ability to lift it.
 */
export interface FilledHandle {
  page: Page;
  result: ShadowRunResult;
  openSubmitWindow<T>(
    ms: number,
    body: () => Promise<T>,
  ): Promise<SubmitWindowResult<T>>;
}
```

Add the option beside `handoff?: boolean` (`:144`):

```ts
  /**
   * Called once filling is finished and the result is built, with the page
   * still live.
   *
   * This is the seam the submit phase runs in. It deliberately cannot be
   * reached before the fill completes: a defect in the filling logic must not
   * be able to reach the one routine that can open the guard.
   */
  onFilled?: (handle: FilledHandle) => Promise<void>;
```

Add the window state beside `uploadWindow` (`:206`):

```ts
  /**
   * When open, same-host non-GET requests are admitted until this deadline.
   *
   * Modelled on uploadWindow directly above rather than on handoff's
   * `context.unroute`: keeping one permanently-installed route handler that
   * consults a variable means re-arming is automatic and cannot be forgotten,
   * which is exactly the failure mode a one-way unroute invites.
   */
  let submitWindow: { until: number } | null = null;
  const submittedRequests: string[] = [];
```

In the route handler, insert between the upload exception (`:234-237`) and the blocked bookkeeping (`:239`):

```ts
    if (submitWindow && sameHost && Date.now() < submitWindow.until) {
      submittedRequests.push(`${request.method()} ${request.url()}`);
      return route.continue();
    }
```

After the `result` object is constructed (`:383`) and **before** the `if (options.handoff)` branch (`:385`):

```ts
    if (options.onFilled) {
      await options.onFilled({
        page,
        result,
        openSubmitWindow: async (ms, body) => {
          const from = submittedRequests.length;
          submitWindow = { until: Date.now() + ms };
          try {
            const value = await body();
            return { value, requests: submittedRequests.slice(from) };
          } finally {
            // Unconditional: a throw inside the body must not leave the guard
            // open for whatever runs next.
            submitWindow = null;
          }
        },
      });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/apply/submit-window.test.ts`
Expected: PASS, 10 tests — including all five negatives.

Then: `npm test`
Expected: PASS, existing tests plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply/shadow.ts src/lib/apply/submit-window.test.ts
git commit -m "A bounded, same-host submit window in the guard"
```

---

## Task 7: The submit phase

**Files:**
- Create: `src/lib/apply/submit.ts`
- Test: `src/lib/apply/submit.test.ts`

**Interfaces:**
- Produces: `type GateName`; `interface GateOutcome`; `interface Authorization`; `interface GateInput`; `interface SubmitParams`; `interface SubmitOutcome`; `evaluateGates(input: GateInput): Promise<GateOutcome[]>`; `submitFilledApplication(handle: FilledHandle, params: SubmitParams): Promise<SubmitOutcome>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/apply/submit.test.ts`:

```ts
/**
 * Tests for the submit phase's gates and outcome detection (spec §21-23).
 *
 * The gates are re-evaluated immediately before the window opens, never
 * earlier, because a gate checked thirty seconds ago is a statement about a
 * page that no longer exists. What is pinned down here is that every gate can
 * actually refuse — each one gets a test that fails it alone and asserts no
 * POST left the browser — and that a refusal is recorded rather than silently
 * dropped, since an application that quietly did not go out is as bad as one
 * that quietly did.
 *
 * NEVER point any of this at a real employer's form.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShadowApply } from "./shadow";
import { startFixtureServer, type FixtureServer } from "./fixture-server";
import { evaluateGates, submitFilledApplication, type Authorization } from "./submit";
import { adapterFor } from "./adapters";

let server: FixtureServer | null = null;
let shots: string | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (shots) rmSync(shots, { recursive: true, force: true });
  shots = null;
});

const PROFILE = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: null,
  address: null,
  school: null,
  degree: null,
  graduationDate: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
};

const AUTHORIZED: Authorization = {
  kind: "human-approval",
  actor: "ada@example.com",
  at: new Date("2026-09-15T12:00:00Z"),
};

function screenshotPath(): string {
  shots = mkdtempSync(join(tmpdir(), "autopilot-submit-"));
  return join(shots, "shot.png");
}

/** Gate input for a run where everything is fine. */
function cleanInput() {
  return {
    result: {
      url: "http://127.0.0.1/x",
      outcomes: [
        { label: "First Name", status: "filled", detail: "", source: "profile" },
      ],
      blockingGaps: [] as string[],
      screenshotPath: "",
      captcha: false,
      loginRequired: false,
      blockedSubmissions: [] as string[],
      blockedTrackers: 0,
      allowedUploads: [] as string[],
    },
    confidence: 95,
    minimumConfidence: 70,
    submitButtonCount: 1,
    authorization: AUTHORIZED as Authorization | null,
  };
}

describe("evaluateGates", () => {
  it("passes every gate on a clean run", async () => {
    const gates = await evaluateGates(cleanInput() as never);
    expect(gates.every((gate) => gate.passed)).toBe(true);
    expect(gates).toHaveLength(7);
  });

  it("fails on a blocking gap", async () => {
    const input = cleanInput();
    input.result.blockingGaps = ["Why do you want to work here?"];
    const gates = await evaluateGates(input as never);
    const gap = gates.find((gate) => gate.gate === "blocking-gaps");
    expect(gap?.passed).toBe(false);
    expect(gap?.detail).toContain("Why do you want to work here?");
  });

  it("fails on a CAPTCHA", async () => {
    const input = cleanInput();
    input.result.captcha = true;
    const gates = await evaluateGates(input as never);
    expect(gates.find((gate) => gate.gate === "captcha")?.passed).toBe(false);
  });

  it("fails on a login wall", async () => {
    const input = cleanInput();
    input.result.loginRequired = true;
    const gates = await evaluateGates(input as never);
    expect(gates.find((gate) => gate.gate === "login-wall")?.passed).toBe(false);
  });

  it("fails when any field failed, even one nothing required", async () => {
    // A failed field means the page did not do what the filler believed it
    // did, which is a statement about the page, not about that one field.
    const input = cleanInput();
    input.result.outcomes.push({
      label: "Phone",
      status: "failed",
      detail: "timeout",
      source: "profile",
    });
    const gates = await evaluateGates(input as never);
    expect(gates.find((gate) => gate.gate === "failed-fields")?.passed).toBe(false);
  });

  it("fails below the confidence minimum", async () => {
    const input = cleanInput();
    input.confidence = 60;
    const gates = await evaluateGates(input as never);
    const confidence = gates.find((gate) => gate.gate === "confidence");
    expect(confidence?.passed).toBe(false);
    expect(confidence?.detail).toContain("60");
  });

  it("fails when no submit button resolves", async () => {
    const input = cleanInput();
    input.submitButtonCount = 0;
    const gates = await evaluateGates(input as never);
    expect(gates.find((gate) => gate.gate === "submit-button")?.passed).toBe(false);
  });

  it("fails when several submit buttons resolve", async () => {
    // Several means the page is not what the adapter thinks it is, which is
    // exactly as disqualifying as none.
    const input = cleanInput();
    input.submitButtonCount = 3;
    const gates = await evaluateGates(input as never);
    const button = gates.find((gate) => gate.gate === "submit-button");
    expect(button?.passed).toBe(false);
    expect(button?.detail).toContain("3");
  });

  it("fails with no authorization record", async () => {
    const input = cleanInput();
    input.authorization = null;
    const gates = await evaluateGates(input as never);
    expect(gates.find((gate) => gate.gate === "authorization")?.passed).toBe(false);
  });

  it("names who authorized it when one is supplied", async () => {
    const gates = await evaluateGates(cleanInput() as never);
    expect(gates.find((gate) => gate.gate === "authorization")?.detail).toContain(
      "ada@example.com",
    );
  });
});

describe("submitFilledApplication", () => {
  it("submits and confirms on a clean run", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    let outcome: Awaited<ReturnType<typeof submitFilledApplication>> | null = null;
    const shot = screenshotPath();

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: shot,
      onFilled: async (handle) => {
        outcome = await submitFilledApplication(handle, {
          adapter: adapterFor("GREENHOUSE"),
          authorization: AUTHORIZED,
          confidence: 95,
          minimumConfidence: 70,
          trustLevel: 3,
          windowMs: 8_000,
          screenshotPath: `${shot}.after.png`,
        });
      },
    });

    expect(fixture.posts).toHaveLength(1);
    expect(outcome!.outcome).toBe("submitted");
    expect(outcome!.requests.some((line) => line.startsWith("POST "))).toBe(true);
    expect(outcome!.refusedGate).toBeNull();
  }, 60_000);

  it("refuses, and sends nothing, when a gate fails", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    let outcome: Awaited<ReturnType<typeof submitFilledApplication>> | null = null;
    const shot = screenshotPath();

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: shot,
      onFilled: async (handle) => {
        outcome = await submitFilledApplication(handle, {
          adapter: adapterFor("GREENHOUSE"),
          // The gate that is the whole point: no authorization, no submission.
          authorization: null,
          confidence: 95,
          minimumConfidence: 70,
          trustLevel: 3,
          windowMs: 8_000,
          screenshotPath: `${shot}.after.png`,
        });
      },
    });

    expect(fixture.posts).toHaveLength(0);
    expect(outcome!.outcome).toBe("refused");
    expect(outcome!.refusedGate).toBe("authorization");
    expect(outcome!.requests).toEqual([]);
  }, 60_000);

  it("refuses below the confidence minimum and says so", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    let outcome: Awaited<ReturnType<typeof submitFilledApplication>> | null = null;
    const shot = screenshotPath();

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: shot,
      onFilled: async (handle) => {
        outcome = await submitFilledApplication(handle, {
          adapter: adapterFor("GREENHOUSE"),
          authorization: AUTHORIZED,
          confidence: 30,
          minimumConfidence: 70,
          trustLevel: 3,
          windowMs: 8_000,
          screenshotPath: `${shot}.after.png`,
        });
      },
    });

    expect(fixture.posts).toHaveLength(0);
    expect(outcome!.refusedGate).toBe("confidence");
  }, 60_000);

  it("never submits on an adapter that cannot reach level 3", async () => {
    server = await startFixtureServer("greenhouse");
    const fixture = server;
    let outcome: Awaited<ReturnType<typeof submitFilledApplication>> | null = null;
    const shot = screenshotPath();

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: shot,
      onFilled: async (handle) => {
        outcome = await submitFilledApplication(handle, {
          // Generic caps at 2. Even with a perfect run and a real approval,
          // this must refuse — we could not recognise the outcome.
          adapter: adapterFor("WORKDAY"),
          authorization: AUTHORIZED,
          confidence: 99,
          minimumConfidence: 70,
          trustLevel: 3,
          windowMs: 8_000,
          screenshotPath: `${shot}.after.png`,
        });
      },
    });

    expect(fixture.posts).toHaveLength(0);
    expect(outcome!.outcome).toBe("refused");
    expect(outcome!.refusedGate).toBe("trust-level");
  }, 60_000);

  it("reports unconfirmed, not submitted, when the POST goes out but nothing confirms", async () => {
    // The honest outcome for "we sent it and do not know what happened". It
    // must not be recorded as a success: trust levels are built from these.
    server = await startFixtureServer("slow");
    const fixture = server;
    let outcome: Awaited<ReturnType<typeof submitFilledApplication>> | null = null;
    const shot = screenshotPath();

    await runShadowApply({
      url: fixture.url,
      profile: PROFILE,
      answers: [],
      screenshotPath: shot,
      onFilled: async (handle) => {
        outcome = await submitFilledApplication(handle, {
          adapter: adapterFor("GREENHOUSE"),
          authorization: AUTHORIZED,
          confidence: 95,
          minimumConfidence: 70,
          trustLevel: 3,
          windowMs: 2_000,
          screenshotPath: `${shot}.after.png`,
        });
      },
    });

    expect(fixture.posts).toHaveLength(1);
    expect(outcome!.outcome).toBe("unconfirmed");
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apply/submit.test.ts`
Expected: FAIL — `Failed to resolve import "./submit"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/apply/submit.ts`:

```ts
/**
 * The submit phase (spec §21-23).
 *
 * This module decides *whether* to submit and works out what happened. It
 * cannot lift the guard: the only thing it can do is call the openSubmitWindow
 * closure it is handed, which lives in shadow.ts and is scoped to the form's
 * own host and a deadline. That split is deliberate — the guard stays in the
 * file that documents it, and the routine that fills never becomes the routine
 * that submits.
 */

import type { AtsAdapter } from "./adapters";
import type { FilledHandle, ShadowRunResult } from "./shadow";
import type { TrustLevel } from "./trust";

export type GateName =
  | "blocking-gaps"
  | "captcha"
  | "login-wall"
  | "failed-fields"
  | "confidence"
  | "submit-button"
  | "authorization"
  | "trust-level";

export interface GateOutcome {
  gate: GateName;
  passed: boolean;
  detail: string;
}

/**
 * Who authorized this submission, and when.
 *
 * A value, never a boolean defaulting to true: "allowed" has to be something
 * somebody produced, attributable after the fact, and it is written to the
 * attempt row exactly as given.
 */
export interface Authorization {
  kind: "human-approval" | "auto-submit-opt-in";
  actor: string;
  at: Date;
  note?: string;
}

export interface GateInput {
  result: ShadowRunResult;
  confidence: number;
  minimumConfidence: number;
  submitButtonCount: number;
  authorization: Authorization | null;
}

/**
 * Evaluate every gate.
 *
 * All of them, not short-circuiting at the first failure, so a refusal can show
 * the whole picture rather than one reason per retry — the same choice
 * decideAutoApply makes for its blocking rules.
 */
export async function evaluateGates(input: GateInput): Promise<GateOutcome[]> {
  const failed = input.result.outcomes.filter((outcome) => outcome.status === "failed");

  return [
    {
      gate: "blocking-gaps",
      passed: input.result.blockingGaps.length === 0,
      detail:
        input.result.blockingGaps.length === 0
          ? "Every required field is filled."
          : `Required fields left empty: ${input.result.blockingGaps.join(", ")}.`,
    },
    {
      gate: "captcha",
      passed: !input.result.captcha,
      detail: input.result.captcha ? "A CAPTCHA is on the page." : "No CAPTCHA.",
    },
    {
      gate: "login-wall",
      passed: !input.result.loginRequired,
      detail: input.result.loginRequired
        ? "The form is behind a login."
        : "No login wall.",
    },
    {
      gate: "failed-fields",
      passed: failed.length === 0,
      detail:
        failed.length === 0
          ? "No field failed to fill."
          : `${failed.length} field(s) failed: ${failed.map((f) => f.label).join(", ")}.`,
    },
    {
      gate: "confidence",
      passed: input.confidence >= input.minimumConfidence,
      detail: `Confidence ${input.confidence} against a minimum of ${input.minimumConfidence}.`,
    },
    {
      gate: "submit-button",
      passed: input.submitButtonCount === 1,
      detail:
        input.submitButtonCount === 1
          ? "Exactly one submit button."
          : `${input.submitButtonCount} submit buttons resolved — the page is not what the adapter expects.`,
    },
    {
      gate: "authorization",
      passed: input.authorization !== null,
      detail: input.authorization
        ? `Authorized by ${input.authorization.actor} (${input.authorization.kind}) at ${input.authorization.at.toISOString()}.`
        : "No authorization record was supplied.",
    },
  ];
}

export interface SubmitParams {
  adapter: AtsAdapter;
  authorization: Authorization | null;
  confidence: number;
  minimumConfidence: number;
  trustLevel: TrustLevel;
  /** How long the guard stays open. A real submit is an XHR plus a redirect. */
  windowMs: number;
  /** Where to put the post-submit screenshot. */
  screenshotPath: string;
}

export interface SubmitOutcome {
  /** "submitted" | "refused" | "unconfirmed" | "error" */
  outcome: string;
  gates: GateOutcome[];
  refusedGate: GateName | null;
  requests: string[];
  adapterError: string | null;
  screenshotPath: string | null;
  adapterId: string;
}

/** The level at which submission becomes possible at all. */
const SUBMIT_LEVEL = 3;

/**
 * Submit a filled application, if every gate agrees.
 *
 * The gates are evaluated here rather than by the caller, immediately before
 * the window opens, because the form may have changed under us: a gate checked
 * thirty seconds ago is a statement about a page that no longer exists.
 */
export async function submitFilledApplication(
  handle: FilledHandle,
  params: SubmitParams,
): Promise<SubmitOutcome> {
  const base = {
    gates: [] as GateOutcome[],
    refusedGate: null as GateName | null,
    requests: [] as string[],
    adapterError: null as string | null,
    screenshotPath: null as string | null,
    adapterId: params.adapter.id,
  };

  // Checked before anything else and outside the gate list, because an adapter
  // that cannot recognise its own success page must not be allowed to click
  // even once: we would not be able to say afterwards whether an application
  // went out.
  if (params.adapter.maxTrustLevel < SUBMIT_LEVEL || params.trustLevel < SUBMIT_LEVEL) {
    return {
      ...base,
      outcome: "refused",
      refusedGate: "trust-level",
      gates: [
        {
          gate: "trust-level",
          passed: false,
          detail:
            `Trust level ${params.trustLevel} on an adapter capped at ` +
            `${params.adapter.maxTrustLevel}; submission needs ${SUBMIT_LEVEL}.`,
        },
      ],
    };
  }

  const buttons = await params.adapter.submitButtons(handle.page);

  const gates = await evaluateGates({
    result: handle.result,
    confidence: params.confidence,
    minimumConfidence: params.minimumConfidence,
    submitButtonCount: buttons.length,
    authorization: params.authorization,
  });

  const firstFailure = gates.find((gate) => !gate.passed);
  if (firstFailure) {
    return { ...base, outcome: "refused", gates, refusedGate: firstFailure.gate };
  }

  try {
    const window = await handle.openSubmitWindow(params.windowMs, async () => {
      await buttons[0].click();

      // Poll rather than wait for one navigation: a real submit is an XHR, a
      // redirect, and sometimes several more, and which lands last varies.
      const deadline = Date.now() + params.windowMs;
      while (Date.now() < deadline) {
        if (await params.adapter.detectSubmitted(handle.page).catch(() => false)) {
          return true;
        }
        await handle.page.waitForTimeout(250);
      }
      return false;
    });

    // Screenshot either way — an unconfirmed submission is exactly the case
    // where a human needs to see what the page looked like.
    await handle.page
      .screenshot({ path: params.screenshotPath, fullPage: true })
      .catch(() => undefined);

    const adapterError = await params.adapter.detectError(handle.page).catch(() => null);

    return {
      ...base,
      gates,
      requests: window.requests,
      adapterError,
      screenshotPath: params.screenshotPath,
      // "unconfirmed" rather than "submitted" when nothing confirmed it. The
      // trust ladder is built from these counts, so a hopeful reading here
      // would inflate the evidence that unlocks auto-submit.
      outcome: window.value ? "submitted" : "unconfirmed",
    };
  } catch (error) {
    await handle.page
      .screenshot({ path: params.screenshotPath, fullPage: true })
      .catch(() => undefined);

    return {
      ...base,
      gates,
      outcome: "error",
      adapterError: error instanceof Error ? error.message : String(error),
      screenshotPath: params.screenshotPath,
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/apply/submit.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply/submit.ts src/lib/apply/submit.test.ts
git commit -m "Submit phase: gates evaluated at the moment of the lift"
```

---

## Task 8: One home for the auto-apply rules

**Files:**
- Create: `src/lib/autoapply/load-rules.ts`
- Test: `src/lib/autoapply/load-rules.test.ts`
- Modify: `src/app/settings/page.tsx:60-64` (NOT `scripts/preflight.ts` — Task 2 owns that file)

**Interfaces:**
- Produces: `loadAutoApplyRules(db: PrismaClient, candidateId: string): Promise<AutoApplyRules>`.

**Why:** the `CandidatePreferences` → `AutoApplyRules` mapping is duplicated and the two copies disagree — `preflight.ts:213-218` spreads `atsModes` in, `settings/page.tsx:60-64` does not. The worker is about to become the third caller, and it is the one where getting `atsModes` wrong means submitting on an ATS the user set to `DISABLED`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/autoapply/load-rules.test.ts`:

```ts
/**
 * Tests for the single loader that turns a CandidatePreferences row into
 * AutoApplyRules.
 *
 * This exists because the mapping used to be written out twice, and the two
 * copies disagreed: one spread atsModes into the rules and one did not. The
 * consequence of the wrong one reaching the apply worker is submitting on an
 * ATS the person had switched off, so the thing worth pinning down is that
 * atsModes survives the trip and that a missing row means defaults rather than
 * a crash.
 */

import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { loadAutoApplyRules } from "./load-rules";
import { DEFAULT_RULES } from "./rules";

function fakeDb(row: unknown) {
  return {
    candidatePreferences: { findUnique: async () => row },
  } as unknown as PrismaClient;
}

describe("loadAutoApplyRules", () => {
  it("falls back to the defaults when the candidate has no preferences row", async () => {
    const rules = await loadAutoApplyRules(fakeDb(null), "candidate-1");
    expect(rules).toEqual(DEFAULT_RULES);
  });

  it("carries atsModes through, which the duplicated copy used to drop", async () => {
    const rules = await loadAutoApplyRules(
      fakeDb({
        minimumFitScore: 70,
        minimumApplicationConfidence: 80,
        maximumPostingAgeHours: 48,
        dailyApplicationLimit: 10,
        maxApplicationsPerCompany: 2,
        atsAutoApplyModes: { GREENHOUSE: "REVIEW", LEVER: "AUTO" },
      }),
      "candidate-1",
    );

    expect(rules.atsModes).toEqual({ GREENHOUSE: "REVIEW", LEVER: "AUTO" });
    expect(rules.minimumApplicationConfidence).toBe(80);
  });

  it("drops modes that are not one of the three legal values", async () => {
    const rules = await loadAutoApplyRules(
      fakeDb({
        minimumFitScore: 0,
        minimumApplicationConfidence: 0,
        maximumPostingAgeHours: 72,
        dailyApplicationLimit: 25,
        maxApplicationsPerCompany: 3,
        atsAutoApplyModes: { GREENHOUSE: "YOLO", LEVER: "AUTO" },
      }),
      "candidate-1",
    );

    expect(rules.atsModes).toEqual({ LEVER: "AUTO" });
  });

  it("treats a null atsAutoApplyModes as no modes, not a crash", async () => {
    const rules = await loadAutoApplyRules(
      fakeDb({
        minimumFitScore: 0,
        minimumApplicationConfidence: 0,
        maximumPostingAgeHours: 72,
        dailyApplicationLimit: 25,
        maxApplicationsPerCompany: 3,
        atsAutoApplyModes: null,
      }),
      "candidate-1",
    );

    expect(rules.atsModes).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/autoapply/load-rules.test.ts`
Expected: FAIL — `Failed to resolve import "./load-rules"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/autoapply/load-rules.ts`:

```ts
/**
 * The one place a CandidatePreferences row becomes AutoApplyRules.
 *
 * It was written out twice before, in preflight and in the settings page, and
 * the copies had drifted — one spread atsModes in and one did not. With a
 * worker about to act on these rules rather than just print them, a dropped
 * atsModes would mean applying on an ATS somebody had switched off.
 */

import type { PrismaClient } from "@prisma/client";
import { DEFAULT_RULES, readAtsModes, type AutoApplyRules } from "./rules";

export async function loadAutoApplyRules(
  db: PrismaClient,
  candidateId: string,
): Promise<AutoApplyRules> {
  const stored = await db.candidatePreferences.findUnique({ where: { candidateId } });
  if (!stored) return DEFAULT_RULES;

  return {
    minimumFitScore: stored.minimumFitScore,
    minimumApplicationConfidence: stored.minimumApplicationConfidence,
    maximumPostingAgeHours: stored.maximumPostingAgeHours,
    dailyApplicationLimit: stored.dailyApplicationLimit,
    maxApplicationsPerCompany: stored.maxApplicationsPerCompany,
    atsModes: readAtsModes(stored.atsAutoApplyModes),
  };
}
```

Replace `src/app/settings/page.tsx:60-64` with:

```ts
  const rules = await loadAutoApplyRules(db, profile.id);
  const atsModes = rules.atsModes;
```

plus `import { loadAutoApplyRules } from "@/lib/autoapply/load-rules";` (app code uses the `@/` alias; only tests cannot). Keep any other use of the `stored` variable working — if the form needs the raw row for anything else, leave that query in place alongside.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/autoapply && npm run typecheck`
Expected: PASS and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/autoapply/load-rules.ts src/lib/autoapply/load-rules.test.ts src/app/settings/page.tsx
git commit -m "One loader for auto-apply rules, instead of two that disagreed"
```

---

## Task 9: The queue worker

**Files:**
- Create: `src/lib/apply/worker.ts`
- Test: `src/lib/apply/worker.test.ts`
- Modify: `src/lib/apply/run-application.ts` (thread `onFilled` through)
- Modify: `scripts/preflight.ts` (switch to the shared loader — deferred from Task 8 to avoid a file collision)

**Interfaces:**
- Produces: `interface WorkerResult { applicationId: string; finalStatus: ApplicationStatus; attemptId: string | null; reason: string }`; `interface ApplyWorkerParams`; `runApplyWorker(db: PrismaClient, params: ApplyWorkerParams): Promise<WorkerResult>`; `statusForRun(result: ShadowRunResult): ApplicationStatus | null`.

**Design note:** the approve path is three transitions, because `canTransition` allows one pipeline step at a time and `resumeTarget(WAITING_FOR_USER)` is `QUEUED`: `WAITING_FOR_USER → QUEUED → APPLYING → SUBMITTED_PENDING_CONFIRMATION`. No state machine change and no new `ApplicationStatus`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/apply/worker.test.ts`:

```ts
/**
 * Tests for the apply worker's state walk and exception mapping (spec §23).
 *
 * The worker is the piece that decides an application's fate, so what is tested
 * here is not that it works but that it stops: at level 3 it must halt at
 * WAITING_FOR_USER with nothing sent, and every condition that makes a form
 * un-submittable must land the row in the state a person can act on rather than
 * in a generic failure. A worker that mapped a CAPTCHA to FAILED would
 * technically "handle" it while making it invisible.
 */

import { describe, it, expect } from "vitest";
import { ApplicationStatus } from "@prisma/client";
import { canTransition, resumeTarget } from "../applications/machine";
import { statusForRun } from "./worker";
import type { ShadowRunResult } from "./shadow";

function runResult(overrides: Partial<ShadowRunResult> = {}): ShadowRunResult {
  return {
    url: "http://127.0.0.1/x",
    outcomes: [],
    blockingGaps: [],
    screenshotPath: "",
    captcha: false,
    loginRequired: false,
    blockedSubmissions: [],
    blockedTrackers: 0,
    allowedUploads: [],
    ...overrides,
  };
}

describe("statusForRun", () => {
  it("maps a CAPTCHA to the state a person can act on", () => {
    expect(statusForRun(runResult({ captcha: true }))).toBe(ApplicationStatus.CAPTCHA);
  });

  it("maps a login wall to LOGIN_REQUIRED", () => {
    expect(statusForRun(runResult({ loginRequired: true }))).toBe(
      ApplicationStatus.LOGIN_REQUIRED,
    );
  });

  it("maps unfilled required fields to AMBIGUOUS_QUESTION", () => {
    expect(statusForRun(runResult({ blockingGaps: ["Why us?"] }))).toBe(
      ApplicationStatus.AMBIGUOUS_QUESTION,
    );
  });

  it("returns null when the run is clean, so the caller proceeds", () => {
    expect(statusForRun(runResult())).toBeNull();
  });

  it("prefers the CAPTCHA over the gaps it causes", () => {
    // A CAPTCHA usually leaves gaps behind it. Reporting the gaps would send
    // someone off to answer questions that are not the actual blockage.
    expect(statusForRun(runResult({ captcha: true, blockingGaps: ["Why us?"] }))).toBe(
      ApplicationStatus.CAPTCHA,
    );
  });

  it("prefers a login wall over gaps too", () => {
    expect(
      statusForRun(runResult({ loginRequired: true, blockingGaps: ["Why us?"] })),
    ).toBe(ApplicationStatus.LOGIN_REQUIRED);
  });
});

describe("the state walk this worker performs", () => {
  it("is legal, one step at a time, from QUEUED to submitted", () => {
    expect(canTransition(ApplicationStatus.QUEUED, ApplicationStatus.APPLYING)).toBe(true);
    expect(
      canTransition(
        ApplicationStatus.APPLYING,
        ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION,
      ),
    ).toBe(true);
  });

  it("can stop at WAITING_FOR_USER and resume from it", () => {
    expect(
      canTransition(ApplicationStatus.APPLYING, ApplicationStatus.WAITING_FOR_USER),
    ).toBe(true);
    expect(resumeTarget(ApplicationStatus.WAITING_FOR_USER)).toBe(
      ApplicationStatus.QUEUED,
    );
  });

  it("can reach every exception the worker maps to", () => {
    const reachable = [
      ApplicationStatus.CAPTCHA,
      ApplicationStatus.LOGIN_REQUIRED,
      ApplicationStatus.AMBIGUOUS_QUESTION,
      ApplicationStatus.FAILED,
      ApplicationStatus.JOB_CLOSED,
    ];
    for (const status of reachable) {
      expect(canTransition(ApplicationStatus.APPLYING, status), status).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apply/worker.test.ts`
Expected: FAIL — `Failed to resolve import "./worker"`.

- [ ] **Step 3: Write the implementation**

First thread the seam through `run-application.ts`. Add to `RunApplicationOptions` beside `handoff?: boolean`:

```ts
  /** Called once filling is done, with the page still live. See shadow.ts. */
  onFilled?: (handle: FilledHandle) => Promise<void>;
```

Add `onFilled: options.onFilled,` to the `runShadowApply({...})` call beside `handoff: options.handoff,`, and add `FilledHandle` to that file's type imports from `./shadow`.

Also switch `scripts/preflight.ts:213-218` to the shared loader now (deferred from Task 8):

```ts
  const rules = await loadAutoApplyRules(db, profile.id);
```

with `import { loadAutoApplyRules } from "../src/lib/autoapply/load-rules";`.

Create `src/lib/apply/worker.ts`:

```ts
/**
 * The apply worker (spec §23).
 *
 * Walks an application from QUEUED to a resting place, which at trust level 3 —
 * where this ships — is WAITING_FOR_USER with a filled form and a set of gate
 * results for a person to look at. The human's approval is what supplies gate
 * 7's authorization record and starts the submit phase.
 *
 * Level 4 is the same path without the stop, and is unreachable until an ATS
 * has both the evidence and an explicit opt-in.
 */

import { ApplicationStatus, type PrismaClient } from "@prisma/client";
import type { Browser } from "playwright";
import { transitionApplication } from "../applications/store";
import { loadAutoApplyRules } from "../autoapply/load-rules";
import { adapterFor } from "./adapters";
import { answeredFromOutcomes, scoreConfidence } from "./confidence";
import { runApplication } from "./run-application";
import { submitFilledApplication, type Authorization } from "./submit";
import {
  computeTrustLevel,
  gatherTrustEvidence,
  reliabilityForTrustLevel,
} from "./trust";
import type { ShadowRunResult } from "./shadow";

export interface WorkerResult {
  applicationId: string;
  finalStatus: ApplicationStatus;
  attemptId: string | null;
  reason: string;
}

export interface ApplyWorkerParams {
  applicationId: string;
  candidateId: string;
  /**
   * Supplied only when a human has approved this specific application. Its
   * absence is what keeps level 3 stopping.
   */
  authorization?: Authorization;
  browser?: Browser;
  log?: (line: string) => void;
}

/**
 * The state an exception on this run maps to, or null if the run is clean.
 *
 * Order matters: a CAPTCHA or a login wall usually leaves blocking gaps behind
 * it, and reporting the gaps would send someone off to answer questions that
 * are not the actual blockage.
 */
export function statusForRun(result: ShadowRunResult): ApplicationStatus | null {
  if (result.captcha) return ApplicationStatus.CAPTCHA;
  if (result.loginRequired) return ApplicationStatus.LOGIN_REQUIRED;
  if (result.blockingGaps.length > 0) return ApplicationStatus.AMBIGUOUS_QUESTION;
  return null;
}

/** How long the guard stays open for one submission. */
const SUBMIT_WINDOW_MS = 30_000;

export async function runApplyWorker(
  db: PrismaClient,
  params: ApplyWorkerParams,
): Promise<WorkerResult> {
  const log = params.log ?? ((line: string) => console.log(line));

  const application = await db.application.findFirst({
    where: { id: params.applicationId, candidateId: params.candidateId },
    include: { job: { select: { id: true, atsType: true, status: true } } },
  });
  if (!application) {
    return {
      applicationId: params.applicationId,
      finalStatus: ApplicationStatus.FAILED,
      attemptId: null,
      reason: "That application no longer exists.",
    };
  }

  // A job that closed while the row sat in the queue is not a failure, it is a
  // closed job, and it is terminal.
  if (application.job.status !== "OPEN") {
    await transitionApplication(
      db,
      params.candidateId,
      application.id,
      ApplicationStatus.JOB_CLOSED,
      "The posting closed before this was submitted.",
    );
    return {
      applicationId: application.id,
      finalStatus: ApplicationStatus.JOB_CLOSED,
      attemptId: null,
      reason: "The posting closed.",
    };
  }

  const rules = await loadAutoApplyRules(db, params.candidateId);
  const evidence = await gatherTrustEvidence(db, application.job.atsType, false);
  const trustLevel = computeTrustLevel(evidence);
  const adapter = adapterFor(application.job.atsType);

  await db.application.update({
    where: { id: application.id },
    data: { attemptCount: { increment: 1 }, lockedAt: new Date(), lockedBy: "worker" },
  });

  await transitionApplication(
    db,
    params.candidateId,
    application.id,
    ApplicationStatus.APPLYING,
  );

  let attemptId: string | null = null;
  let landed: ApplicationStatus = ApplicationStatus.FAILED;
  let reason = "";

  try {
    const outcome = await runApplication(db, {
      jobId: application.jobId,
      browser: params.browser,
      persistSession: true,
      log,
      onFilled: async (handle) => {
        if (statusForRun(handle.result)) return;

        // No approval means this is the level-3 stop: filled, gated, waiting.
        const authorization = params.authorization;
        if (!authorization) return;

        const confidence = scoreConfidence(
          {
            fields: answeredFromOutcomes(
              handle.result.outcomes.map((o) => ({
                label: o.label,
                required: true,
                recognized: o.source !== "none",
              })),
              handle.result.outcomes,
            ),
            unrecognizedFields: 0,
            captcha: handle.result.captcha,
            loginRequired: handle.result.loginRequired,
            resumeRequired: false,
            coverLetterRequired: false,
          },
          { resumeReady: true, coverLetterReady: true },
          reliabilityForTrustLevel(trustLevel),
        );

        const submitted = await submitFilledApplication(handle, {
          adapter,
          authorization,
          confidence: Math.round(confidence.score),
          minimumConfidence: rules.minimumApplicationConfidence,
          trustLevel,
          windowMs: SUBMIT_WINDOW_MS,
          screenshotPath: `${handle.result.screenshotPath}.submitted.png`,
        });

        const row = await db.submissionAttempt.create({
          data: {
            applicationId: application.id,
            jobId: application.jobId,
            candidateId: params.candidateId,
            url: handle.result.url,
            atsType: application.job.atsType,
            adapterId: submitted.adapterId,
            authorizationKind: authorization.kind,
            authorizationActor: authorization.actor,
            authorizedAt: authorization.at,
            trustLevel,
            confidence: Math.round(confidence.score),
            gates: submitted.gates,
            refusedGate: submitted.refusedGate,
            requests: submitted.requests,
            outcome: submitted.outcome,
            adapterError: submitted.adapterError,
            screenshotPath: submitted.screenshotPath,
            finishedAt: new Date(),
          },
          select: { id: true },
        });
        attemptId = row.id;
      },
    });

    const exception = statusForRun(outcome.result);
    if (exception) {
      landed = exception;
      reason = `The form could not be completed: ${exception}.`;
    } else if (attemptId === null) {
      // The level-3 resting place: filled, nothing sent, a person's turn.
      landed = ApplicationStatus.WAITING_FOR_USER;
      reason = "Filled and ready to submit. Waiting for your approval.";
    } else {
      const attempt = await db.submissionAttempt.findUnique({
        where: { id: attemptId },
        select: { outcome: true, refusedGate: true },
      });

      if (attempt?.outcome === "submitted" || attempt?.outcome === "unconfirmed") {
        landed = ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION;
        reason =
          attempt.outcome === "submitted"
            ? "Submitted and confirmed by the ATS."
            : "Submitted, but the ATS did not confirm. Check it yourself.";
      } else {
        landed = ApplicationStatus.WAITING_FOR_USER;
        reason = `Refused at the ${attempt?.refusedGate ?? "unknown"} gate.`;
      }
    }
  } catch (error) {
    landed = ApplicationStatus.FAILED;
    reason = error instanceof Error ? error.message : String(error);
  } finally {
    await db.application.update({
      where: { id: application.id },
      data: { lockedAt: null, lockedBy: null },
    });
  }

  await transitionApplication(db, params.candidateId, application.id, landed, reason);

  return { applicationId: application.id, finalStatus: landed, attemptId, reason };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/apply/worker.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply/worker.ts src/lib/apply/worker.test.ts src/lib/apply/run-application.ts scripts/preflight.ts
git commit -m "Apply worker: walk the state machine, stop for approval at level 3"
```

---

## Task 10: Daemon endpoints

**Files:**
- Modify: `scripts/apply-daemon.ts` (the `handle` if-chain `:88-131`)
- Modify: `src/lib/apply/daemon-client.ts`

**Interfaces:**
- Produces: `POST /apply-run` taking `{ applicationId, candidateId, authorization? }`; `GET /run?id=<id>`; client `submitApplyRun(request): Promise<string | null>` and `applyRunStatus(id): Promise<RunStatus | null>`.

**Why the status endpoint:** `submitToDaemon` returns `boolean` and `/health` returns counters, so a caller cannot ask what happened to a run it started. The review UI needs to.

- [ ] **Step 1: Parse the URL**

`request.url` is compared with `===` today, so query strings are unsupported. Replace the opening of `handle`:

```ts
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!authorized(request)) return json(response, 401, { error: "unauthorized" });

  // Parsed rather than compared with ===, so /run?id=... can carry a param.
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = parsed.pathname;
```

and change the three existing comparisons to use `path` instead of `request.url`.

- [ ] **Step 2: Add the run registry and the two endpoints**

Above `runOne`:

```ts
/**
 * What each worker run did, by id.
 *
 * In memory and lost on restart, like the queue itself — but unlike a shadow
 * run, a submission's result is also written to SubmissionAttempt, so this is a
 * convenience for the UI rather than the record of what happened.
 */
const runs = new Map<string, { state: "running" | "done"; result?: WorkerResult }>();
```

After the `/apply` block in the if-chain:

```ts
  if (request.method === "POST" && path === "/apply-run") {
    const body = await readJson(request).catch(() => null);
    if (!body) return json(response, 400, { error: "bad json" });
    if (!body.applicationId || !body.candidateId) {
      return json(response, 400, { error: "applicationId and candidateId are required" });
    }

    const runId = randomBytes(8).toString("hex");
    runs.set(runId, { state: "running" });

    queue = queue
      .then(async () => {
        const result = await runApplyWorker(db, {
          applicationId: body.applicationId,
          candidateId: body.candidateId,
          // Dates do not survive JSON. Rehydrate before it reaches a gate.
          authorization: body.authorization
            ? { ...body.authorization, at: new Date(body.authorization.at) }
            : undefined,
          browser: await warmBrowser(),
          log: (line: string) => console.log(line),
        });
        runs.set(runId, { state: "done", result });
      })
      .catch((error) => {
        runs.set(runId, {
          state: "done",
          result: {
            applicationId: body.applicationId,
            finalStatus: "FAILED" as WorkerResult["finalStatus"],
            attemptId: null,
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      });

    return json(response, 202, { accepted: true, runId });
  }

  if (request.method === "GET" && path === "/run") {
    const id = parsed.searchParams.get("id") ?? "";
    const entry = runs.get(id);
    if (!entry) return json(response, 200, { state: "unknown" });
    return json(response, 200, entry);
  }
```

with `import { runApplyWorker, type WorkerResult } from "../src/lib/apply/worker";`.

Note: the existing body-reading helper may not be called `readJson` — use whatever the `/apply` handler already uses to parse its body, rather than inventing a new one.

- [ ] **Step 3: Add the client functions**

Append to `src/lib/apply/daemon-client.ts`:

```ts
/** What a caller asks the worker to do. */
export interface ApplyRunRequest {
  applicationId: string;
  candidateId: string;
  authorization?: {
    kind: "human-approval" | "auto-submit-opt-in";
    actor: string;
    at: string;
    note?: string;
  };
}

export interface RunStatus {
  state: "running" | "done" | "unknown";
  result?: {
    applicationId: string;
    finalStatus: string;
    attemptId: string | null;
    reason: string;
  };
}

/** Start a worker run. Returns the run id, or null if no daemon is up. */
export async function submitApplyRun(request: ApplyRunRequest): Promise<string | null> {
  const handshake = readHandshake();
  if (!handshake) return null;

  try {
    const response = await fetch(`http://127.0.0.1:${handshake.port}/apply-run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${handshake.token}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { runId?: string };
    return body.runId ?? null;
  } catch {
    return null;
  }
}

/** What became of a run the daemon accepted. */
export async function applyRunStatus(id: string): Promise<RunStatus | null> {
  const handshake = readHandshake();
  if (!handshake) return null;

  try {
    const response = await fetch(
      `http://127.0.0.1:${handshake.port}/run?id=${encodeURIComponent(id)}`,
      {
        headers: { authorization: `Bearer ${handshake.token}` },
        signal: AbortSignal.timeout(1_500),
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as RunStatus;
  } catch {
    return null;
  }
}
```

If `readHandshake` is not already a named function in that file, extract it from the existing `daemonStatus`/`submitToDaemon` bodies so all four share one reader rather than a fourth copy.

- [ ] **Step 4: Verify by hand — the daemon has no unit test today**

Start it: `npm run daemon`. In a second terminal:

```bash
TOKEN=$(node -e "console.log(require('./storage/apply-daemon.json').token)")
PORT=$(node -e "console.log(require('./storage/apply-daemon.json').port)")
curl -s -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/run?id=nope"
curl -s "http://127.0.0.1:$PORT/health"
```

Expected: `{"state":"unknown"}` — proving the query string is parsed, which `request.url === "/run"` would not have done — then `{"error":"unauthorized"}`.

Stop it with Ctrl-C.

- [ ] **Step 5: Run typecheck and the suite, then commit**

Run: `npm run typecheck && npm test`

```bash
git add scripts/apply-daemon.ts src/lib/apply/daemon-client.ts
git commit -m "Daemon: start a worker run and ask what happened to it"
```

---

## Task 11: The review surface

**Files:**
- Create: `src/app/applications/review-panel.tsx`
- Modify: `src/app/applications/application-card.tsx`, `actions.ts`, `page.tsx`

**Design note (an assumption — see the header):** this reuses the existing "Needs you" column rather than adding a queue page. A separate page would be a second inbox for the same concept. `ApplicationCard` currently takes only `{ application }`; it gains an optional `attempt` prop.

- [ ] **Step 1: Write the review panel**

Create `src/app/applications/review-panel.tsx`:

```tsx
/**
 * The level-3 review: what was filled, what the gates said, and the two
 * buttons.
 *
 * Lives inside the tracker's "Needs you" column rather than on a page of its
 * own, because that column already means "this one is your turn" and a second
 * inbox for the same concept is how things stop being checked.
 */

import { approveSubmissionAction, rejectSubmissionAction } from "./actions";

export interface ReviewGate {
  gate: string;
  passed: boolean;
  detail: string;
}

export function ReviewPanel({
  applicationId,
  gates,
  confidence,
  screenshotPath,
}: {
  applicationId: string;
  gates: ReviewGate[];
  confidence: number | null;
  screenshotPath: string | null;
}) {
  const failed = gates.filter((gate) => !gate.passed);
  const ready = failed.length === 0;

  return (
    <details className="review-panel">
      <summary>{ready ? "Ready to submit" : `Blocked: ${failed.length} gate(s)`}</summary>

      <dl className="review-gates">
        {gates.map((gate) => (
          <div
            key={gate.gate}
            className={gate.passed ? "gate gate-pass" : "gate gate-fail"}
          >
            <dt>{gate.gate}</dt>
            <dd>{gate.detail}</dd>
          </div>
        ))}
      </dl>

      {confidence !== null ? (
        <p className="review-confidence">Confidence {confidence}.</p>
      ) : null}

      {screenshotPath ? (
        <p className="review-shot">
          Filled form: <code>{screenshotPath}</code>
        </p>
      ) : null}

      {ready ? (
        <form action={approveSubmissionAction}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <button type="submit">Approve and submit</button>
        </form>
      ) : (
        <p className="review-blocked">
          This cannot be submitted until every gate passes. Fix the blockage and queue it
          again.
        </p>
      )}

      <form action={rejectSubmissionAction}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <button type="submit">Do not apply</button>
      </form>
    </details>
  );
}
```

- [ ] **Step 2: Write the server actions**

Append to `src/app/applications/actions.ts`, matching the existing shape — `getProfile` first, `field()` to read the form, `back()` to redirect:

```ts
/**
 * The human approval that is gate 7's authorization record.
 *
 * This is the only thing in the application that produces an authorization, and
 * it produces one naming the person and the moment — never a boolean.
 */
export async function approveSubmissionAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  if (!profile) back("/applications", { error: "no-profile" });

  const applicationId = field(form, "applicationId");

  const runId = await submitApplyRun({
    applicationId,
    candidateId: profile.id,
    authorization: {
      kind: "human-approval",
      actor: profile.email,
      at: new Date().toISOString(),
    },
  });

  if (runId === null) back("/applications", { error: "no-daemon" });

  back("/applications", { saved: "submitting" });
}

/** Take it out of the queue without applying. */
export async function rejectSubmissionAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  if (!profile) back("/applications", { error: "no-profile" });

  const applicationId = field(form, "applicationId");
  const result = await transitionApplication(
    db,
    profile.id,
    applicationId,
    ApplicationStatus.SKIPPED,
    "You decided not to apply after reviewing the filled form.",
  );

  if (!result.ok) back("/applications", { error: "transition" });
  back("/applications", { saved: "rejected" });
}
```

with `import { submitApplyRun } from "@/lib/apply/daemon-client";`. Match the existing `back()` signature in that file exactly — if it takes `(path, params)` with differently-named keys, use those.

- [ ] **Step 3: Wire the card and the page**

In `application-card.tsx`, widen the props:

```tsx
export function ApplicationCard({
  application,
  attempt,
}: {
  application: ApplicationWithJob;
  attempt?: {
    gates: ReviewGate[];
    confidence: number | null;
    screenshotPath: string | null;
  } | null;
}) {
```

and above the existing `<details>` block:

```tsx
      {application.status === ApplicationStatus.WAITING_FOR_USER && attempt ? (
        <ReviewPanel
          applicationId={application.id}
          gates={attempt.gates}
          confidence={attempt.confidence}
          screenshotPath={attempt.screenshotPath}
        />
      ) : null}
```

with `import { ReviewPanel, type ReviewGate } from "./review-panel";`.

In `page.tsx`, after `listApplications`:

```ts
  // Only the rows actually waiting on a person need their gate results.
  const waitingIds = applications
    .filter((application) => application.status === ApplicationStatus.WAITING_FOR_USER)
    .map((application) => application.id);

  const attempts = waitingIds.length
    ? await db.submissionAttempt.findMany({
        where: { applicationId: { in: waitingIds } },
        orderBy: { startedAt: "desc" },
        select: {
          applicationId: true,
          gates: true,
          confidence: true,
          screenshotPath: true,
        },
      })
    : [];

  // findMany gives newest first, so the first one seen per application wins.
  const latestAttempt = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!latestAttempt.has(attempt.applicationId)) {
      latestAttempt.set(attempt.applicationId, attempt);
    }
  }
```

and at the `<ApplicationCard>` call site:

```tsx
                <ApplicationCard
                  key={application.id}
                  application={application}
                  attempt={
                    latestAttempt.has(application.id)
                      ? {
                          gates: latestAttempt.get(application.id)!.gates as ReviewGate[],
                          confidence: latestAttempt.get(application.id)!.confidence,
                          screenshotPath: latestAttempt.get(application.id)!.screenshotPath,
                        }
                      : null
                  }
                />
```

Add to `SAVED_MESSAGES`:

```ts
  submitting: "Submitting. Refresh in a moment to see the result.",
  rejected: "Left un-applied.",
```

- [ ] **Step 4: Verify**

Stop the dev server, then: `npm run typecheck && npm test && npm run build`
Expected: PASS all three.

- [ ] **Step 5: Commit**

```bash
git add src/app/applications
git commit -m "Review and approve a filled application from the tracker"
```

---

## Task 12: Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-09-13-apply-workers-design.md` (status + departures)

- [ ] **Step 1: Map the sections to the modules**

Add rows to the section-to-module table in `docs/ARCHITECTURE.md`:

```markdown
| §21 Adapter trust levels | `src/lib/apply/trust.ts` (thresholds in `TRUST_THRESHOLDS`) |
| §22 Application workers | `src/lib/apply/adapters/` — submit button, success, error only; filling stays generic |
| §23 Queue and state machine | `src/lib/apply/worker.ts`, driven by `POST /apply-run` on the apply daemon |
| Submit guard and its one exception | `src/lib/apply/shadow.ts` — `submitWindow`, `openSubmitWindow` |
| Submission records | `SubmissionAttempt` in `prisma/schema.prisma` |
```

Then add:

```markdown
### Why filling and submitting are separate

`runShadowApply` blocks every non-GET request for the whole time it is filling.
That is what makes "a bug in the filling logic cannot send an application" a
guarantee rather than a hope — it does not depend on nobody having written a
stray click.

Submission needs a POST, so it needs an exception. The exception is
`openSubmitWindow`: a closure created inside `shadow.ts`, handed to the submit
phase after filling has completely finished, scoped to the form's own host,
bounded by a deadline, and closed in a `finally` so a throw cannot leave it
open. `submit.ts` decides whether to call it and works out what happened; it
cannot open the guard itself, and no other file may call `context.route` or
`context.unroute`.

If you are changing this, the tests that will tell you whether you broke it are
in `src/lib/apply/submit-window.test.ts` — every one of which has a negative
twin asserting that nothing was sent.
```

- [ ] **Step 2: Mark the design implemented**

Change the status line in the design doc:

```markdown
**Status:** Implemented 2026-09-15. See `docs/superpowers/plans/2026-09-15-apply-workers.md`.
```

and add:

```markdown
**Departures from this design, decided during implementation:**

- `submitButton(page): Locator | null` became `submitButtons(page): Promise<Locator[]>`
  — gate 6 has to tell "none" from "several", and a nullable single value
  collapses them.
- The guard exception is a `submitWindow` variable consulted by the permanent
  route handler, modelled on the existing `uploadWindow`, rather than
  `unroute`/`route`. Re-arming is then automatic; handoff's one-way `unroute`
  was not a safe pattern to copy.
- A `trust-level` gate was added ahead of the seven, because an adapter that
  cannot recognise its own success page must not click even once.
- `scoreConfidence` takes a reliability number rather than an `atsType`, so it
  stays pure and synchronous while the number behind it is measured.
- `Application` gained lease and attempt columns; the daemon's in-memory queue
  loses accepted work on restart, which is tolerable for a shadow run and not
  for a submission.
```

- [ ] **Step 3: Full verification**

Stop the dev server, then run what CI runs:

```bash
npx prisma generate && npm run typecheck && npm test && npm run build
```

Expected: PASS all four.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "Document the apply workers and why the phases are separate"
```
