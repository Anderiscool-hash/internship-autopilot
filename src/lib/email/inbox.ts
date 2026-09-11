/**
 * Reading the one email an application is waiting on.
 *
 * Some portals will not let you past the first page until you confirm your
 * address. They send a code, the form waits, and doing it by hand means
 * abandoning a half-filled form, opening a mail client, and coming back.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS ALLOWED TO READ
 *
 * This connects to a personal mailbox, so the scope is deliberately tiny and
 * enforced in code rather than left to good intentions:
 *
 *   - only messages that arrived AFTER the apply run started. Mail older than
 *     the run cannot be the confirmation this run is waiting for, so there is
 *     no reason to look at it.
 *   - only the INBOX.
 *   - only until a code is found or the timeout passes, whichever is first.
 *   - nothing is stored. The message text is examined in memory, the code is
 *     handed back, and the connection closes.
 *
 * It never marks mail as read, never deletes, never moves anything.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Credentials come from the environment, never the database — see .env.example.
 * With Gmail this needs an app password, not the account password.
 */

import { ImapFlow } from "imapflow";
import { findVerification, type VerificationFinding } from "./extract-code";

export class InboxError extends Error {}

/** Mailbox connection details, read from the environment. */
export interface InboxConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

/**
 * The mailbox settings, or null when none are configured.
 *
 * Null is an ordinary state, not a failure: this feature is opt-in, and an
 * apply run with no mailbox configured simply asks the person for the code.
 */
export function inboxConfig(
  /** The variables to read. A plain record, so a test can pass just these. */
  env: Record<string, string | undefined> = process.env,
): InboxConfig | null {
  const host = env.IMAP_HOST?.trim();
  const user = env.IMAP_USER?.trim();
  const password = env.IMAP_PASSWORD;

  if (!host || !user || !password) return null;

  const port = Number(env.IMAP_PORT ?? 993);
  return {
    host,
    port: Number.isFinite(port) ? port : 993,
    // Defaults to TLS. Anyone who needs it off has to say so explicitly.
    secure: env.IMAP_TLS !== "false",
    user,
    password,
  };
}

/** What the search found, and where. */
export interface VerificationResult extends VerificationFinding {
  /** The subject line it came from, so the person can see what was used. */
  subject: string;
  from: string;
}

/**
 * Wait for a verification mail and read the code out of it.
 *
 * Polls rather than idles: the connection is opened per attempt and closed
 * again, so a run that finds its code in eight seconds is not holding a
 * mailbox session open. Returns null on timeout, which the caller must treat
 * as "ask the person", never as "proceed without confirming".
 */
export async function waitForVerification(options: {
  config: InboxConfig;
  /** Only mail after this instant is looked at. Normally the run's start. */
  since: Date;
  /** Restrict to senders at this domain when known, e.g. "greenhouse.io". */
  fromDomain?: string;
  /** Give up after this long. */
  timeoutMs?: number;
  /** How often to check. */
  pollMs?: number;
  /** Progress, for the run log. */
  onPoll?: (attempt: number) => void;
}): Promise<VerificationResult | null> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    options.onPoll?.(attempt);

    const found = await checkOnce(options.config, options.since, options.fromDomain);
    if (found) return found;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  }

  return null;
}

/** One pass over the new mail. */
async function checkOnce(
  config: InboxConfig,
  since: Date,
  fromDomain?: string,
): Promise<VerificationResult | null> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  try {
    await client.connect();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InboxError(
      `Could not reach the mailbox at ${config.host}: ${detail}. ` +
        "With Gmail this needs an app password, not your account password.",
    );
  }

  // readOnly, so nothing is marked as read by looking at it. A confirmation
  // that silently disappears from the person's unread list because a bot
  // opened it is a surprise nobody asked for.
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });

  try {
    // `since` is the whole privacy boundary: older mail is never fetched.
    const criteria: Record<string, unknown> = { since };
    if (fromDomain) criteria.from = fromDomain;

    const messages = client.fetch(criteria, { envelope: true, source: true });

    // Newest last in IMAP order, so the most recent match wins — a resent code
    // supersedes the first one.
    let best: VerificationResult | null = null;

    for await (const message of messages) {
      const envelope = message.envelope;
      // A belt-and-braces repeat of the SINCE filter: IMAP's SINCE has
      // day granularity on some servers, which would otherwise widen the
      // window to the whole of today — the difference between reading one
      // message and reading a morning's mail.
      const received = envelope?.date ? new Date(envelope.date) : null;
      if (received && received.getTime() < since.getTime()) continue;

      const text = message.source?.toString("utf8") ?? "";
      const finding = findVerification(text);
      if (!finding) continue;

      best = {
        ...finding,
        subject: envelope?.subject ?? "(no subject)",
        from: envelope?.from?.[0]?.address ?? "(unknown sender)",
      };
    }

    return best;
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}
