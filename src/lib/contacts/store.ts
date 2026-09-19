import {
  ContactSource, ContactEmailStatus, EmailPatternSource,
  type Contact, type ContactEmail, type EmailPattern, type PrismaClient,
} from "@prisma/client";

export interface ContactInput {
  firstName: string;
  lastName: string;
  title?: string | null;
  domain: string;
  linkedinUrl?: string | null;
  source?: ContactSource;
  notes?: string | null;
}
export type ContactWithEmails = Contact & { emails: ContactEmail[] };
export interface AddressRow {
  address: string;
  pattern?: string | null;
  confidence?: number;
}
const normalizeDomain = (domain: string) => domain.trim().toLowerCase();

export async function resolveCompanyId(db: PrismaClient, domain: string): Promise<string | null> {
  const matches = await db.company.findMany({
    where: { domain: normalizeDomain(domain) }, select: { id: true },
  });
  return matches.length === 1 ? matches[0]!.id : null;
}
export async function createContact(db: PrismaClient, input: ContactInput): Promise<Contact> {
  const domain = normalizeDomain(input.domain);
  return db.contact.create({
    data: {
      firstName: input.firstName, lastName: input.lastName,
      title: input.title ?? null, domain, linkedinUrl: input.linkedinUrl ?? null,
      source: input.source ?? ContactSource.MANUAL, notes: input.notes ?? null,
      companyId: await resolveCompanyId(db, domain),
    },
  });
}
export async function listContacts(db: PrismaClient): Promise<ContactWithEmails[]> {
  return db.contact.findMany({
    orderBy: { updatedAt: "desc" },
    include: { emails: { orderBy: [{ confidence: "desc" }, { address: "asc" }] } },
  });
}
export async function upsertContactEmails(
  db: PrismaClient, contactId: string, rows: AddressRow[],
): Promise<ContactEmail[]> {
  const saved: ContactEmail[] = [];
  for (const row of rows) {
    const address = row.address.trim().toLowerCase();
    const existing = await db.contactEmail.findUnique({
      where: { contactId_address: { contactId, address } },
    });
    saved.push(await db.contactEmail.upsert({
      where: { contactId_address: { contactId, address } },
      create: { contactId, address, pattern: row.pattern ?? null, confidence: row.confidence ?? 0 },
      update: {
        ...(existing?.status === ContactEmailStatus.BOUNCED ||
          existing?.status === ContactEmailStatus.CONFIRMED ? {}
          : { confidence: Math.max(existing?.confidence ?? 0, row.confidence ?? 0) }),
        ...(row.pattern ? { pattern: row.pattern } : {}),
      },
    }));
  }
  return saved;
}
export async function updateEmailStatus(
  db: PrismaClient, emailId: string, status: ContactEmailStatus, confidence?: number,
): Promise<ContactEmail> {
  return db.contactEmail.update({
    where: { id: emailId },
    data: { status, ...(confidence === undefined ? {} : { confidence }), checkedAt: new Date() },
  });
}
export function patternConfidence(confirmedCount: number): number {
  return confirmedCount <= 0 ? 40 : Math.min(95, 40 + 20 * confirmedCount);
}
export async function getEmailPattern(db: PrismaClient, domain: string): Promise<EmailPattern | null> {
  return db.emailPattern.findUnique({ where: { domain: normalizeDomain(domain) } });
}
export async function saveEmailPattern(
  db: PrismaClient, domain: string, pattern: string, source: EmailPatternSource, confidence: number,
): Promise<EmailPattern> {
  const key = normalizeDomain(domain);
  const existing = await db.emailPattern.findUnique({ where: { domain: key } });
  if (!existing) return db.emailPattern.create({
    data: { domain: key, pattern, source, confidence, confirmedCount: 0 },
  });
  return db.emailPattern.update({ where: { domain: key }, data: { pattern, source, confidence } });
}
export async function confirmEmailPattern(
  db: PrismaClient, domain: string, pattern: string,
): Promise<EmailPattern> {
  const key = normalizeDomain(domain);
  const existing = await db.emailPattern.findUnique({ where: { domain: key } });
  if (!existing) return db.emailPattern.create({
    data: { domain: key, pattern, source: EmailPatternSource.INFERRED,
      confidence: patternConfidence(1), confirmedCount: 1 },
  });
  if (existing.pattern !== pattern) return db.emailPattern.update({
    where: { domain: key },
    data: { pattern, source: EmailPatternSource.INFERRED,
      confidence: patternConfidence(1), confirmedCount: 1 },
  });
  const confirmedCount = existing.confirmedCount + 1;
  return db.emailPattern.update({
    where: { domain: key },
    data: { confirmedCount, confidence: patternConfidence(confirmedCount) },
  });
}
export async function promoteNextBest(
  db: PrismaClient, contactId: string, bouncedEmailId: string,
): Promise<string | null> {
  await db.contactEmail.update({
    where: { id: bouncedEmailId },
    data: { status: ContactEmailStatus.BOUNCED, confidence: 0 },
  });
  const next = await db.contactEmail.findFirst({
    where: {
      contactId, id: { not: bouncedEmailId },
      status: { notIn: [ContactEmailStatus.BOUNCED] },
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
  });
  if (next) {
    // Preserve the original message and application association while preparing
    // a human-reviewed draft to the next candidate. This never sends anything.
    const outreach = (db as PrismaClient).outreachMessage;
    const prior = await outreach.findFirst({
      where: { contactId, emailId: bouncedEmailId, status: "BOUNCED" },
      orderBy: { createdAt: "desc" },
    });
    if (prior) await outreach.create({
      data: { contactId, emailId: next.id, applicationId: prior.applicationId, subject: prior.subject, body: prior.body },
    });
  }
  return next?.address ?? null;
}
