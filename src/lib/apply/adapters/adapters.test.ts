/**
 * Tests for the per-ATS adapters (spec §22).
 *
 * The adapters own exactly three judgments — which element submits, whether a
 * submission landed, and whether the page is showing an error — and each is a
 * claim about real markup, so each is tested against the replica forms rather
 * than against a mock. A selector that silently matches nothing looks identical
 * to a working one in a unit test with a fake page; here it does not.
 *
 * The count matters as much as the match: the submit gate refuses unless
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

/**
 * Open one fixture form in a real headless browser.
 *
 * Returns the page rather than storing it, so each test states which ATS it is
 * talking about at the point it makes its claim.
 */
async function openFixture(
  kind: "greenhouse" | "lever" | "ashby",
  path = "",
): Promise<Page> {
  server = await startFixtureServer(kind);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${server.url}${path}`);
  return page;
}

describe("adapterFor", () => {
  it("maps each known ATS enum spelling to its own adapter", () => {
    expect(adapterFor("GREENHOUSE").id).toBe("greenhouse");
    expect(adapterFor("LEVER").id).toBe("lever");
    expect(adapterFor("ASHBY").id).toBe("ashby");
  });

  it("falls back to the generic adapter for every unlisted ATS", () => {
    expect(adapterFor("WORKDAY").id).toBe("generic");
    expect(adapterFor("ICIMS").id).toBe("generic");
    expect(adapterFor("CUSTOM").id).toBe("generic");
  });

  it("caps the generic adapter below the submitting levels", () => {
    // 2 is "autofill". The generic adapter must never reach 3 or 4, because on
    // an unknown ATS we cannot recognise the confirmation page — so after a
    // click we could not tell a sent application from a silently failed one,
    // and "we think we applied" is worse than not applying at all.
    expect(adapterFor("WORKDAY").maxTrustLevel).toBe(2);
  });

  it("lets each known adapter reach the auto-submit ceiling", () => {
    expect(adapterFor("GREENHOUSE").maxTrustLevel).toBe(4);
    expect(adapterFor("LEVER").maxTrustLevel).toBe(4);
    expect(adapterFor("ASHBY").maxTrustLevel).toBe(4);
  });
});

describe("submitButtons", () => {
  it("finds exactly one submit control on the greenhouse form", async () => {
    const page = await openFixture("greenhouse");
    const buttons = await adapterFor("GREENHOUSE").submitButtons(page);
    expect(buttons).toHaveLength(1);
  }, 60_000);

  it("finds exactly one submit control on the lever form", async () => {
    const page = await openFixture("lever");
    const buttons = await adapterFor("LEVER").submitButtons(page);
    expect(buttons).toHaveLength(1);
  }, 60_000);

  it("finds exactly one submit control on the ashby form", async () => {
    const page = await openFixture("ashby");
    const buttons = await adapterFor("ASHBY").submitButtons(page);
    expect(buttons).toHaveLength(1);
  }, 60_000);

  it("finds none on the confirmation page, which has no form at all", async () => {
    const page = await openFixture("greenhouse", "/submitted");
    const buttons = await adapterFor("GREENHOUSE").submitButtons(page);
    expect(buttons).toHaveLength(0);
  }, 60_000);
});

describe("detectSubmitted", () => {
  it("is false while the form is still on screen", async () => {
    const page = await openFixture("greenhouse");
    expect(await adapterFor("GREENHOUSE").detectSubmitted(page)).toBe(false);
  }, 60_000);

  it("is true after a real browser submit lands on the confirmation page", async () => {
    const page = await openFixture("lever");
    // The fixture keeps the real form's `required` attributes, so an empty
    // submit is blocked by HTML5 validation and never navigates. Fill first.
    await page.fill("#name", "Ada Lovelace");
    await page.fill("#email", "ada@example.com");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/submitted/);

    expect(await adapterFor("LEVER").detectSubmitted(page)).toBe(true);
  }, 60_000);

  it("is false on an error page, because an error is not a submission", async () => {
    const page = await openFixture("greenhouse", "/rejected");
    expect(await adapterFor("GREENHOUSE").detectSubmitted(page)).toBe(false);
  }, 60_000);
});

describe("detectError", () => {
  it("is null on a clean, untouched form", async () => {
    const page = await openFixture("greenhouse");
    expect(await adapterFor("GREENHOUSE").detectError(page)).toBeNull();
  }, 60_000);

  it("reads the message off the error page", async () => {
    const page = await openFixture("greenhouse", "/rejected");
    expect(await adapterFor("GREENHOUSE").detectError(page)).toContain(
      "This field is required",
    );
  }, 60_000);
});
