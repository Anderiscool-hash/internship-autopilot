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
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium, type Browser } from "playwright";
import { db } from "../src/lib/db";
import {
  ApplicationRunError,
  reportRun,
  runApplication,
} from "../src/lib/apply/run-application";
import { HANDSHAKE_PATH, type DaemonRunRequest } from "../src/lib/apply/daemon-client";

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

  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, {
      ok: true,
      pid: process.pid,
      browserReady: Boolean(browser?.isConnected()),
      running,
      completed,
    });
  }

  if (request.method === "POST" && request.url === "/apply") {
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

  if (request.method === "POST" && request.url === "/stop") {
    json(response, 200, { stopping: true });
    setTimeout(() => void shutdown(0), 50);
    return;
  }

  json(response, 404, { error: "not found" });
}

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
