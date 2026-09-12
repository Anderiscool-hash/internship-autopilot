/**
 * Talking to the background apply daemon.
 *
 * The daemon writes a handshake file when it starts and deletes it when it
 * stops; this reads that file to find the port and token. A file rather than a
 * fixed port so a stale config cannot point at something that is not the
 * daemon, and a token so that a process which merely guessed the port cannot
 * drive a browser full of the candidate's personal details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Gitignored: it holds the daemon's token. */
export const HANDSHAKE_PATH = resolve("./storage/apply-daemon.json");

export interface DaemonHandshake {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

/** What a caller asks the daemon to do. */
export interface DaemonRunRequest {
  jobId: string;
  keepOpen?: boolean;
  handoff?: boolean;
  ask?: boolean;
  verify?: boolean;
}

/** Read the handshake, or null when no daemon has written one. */
export function readHandshake(): DaemonHandshake | null {
  try {
    const parsed = JSON.parse(readFileSync(HANDSHAKE_PATH, "utf8")) as DaemonHandshake;
    if (typeof parsed.port !== "number" || typeof parsed.token !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Is a daemon actually answering?
 *
 * The handshake file existing is not enough — a daemon killed with SIGKILL
 * leaves its file behind, and a run handed to a dead process is a run that
 * never happens and never says so.
 */
export async function daemonStatus(): Promise<DaemonHandshake | null> {
  const handshake = readHandshake();
  if (!handshake) return null;

  try {
    const response = await fetch(`http://127.0.0.1:${handshake.port}/health`, {
      headers: { authorization: `Bearer ${handshake.token}` },
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok ? handshake : null;
  } catch {
    return null;
  }
}

/** Ask the daemon to run one application. True when it accepted. */
export async function submitToDaemon(request: DaemonRunRequest): Promise<boolean> {
  const handshake = readHandshake();
  if (!handshake) return false;

  try {
    const response = await fetch(`http://127.0.0.1:${handshake.port}/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${handshake.token}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
