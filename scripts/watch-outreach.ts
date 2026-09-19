/** One read-only inbox pass for bounces and replies. Run by hand or schedule. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
if (existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));
import { PrismaClient } from "@prisma/client";
import { inboxConfig } from "../src/lib/email/inbox";
import { liveWatchDeps, watchOnce } from "../src/lib/outreach/watch";
async function main(): Promise<void> {
  const config = inboxConfig();
  if (!config) { console.log("No mailbox configured. Set IMAP_* in .env, or use Settings -> Mailbox."); return; }
  const db = new PrismaClient();
  try {
    const result = await watchOnce(config, liveWatchDeps(db));
    console.log(`Scanned ${result.scanned} message(s).`);
    for (const outcome of result.outcomes) console.log(`  ${outcome.kind}: ${outcome.address}`);
    for (const address of result.promoted) console.log(`  promoted: ${address}`);
    if (!result.outcomes.length) console.log("  nothing to correlate.");
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
