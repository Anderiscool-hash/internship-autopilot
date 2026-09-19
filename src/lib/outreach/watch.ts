/** Read-only inbox watcher; only a parsed permanent DSN can condemn an address. */
import { ImapFlow } from "imapflow";
import type { PrismaClient } from "@prisma/client";
import { inferPattern, type NameParts, type PatternId } from "../contacts/pattern";
import { confirmEmailPattern, promoteNextBest } from "../contacts/store";
import type { InboxConfig } from "../email/inbox";
import { parseDsn } from "./bounce";
import { listAwaitingMessages, recordBounce, recordReply } from "./store";
export const BOUNCE_SENDER_PATTERN = /^(mailer-daemon|postmaster)@/i;
export interface WatchedMessage { messageId: string; contactId: string; emailId: string; address: string; domain: string; contactName: NameParts; sentAt: Date | null }
export interface IncomingMessage { from: string; receivedAt: Date; source: string }
export type WatchOutcome =
  | { kind: "hard-bounce"; messageId: string; emailId: string; address: string; status: string }
  | { kind: "soft-bounce"; messageId: string; emailId: string; address: string; status: string }
  | { kind: "probable-bounce"; messageId: string; emailId: string; address: string; sender: string }
  | { kind: "reply"; messageId: string; emailId: string; address: string; receivedAt: Date; pattern: PatternId | null };
function trackedFor(tracked: readonly WatchedMessage[], at: Date, match: (item: WatchedMessage) => boolean): WatchedMessage | null {
  const matches = tracked.filter(item => item.sentAt && item.sentAt.getTime() <= at.getTime() && match(item));
  return matches.length === 1 ? matches[0] ?? null : null;
}
function bareAddress(from: string): string { return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase(); }
export function classifyIncoming(message: IncomingMessage, tracked: readonly WatchedMessage[]): WatchOutcome | null {
  const report = parseDsn(message.source);
  if (report) {
    const found = trackedFor(tracked, message.receivedAt, item => item.address.toLowerCase() === report.failedRecipient.toLowerCase());
    if (!found) return null;
    return { kind: report.hard ? "hard-bounce" : "soft-bounce", messageId: found.messageId, emailId: found.emailId, address: found.address, status: report.status };
  }
  const sender = bareAddress(message.from);
  if (BOUNCE_SENDER_PATTERN.test(sender)) {
    const found = trackedFor(tracked, message.receivedAt, item => message.source.toLowerCase().includes(item.address.toLowerCase()));
    return found ? { kind: "probable-bounce", messageId: found.messageId, emailId: found.emailId, address: found.address, sender } : null;
  }
  const found = trackedFor(tracked, message.receivedAt, item => item.address.toLowerCase() === sender);
  return found ? { kind: "reply", messageId: found.messageId, emailId: found.emailId, address: found.address, receivedAt: message.receivedAt, pattern: inferPattern(found.address, found.contactName) } : null;
}
export interface WatchDeps {
  listAwaitingMessages(): Promise<WatchedMessage[]>;
  recordHardBounce(outcome: { messageId: string; emailId: string; at: Date }): Promise<void>;
  recordReply(outcome: { messageId: string; emailId: string; at: Date }): Promise<void>;
  promoteNextBest(contactId: string, bouncedEmailId: string): Promise<string | null>;
  learnPattern(domain: string, pattern: PatternId): Promise<void>;
  fetchSince(config: InboxConfig, since: Date): Promise<IncomingMessage[]>;
}
export interface WatchPassResult { scanned: number; outcomes: WatchOutcome[]; promoted: string[] }
export async function watchOnce(config: InboxConfig, deps: WatchDeps): Promise<WatchPassResult> {
  const tracked = (await deps.listAwaitingMessages()).filter((item): item is WatchedMessage & { sentAt: Date } => item.sentAt !== null);
  if (!tracked.length) return { scanned: 0, outcomes: [], promoted: [] };
  const since = new Date(Math.min(...tracked.map(item => item.sentAt.getTime())));
  const messages = (await deps.fetchSince(config, since)).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const outcomes: WatchOutcome[] = []; const promoted: string[] = [];
  const active = new Map(tracked.map(item => [item.messageId, item]));
  for (const message of messages) {
    const outcome = classifyIncoming(message, [...active.values()]);
    if (!outcome) continue;
    outcomes.push(outcome);
    if (outcome.kind === "hard-bounce") {
      const item = active.get(outcome.messageId);
      if (!item) continue;
      await deps.recordHardBounce({ messageId: outcome.messageId, emailId: outcome.emailId, at: message.receivedAt });
      active.delete(outcome.messageId);
      const next = await deps.promoteNextBest(item.contactId, outcome.emailId);
      if (next) promoted.push(next);
    } else if (outcome.kind === "reply") {
      const item = active.get(outcome.messageId);
      if (!item) continue;
      await deps.recordReply({ messageId: outcome.messageId, emailId: outcome.emailId, at: outcome.receivedAt });
      active.delete(outcome.messageId);
      if (outcome.pattern) await deps.learnPattern(item.domain, outcome.pattern);
    }
  }
  return { scanned: messages.length, outcomes, promoted };
}
/** A new, read-only INBOX connection for one pass; close it on every path. */
export async function fetchSinceOverImap(config: InboxConfig, since: Date): Promise<IncomingMessage[]> {
  const client = new ImapFlow({ host: config.host, port: config.port, secure: config.secure, auth: { user: config.user, pass: config.password }, logger: false });
  let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | null = null;
  try {
    await client.connect();
    lock = await client.getMailboxLock("INBOX", { readOnly: true });
    const found: IncomingMessage[] = [];
    for await (const message of client.fetch({ since }, { envelope: true, source: true, internalDate: true })) {
      const received = message.internalDate ? new Date(message.internalDate) : null;
      if (!received || received.getTime() < since.getTime()) continue;
      found.push({ from: message.envelope?.from?.[0]?.address ?? "", receivedAt: received, source: message.source?.toString("utf8") ?? "" });
    }
    return found;
  } finally {
    lock?.release();
    await client.logout().catch(() => undefined);
  }
}
export function liveWatchDeps(db: PrismaClient): WatchDeps {
  return {
    async listAwaitingMessages() {
      const rows = await listAwaitingMessages(db);
      return rows.map(row => ({ messageId: row.id, contactId: row.contactId, emailId: row.emailId, address: row.email.address, domain: row.contact.domain, contactName: { first: row.contact.firstName, last: row.contact.lastName }, sentAt: row.sentAt }));
    },
    async recordHardBounce(item) { await recordBounce(db, item.messageId, { hard: true }, item.at); },
    async recordReply(item) { await recordReply(db, item.messageId, item.at); },
    async promoteNextBest(contactId, bouncedEmailId) { return promoteNextBest(db, contactId, bouncedEmailId); },
    async learnPattern(domain, pattern) { await confirmEmailPattern(db, domain, pattern); },
    fetchSince: fetchSinceOverImap,
  };
}
