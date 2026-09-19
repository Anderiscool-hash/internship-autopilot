/** By-hand IMAP APPEND check. Never run in automated tests. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
if (existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));
import { composeMime } from "../src/lib/outreach/compose";
import { appendDraft } from "../src/lib/outreach/deliver";
import { inboxConfig } from "../src/lib/email/inbox";
async function main(): Promise<void> {
  const config = inboxConfig();
  if (!config) { console.error("No mailbox is configured. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD in .env."); process.exitCode = 1; return; }
  const mime = composeMime({ from: config.user, to: config.user, subject: "Internship Autopilot — drafts check", body: "If you are reading this in your Drafts folder, appending works.\n", date: new Date() });
  const result = await appendDraft(config, mime);
  if (result.ok) console.log(`Draft written to ${result.folder}. Delete it when you have seen it.`);
  else { console.error(`Could not write the draft: ${result.reason}`); process.exitCode = 1; }
}
void main();
