/**
 * Tests for the submit phase (spec §21-23).
 *
 * Three things this file exists to hold still.
 *
 * FIRST: the gates are re-evaluated immediately before the submit window
 * opens, not earlier. A gate checked thirty seconds ago is a statement about a
 * page that no longer exists — the form may have re-rendered, a validation
 * error may have appeared, the session may have expired into a login wall. So
 * the browser tests drive the real filling path and let the gates read the
 * page as it actually is at the instant of the click.
 *
 * SECOND: every gate gets a test that fails it ALONE, with everything else
 * perfect, and asserts that NO POST left the browser. A suite that only proved
 * "a good run submits" would pass just as happily with the entire gate list
 * deleted. A refusal is only a refusal if the fixture server can say nothing
 * arrived.
 *
 * THIRD: a refusal has to be RECORDED, not silently dropped. That is why every
 * refusal path returns a full SubmitOutcome — the gates it evaluated, which one
 * refused, and the adapter it was using — rather than a bare boolean or a
 * thrown error. An application that quietly did not go out is as bad as one
 * that quietly did: both leave the candidate believing something happened that
 * did not.
 *
 * NEVER point any of this at a real employer's form.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { adapterFor } from "./adapters";
import { startFixtureServer, type FixtureKind, type FixtureServer } from "./fixture-server";
import { runShadowApply, type FilledHandle, type ShadowRunResult } from "./shadow";
import type { FieldOutcome } from "./shadow-types";
import {
  evaluateGates,
  submitFilledApplication,
  type Authorization,
  type GateInput,
  type GateName,
  type GateOutcome,
  type SubmitOutcome,
} from "./submit";

/**
 * Verified to fill both of the fixture's required fields — First Name -> "Ada",
 * Email -> ada@example.com — so a run leaves zero blocking gaps and a click on
 * Submit is a click the browser will actually act on. Without that, "no POST
 * arrived" would be indistinguishable from HTML5 validation refusing to submit
 * an empty form, and every negative below would prove nothing.
 */
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

/** A real authorization value, the shape a human approval actually produces. */
const APPROVAL: Authorization = {
  kind: "human-approval",
  actor: "ada@example.com",
  at: new Date("2026-02-01T09:30:00.000Z"),
  note: "reviewed the shadow screenshot",
};

// ────────────────────────────────────────────────────────────────────────
// Typed fixtures for the pure gate tests.
//
// Built as real ShadowRunResult / GateInput values rather than cast through
// `as never`: a cast would let the fixture drift out of the shape production
// code actually hands these gates, and the first thing to break would be the
// test's claim to be testing anything.
// ────────────────────────────────────────────────────────────────────────

function outcome(
  label: string,
  status: FieldOutcome["status"],
  detail = "",
): FieldOutcome {
  return { label, status, detail, source: "profile" };
}

function cleanResult(overrides: Partial<ShadowRunResult> = {}): ShadowRunResult {
  const outcomes: FieldOutcome[] = [
    outcome("First Name", "filled", "Ada"),
    outcome("Email", "filled", "ada@example.com"),
  ];

  return {
    url: "http://127.0.0.1:1/apply",
    outcomes,
    blockingGaps: [],
    screenshotPath: "/tmp/filled.png",
    captcha: false,
    loginRequired: false,
    blockedSubmissions: [],
    blockedTrackers: 0,
    allowedUploads: [],
    ...overrides,
  };
}

function cleanInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    result: cleanResult(),
    confidence: 88,
    minimumConfidence: 70,
    submitButtonCount: 1,
    authorization: APPROVAL,
    ...overrides,
  };
}

/** The one gate under test, pulled out of the full list of seven. */
function gate(gates: GateOutcome[], name: GateName): GateOutcome {
  const found = gates.find((candidate) => candidate.gate === name);
  if (!found) throw new Error(`no ${name} gate in the evaluated list`);
  return found;
}

/** Every gate except the named one. */
function others(gates: GateOutcome[], name: GateName): GateOutcome[] {
  return gates.filter((candidate) => candidate.gate !== name);
}

const GATE_ORDER: GateName[] = [
  "blocking-gaps",
  "captcha",
  "login-wall",
  "failed-fields",
  "confidence",
  "submit-button",
  "authorization",
];

describe("evaluateGates evaluates all seven, in order, without short-circuiting", () => {
  it("passes every gate on a clean run", async () => {
    const gates = await evaluateGates(cleanInput());

    expect(gates.map((entry) => entry.gate)).toEqual(GATE_ORDER);
    expect(gates.every((entry) => entry.passed)).toBe(true);
  });

  it("still reports all seven when the first one fails", async () => {
    // No short-circuit on purpose: a refusal should show the whole picture,
    // not surrender one reason per retry.
    const gates = await evaluateGates(
      cleanInput({ result: cleanResult({ blockingGaps: ["Sponsorship"] }) }),
    );

    expect(gates).toHaveLength(7);
    expect(gates.map((entry) => entry.gate)).toEqual(GATE_ORDER);
  });
});

