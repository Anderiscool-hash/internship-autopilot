"use server";

/**
 * Adding and removing work history and education.
 *
 * Dates are stored as the first of the month. Application forms ask for month
 * and year and never for a day, and inventing a day would be inventing a
 * candidate fact — a small one, but the rule does not have a size limit.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";

// Next.js dispatches server actions by action ID, not by route, so a POST to any
// path the middleware skips can still reach the actions below. The check has to
// live in each action itself; middleware cannot be the boundary for these.
import { requireAccess } from "@/lib/auth/guard";

function back(params: Record<string, string>): never {
  redirect(`/profile?${new URLSearchParams(params).toString()}`);
}

/** A "YYYY-MM" from a month input, as a date, or null when blank. */
function monthValue(form: FormData, field: string): Date | null {
  const raw = String(form.get(field) ?? "").trim();
  if (raw.length === 0) return null;

  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  // UTC, so the stored month cannot shift under a timezone with a negative
  // offset — a graduation date of 2029-09 must not read as August anywhere.
  return new Date(Date.UTC(year, month - 1, 1));
}

function text(form: FormData, field: string): string {
  return String(form.get(field) ?? "").trim();
}

export async function addWorkAction(form: FormData): Promise<void> {
  await requireAccess();

  const profile = await getProfile(db);
  if (!profile) back({ errors: "Save your profile first." });

  const company = text(form, "company");
  const title = text(form, "title");
  const startDate = monthValue(form, "startDate");

  const missing = [
    company.length === 0 ? "company" : null,
    title.length === 0 ? "title" : null,
    startDate === null ? "start date" : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    back({ errors: `A job needs a ${missing.join(", a ")}.` });
  }

  const isCurrent = form.get("isCurrent") === "on";

  await db.workExperience.create({
    data: {
      candidateId: profile.id,
      company,
      title,
      location: text(form, "location") || null,
      startDate: startDate as Date,
      // A job cannot be both current and ended. The checkbox wins, because it
      // is the more deliberate of the two.
      endDate: isCurrent ? null : monthValue(form, "endDate"),
      isCurrent,
    },
  });

  revalidatePath("/profile");
  back({ saved: "history", note: `Added ${title} at ${company}.` });
}

export async function deleteWorkAction(form: FormData): Promise<void> {
  await requireAccess();

  const id = text(form, "id");
  if (id) await db.workExperience.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/profile");
  back({ saved: "history", note: "Job removed." });
}

export async function addEducationAction(form: FormData): Promise<void> {
  await requireAccess();

  const profile = await getProfile(db);
  if (!profile) back({ errors: "Save your profile first." });

  const school = text(form, "school");
  const degree = text(form, "degree");

  if (school.length === 0 || degree.length === 0) {
    back({ errors: "An education entry needs a school and a degree." });
  }

  const gpaRaw = text(form, "gpa");
  const gpa = gpaRaw.length > 0 ? Number(gpaRaw) : null;

  await db.education.create({
    data: {
      candidateId: profile.id,
      school,
      degree,
      fieldOfStudy: text(form, "fieldOfStudy") || null,
      startDate: monthValue(form, "startDate"),
      endDate: monthValue(form, "endDate"),
      graduationDate: monthValue(form, "graduationDate"),
      // A GPA that does not parse is left out rather than stored as NaN or
      // rounded to something plausible.
      gpa: gpa !== null && Number.isFinite(gpa) ? gpa : null,
    },
  });

  revalidatePath("/profile");
  back({ saved: "history", note: `Added ${degree} at ${school}.` });
}

export async function deleteEducationAction(form: FormData): Promise<void> {
  await requireAccess();

  const id = text(form, "id");
  if (id) await db.education.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/profile");
  back({ saved: "history", note: "Education entry removed." });
}
