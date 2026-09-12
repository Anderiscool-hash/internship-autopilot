/**
 * Work history and education — reading and writing the two tables that
 * existed in the schema from the start and that nothing ever used.
 *
 * That gap was not cosmetic. A live run against a real Greenhouse form left
 * "Company name", "Title", "Current role" and "Discipline" empty, not because
 * the matching was wrong but because there was nowhere for the answers to
 * live. These are the required fields on the employment and education blocks
 * of most applications.
 *
 * Ordering is the contract: both lists come back most-recent first, because
 * a form asking for "your company" means the current one, and the fill logic
 * relies on position rather than re-deriving recency itself.
 */

import type { PrismaClient } from "@prisma/client";
import type { EducationEntry, WorkEntry } from "../apply/fill-plan";

/** One job, as the profile screen shows and edits it. */
export interface WorkRow extends WorkEntry {
  id: string;
  startDate: Date;
  endDate: Date | null;
}

/** One programme, as the profile screen shows and edits it. */
export interface EducationRow extends EducationEntry {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
  graduationDate: Date | null;
  gpa: number | null;
}

/**
 * Jobs held, most recent first.
 *
 * A current role sorts above everything, then by start date. Without the
 * isCurrent term a job started in 2023 and still running would sit below one
 * that ran for two months in 2024 and ended — and the form would be told the
 * candidate works somewhere they left.
 */
export async function listWork(db: PrismaClient, candidateId: string): Promise<WorkRow[]> {
  const rows = await db.workExperience.findMany({
    where: { candidateId },
    orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    company: row.company,
    title: row.title,
    location: row.location,
    isCurrent: row.isCurrent,
    startDate: row.startDate,
    endDate: row.endDate,
  }));
}

/** Programmes studied, most recent first. */
export async function listEducation(
  db: PrismaClient,
  candidateId: string,
): Promise<EducationRow[]> {
  const rows = await db.education.findMany({
    where: { candidateId },
    // Graduation date is the one most reliably filled in; the others are
    // optional on the form that writes them.
    orderBy: [{ graduationDate: "desc" }, { endDate: "desc" }, { createdAt: "desc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    school: row.school,
    degree: row.degree,
    fieldOfStudy: row.fieldOfStudy,
    startDate: row.startDate,
    endDate: row.endDate,
    graduationDate: row.graduationDate,
    gpa: row.gpa,
  }));
}

/** Both lists, trimmed to what the fill logic needs. */
export async function historyForApply(
  db: PrismaClient,
  candidateId: string,
): Promise<{ work: WorkEntry[]; education: EducationEntry[] }> {
  const [work, education] = await Promise.all([
    listWork(db, candidateId),
    listEducation(db, candidateId),
  ]);

  return {
    work: work.map(({ company, title, location, isCurrent }) => ({
      company,
      title,
      location,
      isCurrent,
    })),
    education: education.map(({ school, degree, fieldOfStudy }) => ({
      school,
      degree,
      fieldOfStudy,
    })),
  };
}
