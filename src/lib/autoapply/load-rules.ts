/**
 * The one place a CandidatePreferences row becomes AutoApplyRules.
 *
 * It was written out twice before, in preflight and in the settings page, and
 * the copies had drifted — one spread atsModes in and one did not. With a
 * worker about to act on these rules rather than just print them, a dropped
 * atsModes would mean applying on an ATS somebody had switched off.
 */

import type { PrismaClient } from "@prisma/client";
import { DEFAULT_RULES, readAtsModes, type AutoApplyRules } from "./rules";

export async function loadAutoApplyRules(
  db: PrismaClient,
  candidateId: string,
): Promise<AutoApplyRules> {
  const stored = await db.candidatePreferences.findUnique({ where: { candidateId } });
  if (!stored) return DEFAULT_RULES;

  return {
    minimumFitScore: stored.minimumFitScore,
    minimumApplicationConfidence: stored.minimumApplicationConfidence,
    maximumPostingAgeHours: stored.maximumPostingAgeHours,
    dailyApplicationLimit: stored.dailyApplicationLimit,
    maxApplicationsPerCompany: stored.maxApplicationsPerCompany,
    atsModes: readAtsModes(stored.atsAutoApplyModes),
  };
}
