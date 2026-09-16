/**
 * Serving the screenshot of a shadow run.
 *
 * The review panel used to print the filesystem path as text, because nothing
 * served these files and an <img> would have rendered as broken. This is the
 * route that makes the image real — which matters, since the screenshot is the
 * whole evidence a human is asked to judge a run on, and "open this path in
 * your file manager" is not a review workflow.
 *
 * The URL carries a run *id*, never a path. This app is reachable over the
 * network (src/middleware.ts refuses remote requests without APP_PASSWORD), so
 * a path in the URL would be a direct read of the candidate's filesystem by
 * anyone who got past the door. The id is looked up, the stored path comes off
 * the row, and even that is re-checked against the screenshot directory by
 * resolveScreenshot — all the judgement lives there, where it is tested.
 */

import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { resolveScreenshot } from "@/lib/shadow/screenshot-file";

export const dynamic = "force-dynamic";

interface ScreenshotRouteContext {
  // Next 15 hands route params to the handler as a Promise, the same shape
  // src/app/jobs/[id]/page.tsx awaits.
  params: Promise<{ id: string }>;
}

/**
 * One 404 for every way this can fail.
 *
 * No missing run, rejected path, or deleted file is distinguished in the
 * response, and the path is never echoed back — the reply tells a caller
 * nothing about what does or does not exist on the disk.
 */
function notFound(): Response {
  return new Response("No screenshot for that run.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(_request: Request, context: ScreenshotRouteContext) {
  const { id } = await context.params;

  const run = await db.shadowRun.findUnique({
    where: { id },
    select: { screenshotPath: true },
  });

  if (run === null) return notFound();

  const file = resolveScreenshot(run.screenshotPath);
  if (file === null) return notFound();

  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    // Screenshots are ordinary files in a gitignored directory: old ones get
    // cleaned up, and a run restored from another machine points at a path
    // that never existed here. The page showing a stale <img> must degrade to
    // a broken image, not a 500 — so a missing file is a 404, not an error.
    return notFound();
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/png",
      // A screenshot never changes once written, but it is a picture of the
      // candidate's half-filled application form. Private, so no proxy keeps
      // a copy; immutable, so the browser does not refetch it on every review.
      "cache-control": "private, max-age=3600, immutable",
    },
  });
}
