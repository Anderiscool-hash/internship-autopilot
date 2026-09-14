/**
 * Tests for the post-submit verification handoff control.
 *
 * The problem this exists to solve: most portals only email a verification
 * code in response to the person's own Submit click, and Submit usually
 * navigates the page. A panel dropped into the page with `page.evaluate` or
 * `addScriptTag` does not survive that navigation — the whole reason
 * `installHandoffMailControl` (ask-overlay.ts) uses `page.addInitScript`
 * instead. That claim is exactly what this file has to prove, and doing so
 * needs a real navigation happening in a real (headless) browser — nothing
 * else in this repo's test suite drives Playwright this way, which is why
 * this file exists apart from the usual pure-function tests.
 *
 * NEVER run any of this against a real employer's form or a real mailbox.
 * The fixture below is two local `file://` pages generated into a scratch
 * temp directory and deleted afterward; the "mailbox" is a stub function
 * supplied to `installHandoffMailControl`, never `checkMailboxOnce`/IMAP.
 * Nothing here touches the submit guard in shadow.ts either — these pages
 * navigate via a plain `location.href` assignment, not a form POST, because
 * what is under test is the panel surviving a navigation and the code
 * getting filled afterward, not the guard (which has no exception for this
 * feature and is not exercised here at all).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { installHandoffMailControl, type HandoffCheckOutcome } from "./ask-overlay";
import { tryFillVerificationCode } from "./shadow";

const PAGE_ONE = `<!doctype html>
<html>
<body>
  <h1>Application form</h1>
  <label for="name">Full name</label>
  <input id="name" name="name" type="text" />
  <button id="go" type="button" onclick="location.href='page2.html'">Submit</button>
</body>
</html>`;

/** Page two: what a portal's post-submit "confirm your email" page looks like. */
const PAGE_TWO_WITH_FIELD = `<!doctype html>
<html>
<body>
  <h1>Check your email</h1>
  <p>We sent a code to your inbox.</p>
  <label for="vcode">Verification code</label>
  <input id="vcode" name="vcode" type="text" />
</body>
</html>`;

/**
 * Wait for one "check my email" press to finish.
 *
 * The button's click handler calls back into Node through `exposeFunction` —
 * a real async round trip, not a synchronous DOM update — so a click
 * resolves before the panel has necessarily updated. The button re-enabling
 * itself is the signal that `onCheck`'s promise settled and the panel has
 * whatever it is going to show.
 */
async function waitForCheckToFinish(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.getElementById(
      "autopilot-handoff-check",
    ) as HTMLButtonElement | null;
    return button !== null && !button.disabled;
  });
}

/** A post-submit page with no verification field at all — the fallback case. */
const PAGE_TWO_WITHOUT_FIELD = `<!doctype html>
<html>
<body>
  <h1>Thanks for applying</h1>
  <p>We will be in touch.</p>
</body>
</html>`;

describe("post-submit verification handoff control", () => {
  let dir: string;
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "autopilot-handoff-fixture-"));
    writeFileSync(join(dir, "page1.html"), PAGE_ONE);
    writeFileSync(join(dir, "page2.html"), PAGE_TWO_WITH_FIELD);

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterEach(async () => {
    await browser.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-injects the control after Submit navigates the page, with no second registration", async () => {
    await page.goto(pathToFileURL(join(dir, "page1.html")).href);

    let calls = 0;
    const stubOnCheck = async (): Promise<HandoffCheckOutcome> => {
      calls += 1;
      return { status: "empty" };
    };

    // Called exactly once, before the navigation — proving this does NOT
    // need to be called again after Submit is the point. Calling it twice on
    // one page would throw on the second `exposeFunction`, so a second call
    // here is not an option even if this test wanted to try it.
    await installHandoffMailControl(page, stubOnCheck);

    expect(await page.locator("#autopilot-handoff-check").isVisible()).toBe(true);

    await page.click("#go");
    await page.waitForURL(/page2\.html/);

    // Still there on the page Submit navigated to, without anything in this
    // test putting it back — that re-injection is addInitScript's job, done
    // once at install time, not this test's.
    expect(await page.locator("#autopilot-handoff-check").isVisible()).toBe(true);

    await page.click("#autopilot-handoff-check");
    await waitForCheckToFinish(page);
    const status = await page.locator("#autopilot-handoff").innerText();
    expect(status).toContain("No mail has arrived yet");
    expect(calls).toBe(1);
  });

  it("fills the code into the field on the page Submit navigated to", async () => {
    await page.goto(pathToFileURL(join(dir, "page1.html")).href);

    // Stands in for handleHandoffMailCheck's own two steps in shadow.ts: a
    // stub plays the part of "the mailbox said 482913" (never real IMAP —
    // see the file header), and hands off to the SAME routine production
    // code uses to put it on the page. tryFillVerificationCode is exported
    // from shadow.ts for exactly this — the test exercises the real fill
    // logic, not a re-implementation of it.
    await installHandoffMailControl(page, async (): Promise<HandoffCheckOutcome> => {
      const filled = await tryFillVerificationCode(page, "482913");
      return { status: filled ? "filled" : "shown", value: "482913" };
    });

    await page.click("#go");
    await page.waitForURL(/page2\.html/);
    await page.click("#autopilot-handoff-check");
    await waitForCheckToFinish(page);

    expect(await page.locator("#vcode").inputValue()).toBe("482913");
    const status = await page.locator("#autopilot-handoff").innerText();
    expect(status).toContain("filled in for you");
  });

  it("falls back to showing the code, not silence, when no field is found on the new page", async () => {
    // Overwrite page two with a fixture that has no verification field at
    // all — the exact case the task called out: a post-submit page laid out
    // in a way the field-finder does not recognise must not just do nothing.
    writeFileSync(join(dir, "page2.html"), PAGE_TWO_WITHOUT_FIELD);

    await page.goto(pathToFileURL(join(dir, "page1.html")).href);
    await installHandoffMailControl(page, async (): Promise<HandoffCheckOutcome> => {
      const filled = await tryFillVerificationCode(page, "999111");
      return { status: filled ? "filled" : "shown", value: "999111" };
    });

    await page.click("#go");
    await page.waitForURL(/page2\.html/);
    await page.click("#autopilot-handoff-check");
    await waitForCheckToFinish(page);

    const panelText = await page.locator("#autopilot-handoff").innerText();
    expect(panelText).toContain("Could not find the field for it on this page");
    expect(panelText).toContain("999111");
  });

  it("does not steal focus or swallow keystrokes typed into the page's own fields", async () => {
    // Requirement 6: unlike the ask panel (which deliberately does grab
    // focus and eat Enter, for a text input it owns), this control has no
    // text input of its own and must not interfere with the person typing
    // into the real form. Prove it by focusing and typing into the page's
    // own field AFTER the control is installed, and checking nothing
    // intercepted it.
    await page.goto(pathToFileURL(join(dir, "page1.html")).href);
    await installHandoffMailControl(page, async (): Promise<HandoffCheckOutcome> => ({
      status: "empty",
    }));

    await page.click("#name");
    await page.keyboard.type("Ada Lovelace");
    expect(await page.locator("#name").inputValue()).toBe("Ada Lovelace");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("name");
  });
});
