/**
 * Does the mailbox work?
 *
 * Connects, reports what it can see, and disconnects. Nothing is read beyond
 * counting recent messages, nothing is marked read, nothing is stored — the
 * point is to find out whether the app password is right before discovering
 * otherwise in the middle of an application.
 *
 *   npm run mailbox:check
 */

import { ImapFlow } from "imapflow";
import { inboxConfig } from "../src/lib/email/inbox";

async function main(): Promise<void> {
  const config = inboxConfig();

  if (config === null) {
    console.log("No mailbox configured.");
    console.log("Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD in .env — see .env.example.");
    process.exitCode = 1;
    return;
  }

  console.log(`Connecting to ${config.host}:${config.port} as ${config.user}`);
  console.log(`TLS: ${config.secure ? "on" : "OFF"}`);

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  try {
    await client.connect();
    console.log("Connected and signed in.");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`\nCould not sign in: ${detail}`);
    console.error(
      "\nWith Gmail this nearly always means the value in IMAP_PASSWORD is your\n" +
        "account password rather than an app password. Generate one at\n" +
        "https://myaccount.google.com/apppasswords and paste it with no spaces.",
    );
    process.exitCode = 1;
    return;
  }

  // Read-only: opening a mailbox for inspection must not mark anything as seen.
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let recent = 0;
    for await (const _message of client.fetch({ since }, { uid: true })) recent += 1;

    console.log(`INBOX opened read-only. ${recent} message(s) in the last 24 hours.`);
    console.log(
      "\nThat is the whole window this app ever looks at — and during a run it is\n" +
        "narrower still: only mail arriving after the run starts.",
    );
    console.log("\nMailbox is ready. Use it with:");
    console.log("  npm run shadow -- <jobId> --handoff --verify");
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Check failed:", error);
  process.exitCode = 1;
});
