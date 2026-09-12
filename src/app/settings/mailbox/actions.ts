"use server";

/**
 * Saving and testing the mailbox credentials.
 *
 * Writes to .env rather than the database, matching how every other secret in
 * this project is held: .env is gitignored, a database dump is not.
 *
 * Nothing here ever sends a password back to the browser. The screen learns
 * whether one is set, and what happened when it was used — never its value.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ImapFlow } from "imapflow";
import { writeEnvVars } from "@/lib/email/env-file";
import { inboxConfig } from "@/lib/email/inbox";

function back(params: Record<string, string>): never {
  redirect(`/settings/mailbox?${new URLSearchParams(params).toString()}`);
}

function text(form: FormData, field: string): string {
  return String(form.get(field) ?? "").trim();
}

export async function saveMailboxAction(form: FormData): Promise<void> {
  const host = text(form, "host");
  const user = text(form, "user");
  const port = text(form, "port");
  const tls = form.get("tls") === "on";
  const rawPassword = String(form.get("password") ?? "");

  if (host.length === 0 || user.length === 0) {
    back({ error: "A mail server and an address are both needed." });
  }

  // Google displays app passwords as "abcd efgh ijkl mnop". The spaces are
  // presentation; IMAP rejects them. Stripping here means a person who pastes
  // what they see gets a working mailbox instead of an auth failure they have
  // no way to diagnose.
  const password = rawPassword.replace(/\s+/g, "");

  writeEnvVars({
    IMAP_HOST: host,
    IMAP_USER: user,
    IMAP_PORT: port.length > 0 ? port : "993",
    IMAP_TLS: tls ? "true" : "false",
    // An empty box means "leave the stored password alone", not "erase it" —
    // the field renders blank every time precisely because the value is never
    // sent to the browser, so treating blank as a deletion would wipe the
    // password every time anything else on this form was changed.
    ...(password.length > 0 ? { IMAP_PASSWORD: password } : {}),
  });

  // The running process keeps its own copy of the environment, and .env is only
  // read at startup. Updating it here means the Test button works on the values
  // just saved rather than on whatever was loaded when the server booted.
  process.env.IMAP_HOST = host;
  process.env.IMAP_USER = user;
  process.env.IMAP_PORT = port.length > 0 ? port : "993";
  process.env.IMAP_TLS = tls ? "true" : "false";
  if (password.length > 0) process.env.IMAP_PASSWORD = password;

  revalidatePath("/settings/mailbox");
  back({ saved: "mailbox" });
}

/**
 * Connect, look, and disconnect.
 *
 * Opens the INBOX read-only and counts the last day's mail — enough to prove
 * the credentials work without reading anything. Finding out here beats
 * finding out in the middle of an application.
 */
export async function testMailboxAction(): Promise<void> {
  const config = inboxConfig();
  if (config === null) {
    back({ error: "Nothing is configured yet — save a server, address and password first." });
  }

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
    back({
      error:
        `Could not sign in: ${detail}. ` +
        "With Gmail this nearly always means an account password was used instead of an app password.",
    });
  }

  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      let recent = 0;
      for await (const _message of client.fetch({ since }, { uid: true })) recent += 1;

      back({
        tested: `Connected. ${recent} message${recent === 1 ? "" : "s"} arrived in the last 24 hours — that is the widest window this ever looks at.`,
      });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
