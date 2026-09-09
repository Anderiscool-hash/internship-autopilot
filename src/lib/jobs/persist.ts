/**
 * Saving discovered jobs into the database.
 *
 * The ATS clients hand back CanonicalJob objects (plain TypeScript, spec §7).
 * The database speaks Prisma enums, which use different spellings — "onsite"
 * in code is ON_SITE in the schema. This file is the single place that
 * translation happens, so the mismatch can't get copy-pasted (and quietly
 * mistyped) into every caller that wants to store a job.
 */

import { AtsType as DbAtsType, RemoteType as DbRemoteType } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AtsType, CanonicalJob, RemoteType } from "./types";
import { jobFingerprint } from "./fingerprint";

/**
 * Translate the code-side ATS name into the database enum value.
 *
 * Written as an explicit lookup rather than `ats.toUpperCase()` because the
 * two vocabularies genuinely differ: "sap" is stored as SAP_SUCCESSFACTORS.
 * A blind uppercase would produce an invalid enum value and fail at insert
 * time, on a company we might not scan again for an hour.
 */
const ATS_TO_DB: Record<AtsType, DbAtsType> = {
  greenhouse: DbAtsType.GREENHOUSE,
  lever: DbAtsType.LEVER,
  ashby: DbAtsType.ASHBY,
  workday: DbAtsType.WORKDAY,
  smartrecruiters: DbAtsType.SMARTRECRUITERS,
  icims: DbAtsType.ICIMS,
  jobvite: DbAtsType.JOBVITE,
  oracle: DbAtsType.ORACLE,
  sap: DbAtsType.SAP_SUCCESSFACTORS,
  custom: DbAtsType.CUSTOM,
};

/**
 * Translate the code-side remote type into the database enum value.
 * Same reasoning as above: "onsite" is stored as ON_SITE.
 */
const REMOTE_TO_DB: Record<RemoteType, DbRemoteType> = {
  onsite: DbRemoteType.ON_SITE,
  remote: DbRemoteType.REMOTE,
  hybrid: DbRemoteType.HYBRID,
  unknown: DbRemoteType.UNKNOWN,
};

/** What happened to one job when we tried to save it. */
export type UpsertOutcome = "created" | "updated";

/**
 * Insert a discovered job, or refresh it if we have already seen it.
 *
 * Deduplication works off the fingerprint (spec §8), which is a hash of the
 * company name plus the employer's own job ID. Because that column is UNIQUE,
 * running discovery twice can never produce two rows for one posting — the
 * second run updates the first row instead.
 *
 * `lastSeenAt` is refreshed on every sighting. That is what later lets the
 * scanner notice a posting has disappeared from a board (spec §5): a job whose
 * lastSeenAt has stopped advancing is one the employer has taken down.
 *
 * `firstSeenAt` is deliberately NOT touched on update. It records when we
 * first discovered the posting, which feeds the "posting freshness" part of
 * fit scoring (spec §12) and the maximum-posting-age auto-apply rule (§18).
 * Overwriting it would make every job look brand new on every scan.
 */
export async function upsertJob(
  db: PrismaClient,
  companyId: string,
  job: CanonicalJob,
): Promise<UpsertOutcome> {
  const fingerprint = jobFingerprint(job.companyName, job.sourceJobId);
  const now = new Date();

  // Fields that should be refreshed every time we re-see the posting, because
  // employers do edit live listings (title tweaks, added locations, salary
  // bands appearing later).
  const mutable = {
    title: job.title,
    location: job.location,
    remoteType: REMOTE_TO_DB[job.remoteType],
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    currency: job.currency,
    description: job.description,
    canonicalUrl: job.canonicalUrl,
    sourcePostedAt: job.sourcePostedAt,
    lastSeenAt: now,
  };

  const existing = await db.job.findUnique({
    where: { fingerprint },
    select: { id: true },
  });

  if (existing) {
    await db.job.update({ where: { fingerprint }, data: mutable });
    return "updated";
  }

  await db.job.create({
    data: {
      ...mutable,
      fingerprint,
      companyId,
      source: job.source,
      sourceJobId: job.sourceJobId,
      atsType: ATS_TO_DB[job.atsType],
      firstSeenAt: now,
    },
  });
  return "created";
}
