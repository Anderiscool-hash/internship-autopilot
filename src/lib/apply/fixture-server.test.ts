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
    expect(server.posts[0]?.path).toBe("/apply");
    expect(server.posts[0]?.body).toContain("Ada+Lovelace");
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
    // The fixture keeps the real forms' `required` attributes, so the browser
    // refuses to navigate on an empty form. Fill them, or this asserts nothing
    // more than that HTML5 validation works.
    await page.fill("#_systemfield_name", "Ada Lovelace");
    await page.fill("#_systemfield_email", "ada@example.com");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/submitted/);

    expect(await page.locator("body").innerText()).toContain("Application submitted");
    expect(server.posts).toHaveLength(1);
  }, 60_000);

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
