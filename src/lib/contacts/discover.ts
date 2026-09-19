import { ContactEmailStatus, EmailPatternSource, type PrismaClient } from "@prisma/client";
import { applyPattern, type NameParts, type PatternId } from "./pattern";
import { permuteAddresses, type AddressCandidate } from "./permute";
import { scoreAddress } from "./score";
import type { MailProvider, MxResult } from "./mx";
import { lookupMx } from "./mx";
import { hasGravatar } from "./gravatar";
import { hunterConfigured, hunterFindEmail, hunterDomainPattern, hunterVerify } from "./hunter";
import { getEmailPattern, saveEmailPattern, upsertContactEmails } from "./store";

export const GRAVATAR_PROBE_LIMIT = 3;
export const GRAVATAR_DELAY_MS = 150;
export interface DiscoverInput { contactId: string; name: NameParts; domain: string; }
export interface DiscoveredAddress {
  address: string; pattern: PatternId | null; confidence: number;
  status: ContactEmailStatus; gravatarHit: boolean; hunterVerified: boolean | null;
}
export type DiscoveryStrategy = "no-mx" | "learned-pattern" | "hunter" | "permuted";
export interface DiscoveryResult {
  domain: string; hasMx: boolean; provider: MailProvider; strategy: DiscoveryStrategy;
  hunterConsulted: boolean; addresses: DiscoveredAddress[];
}
export interface DiscoverDeps {
  lookupMx(domain: string): Promise<MxResult>;
  hasGravatar(address: string): Promise<boolean>;
  hunterConfigured(): boolean;
  hunterFindEmail(domain: string, name: NameParts): Promise<string | null>;
  hunterDomainPattern(domain: string): Promise<PatternId | null>;
  hunterVerify(address: string): Promise<boolean | null>;
  getEmailPattern(domain: string): Promise<PatternId | null>;
  saveEmailPattern(domain: string, pattern: PatternId, source: "HUNTER" | "INFERRED"): Promise<void>;
  saveAddresses(contactId: string, rows: DiscoveredAddress[]): Promise<void>;
  sleep(ms: number): Promise<void>;
  getKnownAddresses?(contactId: string): Promise<Array<{
    address: string; status: ContactEmailStatus; confidence: number;
  }>>;
}
function toDiscovered(
  candidate: {address:string;pattern:PatternId|null;prior:number},
  evidence: {gravatarHit:boolean;hunterVerified:boolean|null;matchesDomainPattern:boolean},
): DiscoveredAddress {
  const confidence = scoreAddress({
    replied:false, hardBounced:false, hunterVerified:evidence.hunterVerified,
    gravatarHit:evidence.gravatarHit, daysSinceSentClean:null,
    matchesDomainPattern:evidence.matchesDomainPattern, prior:candidate.prior,
  });
  return {
    address:candidate.address,pattern:candidate.pattern,confidence,
    status:evidence.hunterVerified === true ? ContactEmailStatus.API_VERIFIED
      : evidence.gravatarHit ? ContactEmailStatus.GRAVATAR_HIT : ContactEmailStatus.GUESSED,
    gravatarHit:evidence.gravatarHit,hunterVerified:evidence.hunterVerified,
  };
}
async function probeTopCandidates(candidates: AddressCandidate[], deps: DiscoverDeps): Promise<Set<string>> {
  const hits = new Set<string>();
  for (const [index,candidate] of candidates.slice(0,GRAVATAR_PROBE_LIMIT).entries()) {
    if (index>0) await deps.sleep(GRAVATAR_DELAY_MS);
    if (await deps.hasGravatar(candidate.address)) hits.add(candidate.address);
  }
  return hits;
}
async function askHunter<T>(ask:()=>Promise<T|null>): Promise<T|null> {
  try { return await ask(); } catch { return null; }
}
export async function discoverAddresses(input: DiscoverInput, deps: DiscoverDeps): Promise<DiscoveryResult> {
  const domain = input.domain.trim().toLowerCase();
  const mx = await deps.lookupMx(domain);
  if (!mx.hasMx) return {domain,hasMx:false,provider:mx.provider,strategy:"no-mx",hunterConsulted:false,addresses:[]};
  const knownRows = await deps.getKnownAddresses?.(input.contactId) ?? [];
  const known = new Map(knownRows.map(row => [row.address.toLowerCase(), row]));
  const isBounced = (address: string) =>
    known.get(address.toLowerCase())?.status === ContactEmailStatus.BOUNCED;
  const learned = await deps.getEmailPattern(domain);
  if (learned) {
    const address = applyPattern(learned,input.name,domain);
    if (address && !isBounced(address)) {
      const gravatarHit = await deps.hasGravatar(address);
      const addresses = [toDiscovered({address,pattern:learned,prior:1},
        {gravatarHit,hunterVerified:null,matchesDomainPattern:true})];
      await deps.saveAddresses(input.contactId,addresses);
      return {domain,hasMx:true,provider:mx.provider,strategy:"learned-pattern",hunterConsulted:false,addresses};
    }
  }
  let hunterConsulted = false;
  if (deps.hunterConfigured()) {
    hunterConsulted = true;
    const found = await askHunter(()=>deps.hunterFindEmail(domain,input.name));
    if (found && !isBounced(found)) {
      const priorStatus = known.get(found.toLowerCase())?.status;
      const verified = priorStatus === ContactEmailStatus.CONFIRMED ? true
        : await askHunter(()=>deps.hunterVerify(found));
      const addresses = [toDiscovered({address:found,pattern:null,prior:1},
        {gravatarHit:false,hunterVerified:verified,matchesDomainPattern:false})];
      await deps.saveAddresses(input.contactId,addresses);
      return {domain,hasMx:true,provider:mx.provider,strategy:"hunter",hunterConsulted,addresses};
    }
    const pattern = await askHunter(()=>deps.hunterDomainPattern(domain));
    const address = pattern ? applyPattern(pattern,input.name,domain) : null;
    if (pattern && address && !isBounced(address)) {
      await deps.saveEmailPattern(domain,pattern,"HUNTER");
      const gravatarHit = await deps.hasGravatar(address);
      const addresses = [toDiscovered({address,pattern,prior:1},
        {gravatarHit,hunterVerified:null,matchesDomainPattern:true})];
      await deps.saveAddresses(input.contactId,addresses);
      return {domain,hasMx:true,provider:mx.provider,strategy:"hunter",hunterConsulted,addresses};
    }
  }
  const candidates = permuteAddresses(input.name,domain).filter(c => !isBounced(c.address));
  const hits = await probeTopCandidates(candidates,deps);
  const addresses = candidates.map(candidate=>toDiscovered(candidate,{
    gravatarHit:hits.has(candidate.address),hunterVerified:null,
    matchesDomainPattern:learned !== null && candidate.pattern === learned,
  })).sort((a,b)=>b.confidence-a.confidence);
  await deps.saveAddresses(input.contactId,addresses);
  return {domain,hasMx:true,provider:mx.provider,strategy:"permuted",hunterConsulted,addresses};
}
export function liveDeps(db: PrismaClient): DiscoverDeps {
  return {
    lookupMx,hasGravatar,hunterConfigured,hunterFindEmail,hunterDomainPattern,hunterVerify,
    getKnownAddresses: async contactId => db.contactEmail.findMany({
      where: { contactId }, select: { address: true, status: true, confidence: true },
    }),
    getEmailPattern: async domain => (await getEmailPattern(db,domain))?.pattern as PatternId | null ?? null,
    saveEmailPattern: async (domain,pattern,source) => {
      await saveEmailPattern(db,domain,pattern,EmailPatternSource[source],source === "HUNTER" ? 80 : 40);
    },
    saveAddresses: async (contactId,rows) => {
      await upsertContactEmails(db,contactId,rows);
      // A positive verification is evidence; a discovery rerun never downgrades existing states.
      for (const row of rows.filter(r=>r.status !== ContactEmailStatus.GUESSED)) {
        const email = await db.contactEmail.findUnique({
          where:{contactId_address:{contactId,address:row.address}},
        });
        if (email && email.status !== ContactEmailStatus.BOUNCED && email.status !== ContactEmailStatus.CONFIRMED) {
          await db.contactEmail.updateMany({ where: { id: email.id, status: { notIn: [ContactEmailStatus.BOUNCED, ContactEmailStatus.CONFIRMED] } }, data: { status: row.status, checkedAt: new Date() } });
        }
      }
    },
    sleep: ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  };
}
import { db } from "../db";
export async function discoverContactEmails(contactId: string): Promise<{
  generated: number; best: string | null; note: string;
}> {
  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new Error("Contact not found");
  const result = await discoverAddresses({
    contactId, name: { first: contact.firstName, last: contact.lastName }, domain: contact.domain,
  }, liveDeps(db));
  const persisted = await db.contactEmail.findFirst({
    where: { contactId, status: { not: ContactEmailStatus.BOUNCED } },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
  });
  const best = result.hasMx ? persisted?.address ?? null : null;
  const note = result.strategy === "no-mx"
    ? `No MX record for ${result.domain}; this domain cannot receive mail.`
    : best ? `Found ${result.addresses.length} candidate addresses.` : "No usable address found.";
  return { generated: result.addresses.length, best, note };
}
