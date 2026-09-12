/**
 * Writing the mailbox credentials into .env.
 *
 * Secrets live in .env in this project, never in the database — the AI
 * settings row deliberately has no key column for the same reason, and .env is
 * gitignored while a database dump is not. But making someone hand-edit a
 * dotfile to use a feature is how features go unused, so the settings screen
 * writes it for them.
 *
 * The rules this file follows:
 *   - rewrite in place, preserving every other line, comment and ordering. A
 *     settings screen that silently reformats the file holding every other
 *     secret in the project would be a bad trade.
 *   - never read a secret back out to the browser. The screen is told whether
 *     a password is set, not what it is.
 */

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

export const ENV_PATH = resolve(".env");

/** The variables this screen owns. Nothing else in .env is touched. */
export type MailboxVar = "IMAP_HOST" | "IMAP_PORT" | "IMAP_USER" | "IMAP_PASSWORD" | "IMAP_TLS";

/**
 * Set each given variable, leaving the rest of the file exactly as it was.
 *
 * A key already present is rewritten where it stands, so the comment block
 * above it keeps describing the right thing. A new key is appended.
 */
export function writeEnvVars(
  values: Partial<Record<MailboxVar, string>>,
  /** The file to edit. A parameter so this is testable without a real .env. */
  path: string = ENV_PATH,
): void {
  // A test may never write to the real .env, and this is enforced rather than
  // documented because the documented version already failed: an intermediate
  // version of this file's own test called writeEnvVars() with no path, the
  // default resolved to the project's .env, and the run replaced it with two
  // lines — destroying DATABASE_URL and every other secret in it. The app kept
  // working only because the dev server had already read it into memory.
  //
  // The default argument is the whole hazard: it makes "write to the real
  // environment file" the thing that happens when a caller says nothing.
  if (process.env.NODE_ENV === "test" && path === ENV_PATH) {
    throw new Error(
      "writeEnvVars refused: a test tried to write to the real .env. Pass an explicit path.",
    );
  }

  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;

    // A value with a space, a quote or a hash has to be quoted or dotenv will
    // truncate it at the delimiter. App passwords are generated without
    // spaces, but a person pasting one from Google's UI may include them.
    const needsQuotes = /[\s#"']/.test(value);
    const written = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
    const line = `${key}=${written}`;

    const index = lines.findIndex((existing) => {
      const trimmed = existing.trimStart();
      // Not a comment, and assigns this exact key.
      return !trimmed.startsWith("#") && trimmed.startsWith(`${key}=`);
    });

    if (index >= 0) lines[index] = line;
    else lines.push(line);
  }

  writeFileSync(path, lines.join("\n"), "utf8");

  // Owner-only where the platform honours it. This file now holds a live
  // mailbox password.
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows largely ignores this; the file is gitignored either way.
  }
}

/**
 * What the settings screen is allowed to know about the stored password.
 *
 * Never the password itself. A settings page that renders a secret into HTML
 * puts it in the browser's history, in any screenshot, and in the page source.
 */
export interface MailboxStatus {
  configured: boolean;
  host: string | null;
  user: string | null;
  port: number;
  tls: boolean;
  /** True when a password is present, without saying what it is. */
  hasPassword: boolean;
}

export function mailboxStatus(
  env: Record<string, string | undefined> = process.env,
): MailboxStatus {
  const host = env.IMAP_HOST?.trim() || null;
  const user = env.IMAP_USER?.trim() || null;
  const hasPassword = Boolean(env.IMAP_PASSWORD && env.IMAP_PASSWORD.length > 0);
  const port = Number(env.IMAP_PORT ?? 993);

  return {
    configured: Boolean(host && user && hasPassword),
    host,
    user,
    port: Number.isFinite(port) ? port : 993,
    tls: env.IMAP_TLS !== "false",
    hasPassword,
  };
}
