/**
 * The Hunter key's .env handling.
 *
 * Two things are worth asserting and nothing else is: that the status object
 * cannot leak the key, and that writing it leaves the rest of .env alone.
 *
 * Every write here goes to a temp file created with mkdtempSync. writeEnvVars
 * throws if a test aims at the real .env (env-file.ts:46-50), and that guard
 * exists because an earlier test did exactly that and replaced the project's
 * .env with two lines, destroying DATABASE_URL. Do not remove the explicit
 * path arguments below.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hunterStatus, writeOutreachVars } from "./env-file";

describe("hunterStatus", () => {
  it("is unconfigured when the variable is absent", () => {
    expect(hunterStatus({}).configured).toBe(false);
  });

  // .env.example ships HUNTER_API_KEY="" — dotenv loads that as an empty
  // string, which is the placeholder still sitting there, not a key.
  it("is unconfigured when the variable is the empty placeholder", () => {
    expect(hunterStatus({ HUNTER_API_KEY: "" }).configured).toBe(false);
    expect(hunterStatus({ HUNTER_API_KEY: "   " }).configured).toBe(false);
  });

  it("is configured when a key is present", () => {
    expect(hunterStatus({ HUNTER_API_KEY: "abc123" }).configured).toBe(true);
  });

  // The key must never be part of what this returns. A settings page that
  // renders a secret puts it in the browser history and in every screenshot.
  it("never returns the key, in any field", () => {
    const status = hunterStatus({ HUNTER_API_KEY: "super-secret-hunter-key" });
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("super-secret-hunter-key");
    expect(Object.keys(status)).toEqual(["configured"]);
  });
});

describe("writeOutreachVars", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "outreach-env-"));
    path = join(dir, ".env");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves every other secret and comment in the file untouched", () => {
    writeFileSync(
      path,
      [
        "# Database",
        "DATABASE_URL=postgres://localhost/autopilot",
        "",
        "# Mailbox",
        "IMAP_HOST=imap.gmail.com",
        "IMAP_PASSWORD=app-password",
        "",
        "# Contact finder",
        'HUNTER_API_KEY=""',
      ].join("\n"),
      "utf8",
    );

    writeOutreachVars({ HUNTER_API_KEY: "new-key" }, path);

    const after = readFileSync(path, "utf8");
    expect(after).toContain("DATABASE_URL=postgres://localhost/autopilot");
    expect(after).toContain("IMAP_PASSWORD=app-password");
    expect(after).toContain("# Contact finder");
    expect(after).toContain("HUNTER_API_KEY=new-key");
    expect(after).not.toContain('HUNTER_API_KEY=""');
  });

  it("appends the key when the file does not mention it yet", () => {
    writeFileSync(path, "DATABASE_URL=postgres://localhost/autopilot\n", "utf8");
    writeOutreachVars({ HUNTER_API_KEY: "k" }, path);
    const after = readFileSync(path, "utf8");
    expect(after).toContain("DATABASE_URL=postgres://localhost/autopilot");
    expect(after).toContain("HUNTER_API_KEY=k");
  });
});
