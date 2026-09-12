/**
 * Rewriting .env in place.
 *
 * The file being edited holds every other secret in the project, so the
 * behaviour that matters most is what this DOESN'T touch.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mailboxStatus, writeEnvVars } from "./env-file";

describe("mailboxStatus", () => {
  it("is unconfigured when anything is missing", () => {
    expect(mailboxStatus({}).configured).toBe(false);
    expect(mailboxStatus({ IMAP_HOST: "h", IMAP_USER: "u" }).configured).toBe(false);
    expect(mailboxStatus({ IMAP_HOST: "h", IMAP_PASSWORD: "p" }).configured).toBe(false);
  });

  it("is configured when host, user and password are all present", () => {
    const status = mailboxStatus({ IMAP_HOST: "imap.gmail.com", IMAP_USER: "a@b.com", IMAP_PASSWORD: "x" });
    expect(status.configured).toBe(true);
    expect(status.host).toBe("imap.gmail.com");
    expect(status.user).toBe("a@b.com");
  });

  // The password must never be part of what this returns. A settings page that
  // renders a secret puts it in the browser history and in every screenshot.
  it("reports that a password exists without revealing it", () => {
    const status = mailboxStatus({ IMAP_HOST: "h", IMAP_USER: "u", IMAP_PASSWORD: "super-secret" });
    expect(status.hasPassword).toBe(true);
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });

  it("defaults the port to 993 and keeps TLS on unless explicitly disabled", () => {
    const base = { IMAP_HOST: "h", IMAP_USER: "u", IMAP_PASSWORD: "p" };
    expect(mailboxStatus(base).port).toBe(993);
    expect(mailboxStatus(base).tls).toBe(true);
    expect(mailboxStatus({ ...base, IMAP_TLS: "false" }).tls).toBe(false);
    expect(mailboxStatus({ ...base, IMAP_PORT: "nonsense" }).port).toBe(993);
  });
});

describe("writeEnvVars", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "envtest-"));
    file = join(dir, ".env");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(values: Record<string, string>) {
    writeEnvVars(values, file);
    return readFileSync(file, "utf8");
  }

  it("leaves every other line untouched", () => {
    writeFileSync(
      file,
      ["# a comment", "DATABASE_URL=postgres://localhost/x", "", "OTHER=keep-me"].join("\n"),
      "utf8",
    );

    const after = write({ IMAP_HOST: "imap.gmail.com" });

    expect(after).toContain("# a comment");
    expect(after).toContain("DATABASE_URL=postgres://localhost/x");
    expect(after).toContain("OTHER=keep-me");
    expect(after).toContain("IMAP_HOST=imap.gmail.com");
  });

  it("rewrites a key in place rather than appending a second one", () => {
    writeFileSync(file, "IMAP_HOST=old.example.com\nOTHER=x", "utf8");

    const after = write({ IMAP_HOST: "new.example.com" });

    expect(after).toContain("IMAP_HOST=new.example.com");
    expect(after).not.toContain("old.example.com");
    // Exactly one assignment, or dotenv's last-wins would hide the bug.
    expect(after.split("\n").filter((l) => l.startsWith("IMAP_HOST=")).length).toBe(1);
  });

  it("does not mistake a commented-out key for a real one", () => {
    writeFileSync(file, "# IMAP_HOST=example.com\nOTHER=x", "utf8");

    const after = write({ IMAP_HOST: "real.example.com" });

    expect(after).toContain("# IMAP_HOST=example.com");
    expect(after).toContain("IMAP_HOST=real.example.com");
  });

  // Google shows app passwords as "abcd efgh ijkl mnop". A person who pastes
  // it with the spaces must not end up with a value truncated at the first one.
  it("quotes a value containing spaces", () => {
    const after = write({ IMAP_PASSWORD: "abcd efgh ijkl mnop" });
    expect(after).toContain('IMAP_PASSWORD="abcd efgh ijkl mnop"');
  });
});

describe("the guard that exists because this destroyed a real .env", () => {
  it("refuses to write to the project's own .env from a test", () => {
    // An earlier version of THIS file called writeEnvVars with no path. The
    // default resolved to the real .env and the run replaced it with two
    // lines, taking DATABASE_URL with it. The guard makes that impossible
    // rather than merely discouraged.
    expect(() => writeEnvVars({ IMAP_HOST: "should-never-be-written" })).toThrow(
      /refused/i,
    );
  });

  it("still writes happily to an explicit path", () => {
    const dir = mkdtempSync(join(tmpdir(), "envguard-"));
    const file = join(dir, ".env");
    try {
      writeEnvVars({ IMAP_HOST: "imap.example.com" }, file);
      expect(readFileSync(file, "utf8")).toContain("IMAP_HOST=imap.example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
