/** An introduction uses stored facts only; AI may write prose, never invent inputs. */
import type { Candidate, Job, TruthFact, PrismaClient } from "@prisma/client";
import type { AiProvider } from "../ai/types";
import { AiUnavailableError } from "../ai/types";
import { getProvider } from "../ai/index";
export const MAX_EXPERIENCE_FACTS = 8;
export interface FactBlock { candidateName: string; school: string | null; degree: string | null; graduationDate: string | null; contactName: string; contactTitle: string | null; companyName: string | null; jobTitle: string | null; experienceFacts: string[] }
export interface DraftInput { candidate: Pick<Candidate, "name" | "school" | "degree" | "graduationDate">; truthFacts: Pick<TruthFact, "category" | "statement">[]; contact: { firstName: string; lastName: string; title: string | null }; job: (Pick<Job, "title"> & { companyName: string }) | null }
export interface DraftContent { subject: string; body: string; source: "ai" | "template"; fallbackReason?: string }
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const nonblank = (value: string | null | undefined): string | null => value?.trim() || null;
export function buildFactBlock(input: DraftInput): FactBlock {
  return { candidateName: input.candidate.name.trim(), school: nonblank(input.candidate.school), degree: nonblank(input.candidate.degree), graduationDate: input.candidate.graduationDate ? `${months[input.candidate.graduationDate.getUTCMonth()]} ${input.candidate.graduationDate.getUTCFullYear()}` : null, contactName: `${input.contact.firstName} ${input.contact.lastName}`.trim(), contactTitle: nonblank(input.contact.title), companyName: nonblank(input.job?.companyName), jobTitle: nonblank(input.job?.title), experienceFacts: input.truthFacts.map(fact => fact.statement.trim()).filter(Boolean).slice(0, MAX_EXPERIENCE_FACTS) };
}
export function subjectFor(facts: FactBlock): string { return `${facts.jobTitle ?? "Introduction"} — ${facts.candidateName}${facts.school ? `, ${facts.school}` : ""}`; }
export function templateDraft(facts: FactBlock): DraftContent {
  const first = facts.contactName.split(" ")[0] || facts.contactName;
  const lines = [`Hi ${first},`, ""];
  if (facts.jobTitle && facts.companyName) lines.push(`My name is ${facts.candidateName} and I am applying for the ${facts.jobTitle} role at ${facts.companyName}.`);
  else if (facts.companyName) lines.push(`My name is ${facts.candidateName} and I am interested in internship openings at ${facts.companyName}.`);
  else lines.push(`My name is ${facts.candidateName} and I am looking for an internship this year.`);
  const study = [facts.degree, facts.school ? `at ${facts.school}` : null].filter(Boolean).join(" ");
  if (study) lines.push(`I am studying ${study}${facts.graduationDate ? `, graduating ${facts.graduationDate}` : ""}.`);
  else if (facts.graduationDate) lines.push(`I graduate in ${facts.graduationDate}.`);
  if (facts.experienceFacts.length) lines.push("", "A little about what I have done:", ...facts.experienceFacts.map(fact => `- ${fact}`));
  lines.push("", "If you have a few minutes, I would appreciate the chance to introduce myself properly.", "", "Thank you for your time,", facts.candidateName);
  return { subject: subjectFor(facts), body: lines.join("\n"), source: "template" };
}
export function renderFactBlock(facts: FactBlock): string {
  const lines = [`Candidate name: ${facts.candidateName}`];
  if (facts.school) lines.push(`School: ${facts.school}`);
  if (facts.degree) lines.push(`Degree: ${facts.degree}`);
  if (facts.graduationDate) lines.push(`Graduates: ${facts.graduationDate}`);
  lines.push(`Writing to: ${facts.contactName}`);
  if (facts.contactTitle) lines.push(`Their title: ${facts.contactTitle}`);
  if (facts.companyName) lines.push(`Their company: ${facts.companyName}`);
  if (facts.jobTitle) lines.push(`The role: ${facts.jobTitle}`);
  if (facts.experienceFacts.length) lines.push("Verified facts about the candidate:", ...facts.experienceFacts.map(fact => `- ${fact}`));
  return lines.join("\n");
}
export const DRAFT_SYSTEM_PROMPT = `You write short, plain introduction emails from one student to one person at a company.

You are given a list of facts. Write the body of the email using only those facts.

Rules you must follow:
- Never state anything that is not in the facts you were given. Do not infer a skill from a job title, do not add a number, do not name a technology that is not listed.
- If a fact is not given, write the email without it. Do not say that it is unknown and do not leave a blank to fill in.
- Four short paragraphs at most. No bullet lists, no subject line, no signature block.
- Plain text. No markdown, no headings, no links.
- Write in the first person as the candidate, addressed to the person named.
- Return the email body and nothing else.`;
export function buildPrompt(facts: FactBlock): string { return `Write the body of this email using only the facts below.\n\n${renderFactBlock(facts)}`; }
export async function buildDraft(input: DraftInput, provider: AiProvider | null): Promise<DraftContent> {
  const facts = buildFactBlock(input); const template = templateDraft(facts);
  if (!provider) return template;
  try {
    const result = await provider.complete({ system: DRAFT_SYSTEM_PROMPT, prompt: buildPrompt(facts), maxTokens: 700 });
    const body = result.text.trim();
    return body ? { subject: subjectFor(facts), body, source: "ai" } : { ...template, fallbackReason: "The model returned an empty answer." };
  } catch (error) { return { ...template, fallbackReason: `The model could not be reached: ${error instanceof Error ? error.message : String(error)}` }; }
}
export async function draftForContact(db: PrismaClient, input: DraftInput): Promise<DraftContent> {
  try { return await buildDraft(input, await getProvider(db)); }
  catch (error) { if (error instanceof AiUnavailableError) return { ...templateDraft(buildFactBlock(input)), fallbackReason: error.message }; throw error; }
}

/** UI seam: load only persisted, attributable facts for a contact and optional application. */
export async function buildOutreachDraft(contactId: string, emailId: string, applicationId?: string | null): Promise<DraftContent> {
  const { db } = await import("../db");
  const contact = await db.contact.findUnique({ where: { id: contactId }, include: { emails: true, company: true } });
  if (!contact) throw new Error("Contact not found.");
  if (!contact.emails.some(email => email.id === emailId)) throw new Error("Address does not belong to this contact.");
  const candidate = await db.candidate.findFirst();
  if (!candidate) throw new Error("Candidate profile is missing.");
  const truthFacts = await db.truthFact.findMany({ where: { candidateId: candidate.id }, orderBy: { createdAt: "asc" } });
  let job: DraftInput["job"] = null;
  if (applicationId) {
    const application = await db.application.findUnique({ where: { id: applicationId }, include: { job: { include: { company: true } } } });
    if (!application || application.candidateId !== candidate.id) throw new Error("Application not found for this candidate.");
    if (contact.companyId && application.job.companyId !== contact.companyId) throw new Error("Application company does not match the contact.");
    job = { title: application.job.title, companyName: application.job.company.name };
  }
  const draft = await draftForContact(db, { candidate, truthFacts, contact, job });
  return draft;
}
