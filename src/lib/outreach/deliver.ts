/** Write a draft through IMAP, never send it. */
import { ImapFlow } from "imapflow";
import type { InboxConfig } from "../email/inbox";
export type DeliveryResult = { ok: true; folder: string } | { ok: false; reason: string };
export const DRAFTS_FOLDER_CANDIDATES = ["[Gmail]/Drafts", "Drafts", "INBOX.Drafts"] as const;
export type ImapConnect = (config: InboxConfig) => Promise<ImapFlow>;
export async function findDraftsFolder(client: ImapFlow): Promise<string | null> {
  let boxes: Array<{ path: string; specialUse?: string }>;
  try { boxes = await client.list(); } catch { return null; }
  const flagged = boxes.find(box => box.specialUse === "\\Drafts");
  if (flagged) return flagged.path;
  for (const candidate of DRAFTS_FOLDER_CANDIDATES) {
    const box = boxes.find(item => item.path.toLowerCase() === candidate.toLowerCase());
    if (box) return box.path;
  }
  return null;
}
async function defaultConnect(config: InboxConfig): Promise<ImapFlow> {
  const client = new ImapFlow({ host: config.host, port: config.port, secure: config.secure, auth: { user: config.user, pass: config.password }, logger: false });
  await client.connect();
  return client;
}
export async function appendDraft(config: InboxConfig, mime: string, connect: ImapConnect = defaultConnect): Promise<DeliveryResult> {
  let client: ImapFlow;
  try { client = await connect(config); }
  catch (error) { return { ok: false, reason: `Could not reach the mailbox at ${config.host}: ${error instanceof Error ? error.message : String(error)}. With Gmail this needs an app password, not your account password.` }; }
  try {
    const folder = await findDraftsFolder(client);
    if (!folder) return { ok: false, reason: `No drafts folder was found on ${config.host}. Copy the message instead.` };
    const appended = await client.append(folder, mime, ["\\Draft", "\\Seen"]);
    if (appended === false) return { ok: false, reason: "The mailbox did not accept the draft. Copy the message instead." };
    return { ok: true, folder };
  } catch (error) { return { ok: false, reason: `The mailbox refused the draft: ${error instanceof Error ? error.message : String(error)}` }; }
  finally { await client.logout().catch(() => undefined); }
}
