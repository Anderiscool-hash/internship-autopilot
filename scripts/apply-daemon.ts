/**
 * The background apply daemon.
 *
 *   npm run daemon
 *
 * Keeps a browser warm and a database connection open so an application does
 * not pay for a cold start every time. Measured on this machine: a run costs
 * about 9.2s end to end, of which ~1.3s is Node and tsx booting and ~0.4s is
 * Chromium launching. The daemon removes both.
 *
 * The larger reason it exists is sessions. Portals like Workday make you
 * create an account before the form is even visible, and a process that dies
 * after every run starts logged out every time. Cookies are saved to
 * storage/browser-session.json and restored on the next run, so signing in
 * once is enough.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT LISTENS ON, AND WHY THAT IS SAFE
 *
 * 127.0.0.1 only — never a LAN address. This endpoint drives a browser and
 * fills forms with a real person's name, address and phone number, so it must
 * not be reachable from the network the machine happens to be on.
 *
 * A bearer token on top of that, generated fresh at startup and written to a
 * gitignored handshake file that only local processes can read. Loopback alone
 * would let any process on the machine that guessed the port start
 * applications for jobs.
 *
 * Runs are serialized. Two applications filling at once would fight over the
 * window focus, and the person answering the in-page questions can only look
 * at one form at a time anyway.
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT ANSWERS
 *
 *   GET  /health          is it alive, is the browser warm, how much has it done
 *   POST /apply           a shadow run against a job id (see DaemonRunRequest)
 *   POST /apply-run       the apply worker against an application id; answers
 *                         with a runId rather than waiting for the run
 *   GET  /run?id=<runId>  what that run did, or is still doing
 *   POST /stop            shut down
 *
 * Every one of them needs the bearer token, /health included.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ApplicationStatus } from "@prisma/client";
import { chromium, type Browser } from "playwright";
import { db } from "../src/lib/db";
import {
  ApplicationRunError,
  reportRun,
  runApplication,
} from "../src/lib/apply/run-application";
import { runApplyWorker, type WorkerResult } from "../src/lib/apply/worker";
import {
  HANDSHAKE_PATH,
  type ApplyRunRequest,
  type DaemonRunRequest,
} from "../src/lib/apply/daemon-client";

const PORT = Number(process.env.APPLY_DAEMON_PORT ?? 4319);
const TOKEN = randomBytes(24).toString("hex");

/** One run at a time. See the note at the top. */
let queue: Promise<unknown> = Promise.resolve();
let running = 0;
let completed = 0;

let browser: Browser | null = null;

/**
 * The warm browser, launched on first use rather than at startup.
 *
 * Starting it eagerly would open a Chromium window the moment the daemon runs,
 * which is startling when the daemon is meant to sit quietly in a terminal.
 */
async function warmBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: false });
  return browser;
}

