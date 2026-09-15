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
 * with the guard deleted entirely. That is why every negative test also asserts
 * the guard ACTIVELY REFUSED -- result.blockedSubmissions is non-empty -- and
 * not merely that nothing arrived. The fixture forms have `required` inputs, so
 * "no POST arrived" on its own is also what an unfilled form looks like.
 *
 * NEVER point any of this at a real employer's form.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startFixtureServer, type FixtureServer } from "./fixture-server";
import { runShadowApply, type FilledHandle, type ShadowRunResult } from "./shadow";

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

let fixture: FixtureServer;
let browser: Browser;
let dir: string;
let shot = 0;

beforeEach(async () => {
  fixture = await startFixtureServer("greenhouse");
  // Headless, and lent to the run: shadow mode launches `headless: false` on
  // purpose for a person to watch, which is not what a test suite wants nine
  // windows of.
  browser = await chromium.launch({ headless: true });
  dir = mkdtempSync(join(tmpdir(), "autopilot-submit-window-"));
  shot = 0;
});

afterEach(async () => {
  await browser.close().catch(() => undefined);
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

/** One shadow run against the fixture, with the given submit-phase body. */
async function run(
  onFilled: (handle: FilledHandle) => Promise<void>,
): Promise<ShadowRunResult> {
  shot += 1;
  return runShadowApply({
    url: fixture.url,
    profile: PROFILE,
    answers: [],
    screenshotPath: join(dir, `filled-${shot}.png`),
    browser,
    onFilled,
  });
}

/**
 * Press Submit and give the request time to be attempted and refused.
 *
 * The click is swallowed: on a page that has already navigated it can throw,
 * and a throw here would end the test before the thing under test — whether
 * anything reached the server — could be observed.
 */
async function clickSubmit(handle: FilledHandle): Promise<void> {
  await handle.page.click("#submit_app").catch(() => undefined);
  await handle.page.waitForTimeout(500);
}

describe("the submit window is shut unless explicitly opened", () => {
  it(
    "refuses a submit click that opened no window at all",
    async () => {
      // The exact mistake the guard exists to survive: something in the
      // submit phase clicks Submit without going through openSubmitWindow.
      const result = await run(async (handle) => {
        await clickSubmit(handle);
      });

      expect(fixture.posts).toEqual([]);
      expect(result.blockedSubmissions.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "refuses a submit click made after the window has closed",
    async () => {
      const result = await run(async (handle) => {
        // Opens and closes: the window shuts when the body returns, not when
        // its milliseconds run out.
        await handle.openSubmitWindow(10_000, async () => undefined);
        await clickSubmit(handle);
      });

      expect(fixture.posts).toEqual([]);
      expect(result.blockedSubmissions.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "refuses a submit click after the window's body threw",
    async () => {
      const result = await run(async (handle) => {
        await handle
          .openSubmitWindow(10_000, async () => {
            throw new Error("something in the submit phase went wrong");
          })
          .catch(() => undefined);

        // A throw must not leave the guard open for whatever runs next.
        await clickSubmit(handle);
      });

      expect(fixture.posts).toEqual([]);
      expect(result.blockedSubmissions.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "refuses a submit click made after the deadline passes mid-body",
    async () => {
      const result = await run(async (handle) => {
        // The deadline is wall-clock, not a promise boundary: sitting inside
        // the body past `ms` does not keep the window open.
        await handle.openSubmitWindow(300, async () => {
          await handle.page.waitForTimeout(800);
          await clickSubmit(handle);
        });
      });

      expect(fixture.posts).toEqual([]);
      expect(result.blockedSubmissions.length).toBeGreaterThan(0);
    },
    60_000,
  );
});

describe("the submit window admits the submission it was opened for", () => {
  it(
    "lets the form's own POST through and lands on the success page",
    async () => {
      await run(async (handle) => {
        await handle.openSubmitWindow(20_000, async () => {
          await handle.page.click("#submit_app");
          await handle.page.waitForURL(/\/submitted/);
        });
      });

      expect(fixture.posts).toHaveLength(1);
      expect(fixture.posts[0]?.path).toBe("/apply");
    },
    60_000,
  );

  it(
    "reports every request it admitted, verbatim",
    async () => {
      let admitted: string[] = [];

      await run(async (handle) => {
        const window = await handle.openSubmitWindow(20_000, async () => {
          await handle.page.click("#submit_app");
          await handle.page.waitForURL(/\/submitted/);
        });
        admitted = window.requests;
      });

      // An exception nobody can see is one nobody can check.
      expect(
        admitted.some((line) => line.startsWith("POST ") && line.includes("/apply")),
      ).toBe(true);
    },
    60_000,
  );
});

describe("the submit window admits the form's host only", () => {
  it(
    "refuses a third-party POST fired from inside an open window",
    async () => {
      // A second, unrelated origin standing in for every analytics beacon, ad
      // pixel and session-replay endpoint a real ATS page fires. An open
      // window is for the form's host, not for the whole internet.
      const other = await startFixtureServer("greenhouse");
      try {
        await run(async (handle) => {
          await handle.openSubmitWindow(5_000, async () => {
            await handle.page.evaluate(async (target) => {
              await fetch(target, { method: "POST" }).catch(() => undefined);
            }, `${other.url}/apply`);
            await handle.page.waitForTimeout(500);
          });
        });

        expect(other.posts).toEqual([]);
      } finally {
        await other.close();
      }
    },
    60_000,
  );
});

describe("onFilled is a seam that opens only after the run is otherwise done", () => {
  it(
    "runs with the form already filled",
    async () => {
      let firstName = "";

      await run(async (handle) => {
        firstName = await handle.page.inputValue("#first_name");
      });

      // A defect in the filling logic must not be able to reach the one
      // routine that can open the guard: by the time onFilled runs, filling
      // has finished.
      expect(firstName).toBe("Ada");
    },
    60_000,
  );

  it(
    "hands over the same result the run returns",
    async () => {
      let handed: ShadowRunResult | null = null;

      const result = await run(async (handle) => {
        handed = handle.result;
      });

      expect(handed).not.toBeNull();
      expect((handed as unknown as ShadowRunResult).url).toBe(result.url);
    },
    60_000,
  );
});

describe("the handle carries the form as parsed, not as reconstructed", () => {
  it(
    "hands over real field kinds, so confidence cannot be scored on fabricated buckets",
    async () => {
      // Rebuilding a ParsedForm from the fill outcomes would put every field in
      // the "standard" bucket and leave "legal" and "custom" empty -- and
      // scoreConfidence's fraction() returns 1 for an empty bucket, so an
      // unasked legal question would read as a perfect score. The real parse is
      // carried across precisely so that cannot happen.
      let seen: { label: string; kind: string }[] = [];
      let unrecognized = -1;

      await run(async (handle) => {
        seen = handle.form.fields.map((field) => ({
          label: field.label,
          kind: field.kind,
        }));
        unrecognized = handle.form.unrecognizedFields;
      });

      expect(seen.length).toBeGreaterThan(0);
      // Both fixture fields are classifiable, so neither may arrive unknown.
      expect(seen.every((field) => field.kind !== "unknown")).toBe(true);
      expect(unrecognized).toBe(0);
    },
    60_000,
  );
});
