/** Outreach persistence. Only a human marks a draft sent. */
import { ContactEmailStatus, OutreachStatus, type Contact, type ContactEmail, type OutreachMessage, type PrismaClient } from "@prisma/client";
export interface DraftInput { contactId: string; emailId: string; applicationId?: string | null; subject: string; body: string; draftFolder?: string | null }
export type OutreachWithContact = OutreachMessage & { contact: Contact };
export type AwaitingMessage = OutreachMessage & { contact: Contact; email: ContactEmail };
export async function createDraft(db: PrismaClient, input: DraftInput): Promise<OutreachMessage> {
  return db.outreachMessage.create({ data: { contactId: input.contactId, emailId: input.emailId, applicationId: input.applicationId ?? null, subject: input.subject, body: input.body, draftFolder: input.draftFolder ?? null } });
}
export async function listMessagesForContact(db: PrismaClient, contactId: string): Promise<OutreachMessage[]> {
  return db.outreachMessage.findMany({ where: { contactId }, orderBy: { draftedAt: "asc" } });
}
export async function markSent(db: PrismaClient, messageId: string, sentAt: Date = new Date(), draftFolder?: string | null): Promise<OutreachMessage> {
  return db.outreachMessage.update({ where: { id: messageId, status: OutreachStatus.DRAFT }, data: { status: OutreachStatus.SENT, sentAt, ...(draftFolder === undefined ? {} : { draftFolder }) } });
}
export async function recordBounce(db: PrismaClient, messageId: string, bounce: { hard: boolean }, at: Date = new Date()): Promise<OutreachMessage> {
  return db.$transaction(async tx => {
    const message = await tx.outreachMessage.update({ where: { id: messageId, status: OutreachStatus.SENT }, data: { status: OutreachStatus.BOUNCED, bouncedAt: at } });
    if (bounce.hard) await tx.contactEmail.update({ where: { id: message.emailId }, data: { status: ContactEmailStatus.BOUNCED, confidence: 0, checkedAt: at } });
    return message;
  });
}
export async function recordReply(db: PrismaClient, messageId: string, at: Date = new Date()): Promise<OutreachMessage> {
  return db.$transaction(async tx => {
    const message = await tx.outreachMessage.update({ where: { id: messageId, status: OutreachStatus.SENT }, data: { status: OutreachStatus.REPLIED, repliedAt: at } });
    await tx.contactEmail.update({ where: { id: message.emailId }, data: { status: ContactEmailStatus.CONFIRMED, confidence: 100, checkedAt: at } });
    return message;
  });
}
export async function setFollowUp(db: PrismaClient, messageId: string, followUpAt: Date | null): Promise<OutreachMessage> {
  return db.outreachMessage.update({ where: { id: messageId }, data: { followUpAt } });
}
export async function listFollowUpsDue(db: PrismaClient, asOf: Date = new Date()): Promise<OutreachWithContact[]> {
  return db.outreachMessage.findMany({ where: { status: OutreachStatus.SENT, followUpAt: { not: null, lte: asOf } }, orderBy: { followUpAt: "asc" }, include: { contact: true } });
}
export async function listAwaitingMessages(db: PrismaClient): Promise<AwaitingMessage[]> {
  return db.outreachMessage.findMany({ where: { status: OutreachStatus.SENT, sentAt: { not: null } }, include: { contact: true, email: true } });
}
