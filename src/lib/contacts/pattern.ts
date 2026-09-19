export type PatternId = "first.last" | "first" | "flast" | "firstlast" | "first_last" | "f.last" | "last.first" | "firstl" | "lastf" | "first-last";
export const PATTERN_IDS: readonly PatternId[] = ["first.last","first","flast","firstlast","first_last","f.last","last.first","firstl","lastf","first-last"];
export interface NameParts { first: string; last: string; middle?: string; }
import { buildLocalPart, normalizeDomain } from "./permute";
export function applyPattern(pattern: PatternId, name: NameParts, domain: string): string | null {
  const local = buildLocalPart(pattern, name);
  const host = normalizeDomain(domain);
  return local && host ? `${local}@${host}` : null;
}
export function inferPattern(address: string, name: NameParts): PatternId | null {
  const local = address.trim().toLowerCase().split("@")[0] ?? "";
  if (!local) return null;
  let only: PatternId | null = null;
  for (const pattern of PATTERN_IDS) {
    if (buildLocalPart(pattern, name) !== local) continue;
    if (only !== null) return null;
    only = pattern;
  }
  return only;
}