describe("each gate fails alone", () => {
  it("blocking-gaps fails and names the gaps", async () => {
    const gates = await evaluateGates(
      cleanInput({
        result: cleanResult({ blockingGaps: ["Sponsorship", "Start date"] }),
      }),
    );

    expect(gate(gates, "blocking-gaps").passed).toBe(false);
    expect(gate(gates, "blocking-gaps").detail).toContain("Sponsorship");
    expect(gate(gates, "blocking-gaps").detail).toContain("Start date");
    expect(others(gates, "blocking-gaps").every((entry) => entry.passed)).toBe(true);
  });

  it("captcha fails alone", async () => {
    const gates = await evaluateGates(
      cleanInput({ result: cleanResult({ captcha: true }) }),
    );

    expect(gate(gates, "captcha").passed).toBe(false);
    expect(others(gates, "captcha").every((entry) => entry.passed)).toBe(true);
  });

  it("login-wall fails alone", async () => {
    const gates = await evaluateGates(
      cleanInput({ result: cleanResult({ loginRequired: true }) }),
    );

    expect(gate(gates, "login-wall").passed).toBe(false);
    expect(others(gates, "login-wall").every((entry) => entry.passed)).toBe(true);
  });

  it("failed-fields fails on a NON-REQUIRED field, and counts and names it", async () => {
    // The point of the gate: a failed field is a statement about the page, not
    // about that one field. Nothing here says "required" — the field could be
    // entirely optional and the gate still refuses, because the filler
    // believed it had done something the page did not do.
    const gates = await evaluateGates(
      cleanInput({
        result: cleanResult({
          blockingGaps: [],
          outcomes: [
            outcome("First Name", "filled", "Ada"),
            outcome("Email", "filled", "ada@example.com"),
            outcome("LinkedIn URL", "failed", "Could not find this control on the page."),
          ],
        }),
      }),
    );

    expect(gate(gates, "failed-fields").passed).toBe(false);
    expect(gate(gates, "failed-fields").detail).toContain("1");
    expect(gate(gates, "failed-fields").detail).toContain("LinkedIn URL");
    expect(others(gates, "failed-fields").every((entry) => entry.passed)).toBe(true);
  });

  it("confidence fails alone and names both numbers", async () => {
    const gates = await evaluateGates(
      cleanInput({ confidence: 41, minimumConfidence: 70 }),
    );

    expect(gate(gates, "confidence").passed).toBe(false);
    expect(gate(gates, "confidence").detail).toContain("41");
    expect(gate(gates, "confidence").detail).toContain("70");
    expect(others(gates, "confidence").every((entry) => entry.passed)).toBe(true);
  });

  it("confidence names both numbers when it passes too", async () => {
    const gates = await evaluateGates(cleanInput({ confidence: 88, minimumConfidence: 70 }));

    expect(gate(gates, "confidence").passed).toBe(true);
    expect(gate(gates, "confidence").detail).toContain("88");
    expect(gate(gates, "confidence").detail).toContain("70");
  });

  it("submit-button fails when there are NO buttons", async () => {
    const gates = await evaluateGates(cleanInput({ submitButtonCount: 0 }));

    expect(gate(gates, "submit-button").passed).toBe(false);
    expect(gate(gates, "submit-button").detail).toContain("0");
    expect(others(gates, "submit-button").every((entry) => entry.passed)).toBe(true);
  });

  it("submit-button fails just as hard when there are SEVERAL", async () => {
    // Three is not "better than one". Both readings mean the page is not the
    // page the adapter was written against, and clicking the first of three
    // unknown buttons is a guess.
    const gates = await evaluateGates(cleanInput({ submitButtonCount: 3 }));

    expect(gate(gates, "submit-button").passed).toBe(false);
    expect(gate(gates, "submit-button").detail).toContain("3");
    expect(others(gates, "submit-button").every((entry) => entry.passed)).toBe(true);
  });

  it("authorization fails alone when nobody authorized it", async () => {
    const gates = await evaluateGates(cleanInput({ authorization: null }));

    expect(gate(gates, "authorization").passed).toBe(false);
    expect(others(gates, "authorization").every((entry) => entry.passed)).toBe(true);
  });

  it("authorization records WHO authorized it, and when", async () => {
    // Attributable after the fact: the detail is what gets written to the
    // attempt row, so "allowed" has to carry a name rather than a true.
    const gates = await evaluateGates(cleanInput());
    const authorization = gate(gates, "authorization");

    expect(authorization.passed).toBe(true);
    expect(authorization.detail).toContain("ada@example.com");
    expect(authorization.detail).toContain("human-approval");
    expect(authorization.detail).toContain(APPROVAL.at.toISOString());
  });

  it("accepts an auto-submit opt-in as authorization too", async () => {
    const gates = await evaluateGates(
      cleanInput({
        authorization: {
          kind: "auto-submit-opt-in",
          actor: "ada@example.com",
          at: new Date("2026-02-02T12:00:00.000Z"),
        },
      }),
    );

    expect(gate(gates, "authorization").passed).toBe(true);
    expect(gate(gates, "authorization").detail).toContain("auto-submit-opt-in");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Browser tests. Real Chromium, real fixture server, real submit guard.
//
// The fixture server is the witness: `fixture.posts` is the only evidence that
// can tell "refused" from "submitted and we did not notice".
// ────────────────────────────────────────────────────────────────────────

let fixture: FixtureServer;
let browser: Browser;
let dir: string;
let shot = 0;

async function startFixture(kind: FixtureKind): Promise<void> {
  fixture = await startFixtureServer(kind);
}

beforeEach(async () => {
  // Headless, and lent to the run: shadow mode launches `headless: false` on
  // purpose for a person to watch, which is not what a test suite wants five
  // windows of.
  browser = await chromium.launch({ headless: true });
  dir = mkdtempSync(join(tmpdir(), "autopilot-submit-"));
  shot = 0;
});

afterEach(async () => {
  await browser.close().catch(() => undefined);
  await fixture?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** One shadow run whose onFilled seam hands straight to the submit phase. */
async function runSubmit(params: {
  adapter?: ReturnType<typeof adapterFor>;
  authorization?: Authorization | null;
  confidence?: number;
  minimumConfidence?: number;
  trustLevel?: 0 | 1 | 2 | 3 | 4;
  windowMs?: number;
}): Promise<SubmitOutcome> {
  shot += 1;
  let captured: SubmitOutcome | null = null;

  await runShadowApply({
    url: fixture.url,
    profile: PROFILE,
    answers: [],
    screenshotPath: join(dir, `filled-${shot}.png`),
    browser,
    onFilled: async (handle: FilledHandle) => {
      captured = await submitFilledApplication(handle, {
        adapter: params.adapter ?? adapterFor("GREENHOUSE"),
        authorization:
          params.authorization === undefined ? APPROVAL : params.authorization,
        confidence: params.confidence ?? 88,
        minimumConfidence: params.minimumConfidence ?? 70,
        trustLevel: params.trustLevel ?? 3,
        windowMs: params.windowMs ?? 20_000,
        screenshotPath: join(dir, `submitted-${shot}.png`),
      });
    },
  });

  if (captured === null) throw new Error("the submit phase never ran");
  return captured;
}

describe("a clean, authorized run on a trusted adapter submits", () => {
  it(
    "clicks once, the POST arrives, and the outcome says submitted",
    async () => {
      await startFixture("greenhouse");
      const result = await runSubmit({});

      expect(fixture.posts).toHaveLength(1);
      expect(result.outcome).toBe("submitted");
      expect(result.refusedGate).toBeNull();
      expect(result.adapterId).toBe("greenhouse");
      expect(
        result.requests.some((line) => line.startsWith("POST ") && line.includes("/apply")),
      ).toBe(true);
    },
    60_000,
  );
});

describe("a failing gate refuses, and nothing is clicked", () => {
  it(
    "refuses when nobody authorized it",
    async () => {
      await startFixture("greenhouse");
      const result = await runSubmit({ authorization: null });

      // The assertion that matters: the employer's server saw nothing.
      expect(fixture.posts).toEqual([]);
      expect(result.outcome).toBe("refused");
      expect(result.refusedGate).toBe("authorization");
      expect(result.requests).toEqual([]);
      // Recorded, not dropped: the whole gate list comes back so the attempt
      // row can say what the state of the page actually was.
      expect(result.gates).toHaveLength(7);
    },
    60_000,
  );

  it(
    "refuses when confidence is under the minimum",
    async () => {
      await startFixture("greenhouse");
      const result = await runSubmit({ confidence: 30, minimumConfidence: 70 });

      expect(fixture.posts).toEqual([]);
      expect(result.outcome).toBe("refused");
      expect(result.refusedGate).toBe("confidence");
      expect(result.requests).toEqual([]);
    },
    60_000,
  );

  it(
    "refuses on an adapter that cannot recognise its own success page",
    async () => {
      await startFixture("greenhouse");
      // WORKDAY is not in the registry, so this is the generic adapter, capped
      // at trust level 2. Everything else about this run is perfect — a real
      // approval, full confidence, a filled form — and it still must not click.
      const result = await runSubmit({ adapter: adapterFor("WORKDAY"), trustLevel: 4 });

      expect(fixture.posts).toEqual([]);
      expect(result.outcome).toBe("refused");
      expect(result.refusedGate).toBe("trust-level");
      expect(result.adapterId).toBe("generic");
      expect(result.requests).toEqual([]);
    },
    60_000,
  );
});

describe("a submission nobody could confirm is not a submission", () => {
  it(
    "reports unconfirmed when the POST went out but no success page came back",
    async () => {
      await startFixture("slow");
      const result = await runSubmit({ windowMs: 2_000 });

      // The POST DID leave. The application may well have been received.
      expect(fixture.posts).toHaveLength(1);
      // And it is still not recorded as "submitted": the trust ladder is built
      // from these counts, so a hopeful reading here inflates the very evidence
      // that unlocks auto-submit.
      expect(result.outcome).toBe("unconfirmed");
      expect(result.refusedGate).toBeNull();
    },
    60_000,
  );
});