/** Bearer check. Constant-time is overkill for a loopback token; length is not. */
function authorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization ?? "";
  return header === `Bearer ${TOKEN}`;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    console.error("Daemon request failed:", error);
    if (!response.headersSent) json(response, 500, { error: "internal" });
  });
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!authorized(request)) return json(response, 401, { error: "unauthorized" });

  // Parsed rather than compared with ===, so /run?id=... can carry a param.
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = parsed.pathname;

  if (request.method === "GET" && path === "/health") {
    return json(response, 200, {
      ok: true,
      pid: process.pid,
      browserReady: Boolean(browser?.isConnected()),
      running,
      completed,
    });
  }

  if (request.method === "POST" && path === "/apply") {
    let body: DaemonRunRequest;
    try {
      body = JSON.parse(await readBody(request)) as DaemonRunRequest;
    } catch {
      return json(response, 400, { error: "bad json" });
    }
    if (!body.jobId) return json(response, 400, { error: "jobId is required" });

    // Accept now, run in order. The caller is a CLI or a web button; neither
    // should sit holding a socket open for the length of an application, and a
    // handoff run stays open until the person closes the window.
    queue = queue.then(() => runOne(body)).catch(() => undefined);
    return json(response, 202, { accepted: true });
  }

  if (request.method === "POST" && path === "/apply-run") {
    let body: ApplyRunRequest;
    try {
      body = JSON.parse(await readBody(request)) as ApplyRunRequest;
    } catch {
      return json(response, 400, { error: "bad json" });
    }
    if (!body.applicationId || !body.candidateId) {
      return json(response, 400, { error: "applicationId and candidateId are required" });
    }

    const runId = randomBytes(8).toString("hex");
    runs.set(runId, { state: "running" });

    // The same queue the shadow runs use, not a second one: a submission and a
    // shadow run both drive the one warm browser, and two of them at once would
    // fight over the window focus.
    queue = queue
      .then(async () => {
        const result = await runApplyWorker(db, {
          applicationId: body.applicationId,
          candidateId: body.candidateId,
          // JSON has no Date type, so `at` arrives as a string and the worker
          // writes it to the attempt row as-is. Rehydrate it here.
          authorization: body.authorization
            ? { ...body.authorization, at: new Date(body.authorization.at) }
            : undefined,
          // Passed unevaluated: the worker's early exits must not pay for a
          // browser launch.
          browser: warmBrowser,
          log: (line: string) => console.log(line),
        });
        runs.set(runId, { state: "done", result });
      })
      .catch((error: unknown) => {
        // A run that blew up must not sit at "running" forever — whoever is
        // polling would wait on it until the daemon restarts.
        runs.set(runId, {
          state: "done",
          result: {
            applicationId: body.applicationId,
            finalStatus: ApplicationStatus.FAILED,
            attemptId: null,
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      });

    return json(response, 202, { accepted: true, runId });
  }

  if (request.method === "GET" && path === "/run") {
    const entry = runs.get(parsed.searchParams.get("id") ?? "");
    // Not a 404: an id the registry has never heard of is most likely one lost
    // to a restart, which is a thing that happened rather than a mistake the
    // caller made.
    if (!entry) return json(response, 200, { state: "unknown" });
    return json(response, 200, entry);
  }

  if (request.method === "POST" && path === "/stop") {
    json(response, 200, { stopping: true });
    setTimeout(() => void shutdown(0), 50);
    return;
  }

  json(response, 404, { error: "not found" });
}

/**
 * What each worker run did, by id.
 *
 * In memory and lost on restart, like the queue itself — but unlike a shadow
 * run, a submission's result is also written to SubmissionAttempt, so this is a
 * convenience for the UI rather than the record of what happened.
 */
const runs = new Map<string, { state: "running" | "done"; result?: WorkerResult }>();

/** Run one application on the shared browser. */
async function runOne(request: DaemonRunRequest): Promise<void> {
  running += 1;
  const started = Date.now();
  try {
    const outcome = await runApplication(db, {
      jobId: request.jobId,
      keepOpen: request.keepOpen,
      handoff: request.handoff,
      ask: request.ask,
      verify: request.verify,
      browser: await warmBrowser(),
      persistSession: true,
      log: (line) => console.log(line),
    });

    reportRun(outcome, (line) => console.log(line));
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    completed += 1;
  } catch (error) {
    if (error instanceof ApplicationRunError) console.error(`\n${error.message}`);
    else console.error("\nRun failed:", error);
  } finally {
    running -= 1;
  }
}

async function shutdown(code: number): Promise<void> {
  console.log("\nStopping.");
  // Remove the handshake first, so nothing hands this process work while it is
  // going away.
  rmSync(HANDSHAKE_PATH, { force: true });
  server.close();
  await browser?.close().catch(() => undefined);
  await db.$disconnect().catch(() => undefined);
  process.exit(code);
}

function main(): void {
  mkdirSync(dirname(HANDSHAKE_PATH), { recursive: true });

  // Loopback only. Passing "127.0.0.1" rather than omitting the host is the
  // whole security boundary: the default binds every interface, which would
  // put this on the Wi-Fi.
  server.listen(PORT, "127.0.0.1", () => {
    writeFileSync(
      HANDSHAKE_PATH,
      JSON.stringify(
        { port: PORT, token: TOKEN, pid: process.pid, startedAt: new Date().toISOString() },
        null,
        2,
      ),
      // Owner-only where the platform honours it.
      { mode: 0o600 },
    );

    console.log(`Apply daemon listening on 127.0.0.1:${PORT} (pid ${process.pid}).`);
    console.log("The browser starts on the first application, not now.");
    console.log("\nSend it work with the usual command — it will be handed over automatically:");
    console.log("  npm run shadow -- <jobId> --handoff");
    console.log("\nOr from the job page's \"Fill this application for me\" button.");
    console.log("\nCtrl+C to stop.");
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown(0));
  }
}

main();
