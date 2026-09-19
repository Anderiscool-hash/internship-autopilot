export interface AddressSignals {
  replied: boolean;
  hardBounced: boolean;
  hunterVerified: boolean | null;
  gravatarHit: boolean;
  daysSinceSentClean: number | null;
  matchesDomainPattern: boolean;
  prior: number;
}
export const REPLIED_WEIGHT = 40;
export const HUNTER_VERIFIED_WEIGHT = 25;
export const HUNTER_UNKNOWN_WEIGHT = 5;
export const GRAVATAR_WEIGHT = 15;
export const DOMAIN_PATTERN_WEIGHT = 10;
export const CLEAN_SEND_WEIGHT = 6;
export const CLEAN_SEND_FULL_CREDIT_DAYS = 14;
export const PRIOR_WEIGHT = 4;
function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value,low),high);
}
export function scoreAddress(signals: AddressSignals): number {
  if (signals.hardBounced) return 0;
  // A reply is ground truth and outranks every accumulation of weaker signals.
  if (signals.replied) return 100;
  let score = 0;
  if (signals.replied) score += REPLIED_WEIGHT;
  if (signals.hunterVerified === true) score += HUNTER_VERIFIED_WEIGHT;
  else if (signals.hunterVerified === null) score += HUNTER_UNKNOWN_WEIGHT;
  if (signals.gravatarHit) score += GRAVATAR_WEIGHT;
  if (signals.matchesDomainPattern) score += DOMAIN_PATTERN_WEIGHT;
  if (signals.daysSinceSentClean !== null) {
    score += CLEAN_SEND_WEIGHT * clamp(signals.daysSinceSentClean,0,CLEAN_SEND_FULL_CREDIT_DAYS) / CLEAN_SEND_FULL_CREDIT_DAYS;
  }
  score += PRIOR_WEIGHT * clamp(signals.prior,0,1);
  return Math.round(clamp(score,0,100));
}
