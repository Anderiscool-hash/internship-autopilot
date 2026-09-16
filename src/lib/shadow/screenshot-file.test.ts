/**
 * Tests for which screenshot file the web app will open.
 *
 * This file exists because `resolveScreenshot` is the only thing standing
 * between a row in the database and an arbitrary file read on the candidate's
 * machine. The app is reachable over the network — it refuses remote requests
 * without APP_PASSWORD, which is protection, not immunity — and the data it
 * sits next to is a résumé, a work-authorization answer and a live browser
 * session file. A containment check that is quietly wrong fails open: the
 * route still returns 200, still returns bytes, and nothing looks broken.
 *
 * The negative cases are the point. The one worth naming is the sibling
 * directory: `<dir>-evil/x.png` passes a `startsWith` check and is not in the
 * directory at all, so if someone ever "simplifies" the comparison back to a
 * prefix test, that case is what catches it.
 */

import { describe, it, expect } from "vitest";
import { join, resolve, sep } from "node:path";
import { SCREENSHOT_DIR, resolveScreenshot } from "./screenshot-file";

describe("resolveScreenshot", () => {
  it("resolves a screenshot that really is in the directory", () => {
    // The shape run-application.ts writes: `<jobId>-<timestamp>.png`.
    const stored = join(SCREENSHOT_DIR, "clx1abc-1757980800000.png");
    expect(resolveScreenshot(stored)).toBe(stored);
  });

  it("refuses a `..` traversal out of the directory", () => {
    // Built by concatenation rather than join() so the `..` segments are still
    // in the string when resolveScreenshot gets it — join() would normalise
    // them away first and quietly test nothing.
    const stored = `${SCREENSHOT_DIR}${sep}..${sep}..${sep}etc${sep}passwd`;
    expect(resolveScreenshot(stored)).toBeNull();

    // The same attack expressed as a relative path, since a stored value is
    // only absolute by convention.
    expect(resolveScreenshot("../../etc/passwd")).toBeNull();
  });

  it("refuses an absolute path somewhere else entirely", () => {
    expect(resolveScreenshot(resolve(SCREENSHOT_DIR, "..", "..", "secrets", "key.png"))).toBeNull();

    // Windows resolves this to C:\etc\passwd, POSIX to /etc/passwd. Outside
    // the screenshot directory either way.
    expect(resolveScreenshot("/etc/passwd")).toBeNull();
  });

  it("refuses a sibling directory that merely starts with the same characters", () => {
    // `startsWith(SCREENSHOT_DIR)` says yes to every one of these. They are a
    // different directory. This is the assertion that makes the prefix check
    // unacceptable as an implementation.
    expect(resolveScreenshot(`${SCREENSHOT_DIR}-evil${sep}x.png`)).toBeNull();
    expect(resolveScreenshot(`${SCREENSHOT_DIR}-backup${sep}shot.png`)).toBeNull();
    expect(resolveScreenshot(`${SCREENSHOT_DIR}.png`)).toBeNull();
  });

  it("refuses the directory itself and an empty path", () => {
    // Both are "inside" by any containment test but name no file, and an empty
    // string resolves straight to SCREENSHOT_DIR — the exact value a missing
    // or blanked-out database column would produce.
    expect(resolveScreenshot(SCREENSHOT_DIR)).toBeNull();
    expect(resolveScreenshot(`${SCREENSHOT_DIR}${sep}`)).toBeNull();
    expect(resolveScreenshot("")).toBeNull();
    expect(resolveScreenshot("   ")).toBeNull();
  });

  it("allows a nested subdirectory, which is still contained", () => {
    // Nothing writes subdirectories today, but containment — not directory
    // depth — is the rule being enforced, and a future "one folder per run"
    // layout should not need this file changed.
    const stored = join(SCREENSHOT_DIR, "2026-09", "clx1abc.png");
    expect(resolveScreenshot(stored)).toBe(stored);
  });

  it.skipIf(process.platform !== "win32")(
    "treats a differently-cased drive path as the same directory on Windows",
    () => {
      // Windows filesystems are case-insensitive, so "Shadow-Runs" and
      // "shadow-runs" are one directory. A case-sensitive containment check
      // would reject a perfectly valid stored path — a 404 on a screenshot
      // that exists, which is the quiet half of getting this wrong.
      const stored = join(SCREENSHOT_DIR.toUpperCase(), "clx1abc-1757980800000.png");
      expect(resolveScreenshot(stored)).not.toBeNull();
    },
  );
});
