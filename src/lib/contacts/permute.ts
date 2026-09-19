import type { PatternId, NameParts } from "./pattern";
export type { NameParts } from "./pattern";
export const PATTERN_PRIORS: Record<PatternId, number> = {
  "first.last": 0.34, first: 0.12, flast: 0.11, firstlast: 0.07,
  first_last: 0.05, "f.last": 0.05, "last.first": 0.03,
  firstl: 0.02, lastf: 0.02, "first-last": 0.01,
};
const TRANSLITERATIONS: Record<string,string> = {
  "ø":"o", "æ":"ae", "œ":"oe", "ß":"ss", "ł":"l", "đ":"d", "ð":"d", "þ":"th",
};
export function normalizePart(part: string): string {
  const unaccented = part.normalize("NFD").toLowerCase().replace(/[\u0300-\u036f]/g,"");
  return unaccented.replace(/[^\u0000-\u007f]/g, ch => TRANSLITERATIONS[ch] ?? ch).replace(/[^a-z0-9]+/g,"");
}
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/,"");
}
export function buildLocalPart(pattern: PatternId, name: NameParts): string | null {
  const first = normalizePart(name.first), last = normalizePart(name.last);
  if (!first || (!last && pattern !== "first")) return null;
  const f = first.slice(0,1), l = last.slice(0,1);
  switch (pattern) {
    case "first.last": return `${first}.${last}`;
    case "first": return first;
    case "flast": return `${f}${last}`;
    case "firstlast": return `${first}${last}`;
    case "first_last": return `${first}_${last}`;
    case "f.last": return `${f}.${last}`;
    case "last.first": return `${last}.${first}`;
    case "firstl": return `${first}${l}`;
    case "lastf": return `${last}${f}`;
    case "first-last": return `${first}-${last}`;
    default: { const unreachable: never = pattern; return unreachable; }
  }
}
export interface AddressCandidate { address: string; pattern: PatternId; prior: number; }
export function permuteAddresses(name: NameParts, domain: string): AddressCandidate[] {
  const host = normalizeDomain(domain);
  if (!host) return [];
  const seen = new Set<string>(), candidates: AddressCandidate[] = [];
  for (const [pattern,prior] of Object.entries(PATTERN_PRIORS) as [PatternId,number][]) {
    const local = buildLocalPart(pattern,name);
    if (!local) continue;
    const address = `${local}@${host}`;
    if (seen.has(address)) continue;
    seen.add(address);
    candidates.push({address,pattern,prior});
  }
  return candidates;
}
