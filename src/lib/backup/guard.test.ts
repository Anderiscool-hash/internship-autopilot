/**
 * Tests for the wrong-database guard.
 *
 * The failure being prevented: DATABASE_URL points somewhere unintended — a
 * pasted connection string, a staging server, someone else's box — and the
 * import writes this candidate's profile, Truth Ledger and application history
 * over whatever was already there. Nothing about that failure looks like a
 * failure while it happens. The rows go in cleanly and the script says Done.
 *
 * The two cases that MUST pass are as important as the refusals: a fresh
 * empty server (the normal migration) and a re-import onto the machine the
 * backup came from (the normal catch-up). A guard that cries wolf on either of
 * those gets --force'd out of habit, and then it is not a guard any more.
 */

import { describe, it, expect } from "vitest";
import {
  FORCE_OVERRIDES,
  checkTargetIdentity,
  describeForceEscapeHatch,
} from "./guard";

describe("checkTargetIdentity", () => {
  it("allows an empty target — the migration this tool is for", () => {
    const verdict = checkTargetIdentity({
      backupEmails: ["me@example.com"],
      targetEmails: [],
      targetRowCount: 0,
    });

    expect(verdict.ok).toBe(true);
  });

  it("allows a re-import onto the same person's database", () => {
    const verdict = checkTargetIdentity({
      backupEmails: ["me@example.com"],
      targetEmails: ["me@example.com"],
      targetRowCount: 2800,
    });

    expect(verdict.ok).toBe(true);
  });

  it("ignores capitalisation and stray whitespace in the match", () => {
    // Email case is not meaningful, and a trailing space pasted into a form
    // should not read as a different person.
    const verdict = checkTargetIdentity({
      backupEmails: ["Me@Example.com "],
      targetEmails: ["me@example.com"],
      targetRowCount: 2800,
    });

    expect(verdict.ok).toBe(true);
  });

  it("REFUSES a populated database belonging to someone else", () => {
    // The whole point.
    const verdict = checkTargetIdentity({
      backupEmails: ["me@example.com"],
      targetEmails: ["someone.else@example.com"],
      targetRowCount: 5000,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // The message has to name both sides, or it is not actionable at 2am.
    expect(verdict.reason).toContain("me@example.com");
    expect(verdict.reason).toContain("someone.else@example.com");
    expect(verdict.reason).toContain("DATABASE_URL");
  });

  it("refuses a non-empty database that has no candidate at all", () => {
    // Rows but no candidate means this database was never one of ours — a
    // half-seeded scratch database, say. Still not a thing to write over.
    const verdict = checkTargetIdentity({
      backupEmails: ["me@example.com"],
      targetEmails: [],
      targetRowCount: 40_000,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("40000");
  });

  it("refuses when the backup names nobody and the target is not empty", () => {
    // With no candidate in the file there is no way to check whose data it
    // is. Unverifiable plus destructive-if-wrong means stop.
    const verdict = checkTargetIdentity({
      backupEmails: [],
      targetEmails: ["me@example.com"],
      targetRowCount: 10,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("no candidate");
  });

  it("allows a backup with no candidate into a genuinely empty database", () => {
    // Nothing can be lost, so there is nothing to protect.
    const verdict = checkTargetIdentity({
      backupEmails: [],
      targetEmails: [],
      targetRowCount: 0,
    });

    expect(verdict.ok).toBe(true);
  });

  it("allows a match even when the target has other candidates too", () => {
    // One shared candidate is enough: this is a database we belong in.
    const verdict = checkTargetIdentity({
      backupEmails: ["me@example.com"],
      targetEmails: ["colleague@example.com", "me@example.com"],
      targetRowCount: 900,
    });

    expect(verdict.ok).toBe(true);
  });
});

describe("the --force escape hatch", () => {
  it("documents what it switches off", () => {
    // A flag whose description is vaguer than its effect gets used casually.
    expect(FORCE_OVERRIDES.length).toBeGreaterThan(0);
    for (const line of FORCE_OVERRIDES) {
      expect(line.length).toBeGreaterThan(20);
    }
  });

  it("says plainly what it does NOT switch off", () => {
    const text = describeForceEscapeHatch();
    expect(text).toContain("--force");
    expect(text).toContain("coverage");
    expect(text).toContain("--dry-run");
    // No deletes, forced or otherwise — this is a restore, not a mirror.
    expect(text).toContain("no row is ever");
  });
});
