/**
 * Deciding which screenshot file the web app is allowed to open.
 *
 * Shadow runs store `screenshotPath` as an absolute path on this machine
 * (written by run-application.ts into ./shadow-runs). Serving one means
 * turning a row in the database into a file read — and a file read driven by
 * stored text is exactly the shape of a path-traversal bug, which is why this
 * lives in its own module with its own tests rather than inline in the route.
 *
 * Two separate rules, and both matter:
 *
 *  1. The route takes a run *id*, never a path. A client-supplied path would
 *     let anyone who can reach this app (it is reachable over the network; see
 *     src/middleware.ts) read arbitrary files off the candidate's disk.
 *
 *  2. Even the stored path is checked, because "the database said so" is not a
 *     security boundary. A row can be wrong — hand-edited, restored from
 *     another machine, or written by a future code path that resolves a path
 *     from somewhere less careful. The cost of checking is one string compare.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * The directory screenshots are written to.
 *
 * Deliberately the same expression as SHOT_DIR in src/lib/apply/run-application.ts
 * — `resolve("./shadow-runs")`, relative to the process working directory —
 * rather than an import of it: that module pulls in Playwright and the whole
 * apply pipeline, and a route that serves a PNG should not drag a browser
 * driver into the server bundle. Exported so the test can build paths against
 * the real directory instead of hard-coding one.
 */
export const SCREENSHOT_DIR = resolve("./shadow-runs");

/**
 * Absolute path to serve, or null when `storedPath` escapes SCREENSHOT_DIR.
 *
 * Null is also the answer for the directory itself and for an empty string:
 * neither names a file, and both would otherwise sail through a containment
 * check that only asks "is this inside".
 *
 * Note what this does NOT do: it never touches the filesystem, so it cannot
 * follow a symlink planted inside the directory, and it does not check that
 * the file exists. Both are the caller's job — existence because the route has
 * to 404 for deleted screenshots anyway, and staying off the disk because it
 * keeps this function pure and therefore actually testable.
 */
export function resolveScreenshot(storedPath: string): string | null {
  // An empty or whitespace-only path resolves to SCREENSHOT_DIR itself, which
  // would read as "contained" to every check below. Reject it up front.
  if (storedPath.trim() === "") return null;

  // `resolve` normalises away `..` and `.` segments and applies the platform's
  // separator rules. An absolute stored path (the normal case) replaces the
  // base entirely; a relative one is interpreted against the screenshot
  // directory, which is the only base that would ever make sense here.
  const absolute = resolve(SCREENSHOT_DIR, storedPath);

  // Containment, the careful way. A raw `startsWith` on the string is wrong:
  // "<dir>-evil/x.png" starts with "<dir>" and is a completely different
  // directory. `relative` answers the real question — how do you get from the
  // screenshot directory to this path — and on Windows it compares
  // case-insensitively, which matters because "C:\...\Shadow-Runs\x.png" and
  // "C:\...\shadow-runs\x.png" are the same file to the filesystem.
  const step = relative(SCREENSHOT_DIR, absolute);

  // Empty means the two paths are the same: the directory, not a file in it.
  if (step === "") return null;

  // Absolute means there is no relative route at all — on Windows that is a
  // different drive letter, e.g. D:\secrets\x.png from a C:\ base.
  if (isAbsolute(step)) return null;

  // Leading ".." means walking out of the directory first. Compare on a
  // separator boundary so a legitimately-named "..sneaky.png" is not caught.
  if (step === ".." || step.startsWith(`..${sep}`)) return null;

  return absolute;
}
