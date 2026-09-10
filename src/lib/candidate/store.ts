/**
 * Reading and writing the candidate profile and Truth Ledger (spec §2, §3).
 *
 * This app has exactly one candidate — it is a tool one person runs for
 * themselves — so "the profile" means the single Candidate row, and these
 * functions hide that fact from the pages. If it ever becomes multi-user, the
 * change lands here rather than in every caller.
 */

import type { Candidate, PrismaClient, TruthFact } from "@prisma/client";
import type { ProfileInput, TruthFactInput } from "./parse";

/** The profile plus its ledger, which is what the profile page renders. */
export interface ProfileWithFacts extends Candidate {
  truthFacts: TruthFact[];
}

/**
 * The candidate, or null if the profile has never been filled in.
 *
 * Ordered oldest-first so that if a stray second row ever appears, the
 * original profile stays authoritative rather than the app silently switching
 * to a different one.
 */
export async function getProfile(db: PrismaClient): Promise<ProfileWithFacts | null> {
  return db.candidate.findFirst({
    orderBy: { createdAt: "asc" },
    include: {
      truthFacts: { orderBy: [{ category: "asc" }, { createdAt: "asc" }] },
    },
  });
}

/**
 * Create the profile, or update it in place.
 *
 * Matched on the existing row rather than on email, so changing your email
 * address edits your profile instead of creating a second candidate that
 * silently owns none of your Truth Ledger.
 */
export async function saveProfile(
  db: PrismaClient,
  input: ProfileInput,
): Promise<Candidate> {
  const existing = await db.candidate.findFirst({ orderBy: { createdAt: "asc" } });

  if (existing) {
    return db.candidate.update({ where: { id: existing.id }, data: input });
  }
  return db.candidate.create({ data: input });
}

/** Add one fact to the Truth Ledger. */
export async function addTruthFact(
  db: PrismaClient,
  candidateId: string,
  input: TruthFactInput,
): Promise<TruthFact> {
  return db.truthFact.create({ data: { ...input, candidateId } });
}

/**
 * Remove a fact from the ledger.
 *
 * Scoped to the candidate as well as the fact id: the id arrives from a form
 * in the browser, and a delete that trusts it alone would act on any id
 * someone cared to type.
 */
export async function deleteTruthFact(
  db: PrismaClient,
  candidateId: string,
  factId: string,
): Promise<boolean> {
  const result = await db.truthFact.deleteMany({ where: { id: factId, candidateId } });
  return result.count > 0;
}
