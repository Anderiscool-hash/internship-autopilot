"use server";

/**
 * Managing the company registry (spec §4).
 *
 * Adding a company is the only way this app ever finds more internships, so
 * this is the highest-leverage screen in it — and the one where a wrong value
 * does the most quiet damage. Every add is verified against the live ATS
 * first: see src/lib/companies/verify.ts for why a plausible slug is not good
 * enough.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AtsType } from "@prisma/client";
import { db } from "@/lib/db";
import { dbAtsToCode } from "@/lib/jobs/persist";
import { verifyBoard } from "@/lib/companies/verify";

// Next.js dispatches server actions by action ID, not by route, so a POST to any
// path the middleware skips can still reach the actions below. The check has to
// live in each action itself; middleware cannot be the boundary for these.
import { requireAccess } from "@/lib/auth/guard";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function back(params: Record<string, string>): never {
  redirect(`/companies?${new URLSearchParams(params).toString()}`);
}

function toAts(value: string): AtsType | null {
  return value in AtsType ? AtsType[value as keyof typeof AtsType] : null;
}

/** Check a board and, if it is real, add the company. */
export async function addCompanyAction(form: FormData): Promise<void> {
  await requireAccess();

  const name = field(form, "name");
  const identifier = field(form, "identifier");
  const atsType = toAts(field(form, "atsType"));

  if (name.length === 0) back({ error: "Give the company a name." });
  if (atsType === null) back({ error: "Pick which ATS the company uses." });

  const existing = await db.company.findFirst({
    where: { atsType, atsIdentifier: identifier },
  });
  if (existing) {
    back({ error: `That board is already tracked, as "${existing.name}".` });
  }

  const result = await verifyBoard(dbAtsToCode(atsType), identifier, name);
  if (!result.ok) back({ error: result.reason });

  await db.company.create({
    data: {
      name,
      atsType,
      atsIdentifier: identifier,
      active: true,
      // Never scanned, so the next cycle picks it up immediately.
      lastScan: null,
    },
  });

  revalidatePath("/companies");
  back({
    saved: `Added ${name}: ${result.jobCount} postings on that board, including "${result.sampleTitles[0]}".`,
  });
}

/** Turn scanning on or off for one company. */
export async function toggleCompanyAction(form: FormData): Promise<void> {
  await requireAccess();

  const id = field(form, "id");
  const company = await db.company.findUnique({ where: { id } });
  if (!company) back({ error: "That company no longer exists." });

  await db.company.update({
    where: { id },
    data: {
      active: !company.active,
      // Re-enabling clears the failure count: the reason it was paused may
      // well be fixed, and starting at a six-hour backoff would hide that.
      ...(company.active ? {} : { failureCount: 0 }),
    },
  });

  revalidatePath("/companies");
  back({
    saved: `${company.name} is now ${company.active ? "paused" : "being scanned"}.`,
  });
}

/** Re-check a board that is already in the registry. */
export async function recheckCompanyAction(form: FormData): Promise<void> {
  await requireAccess();

  const id = field(form, "id");
  const company = await db.company.findUnique({ where: { id } });
  if (!company) back({ error: "That company no longer exists." });

  if (!company.atsType || !company.atsIdentifier) {
    back({ error: `${company.name} has no confirmed board to check.` });
  }

  const result = await verifyBoard(
    dbAtsToCode(company.atsType),
    company.atsIdentifier,
    company.name,
  );

  back(
    result.ok
      ? { saved: `${company.name}: ${result.jobCount} postings on that board right now.` }
      : { error: `${company.name}: ${result.reason}` },
  );
}

/**
 * Change how often a company is scanned.
 *
 * Spec §5's tiers are chosen automatically from each board's own activity, so
 * this sets the priority number that overrides them — the "priority company"
 * escape hatch, not the interval itself.
 */
export async function setPriorityAction(form: FormData): Promise<void> {
  await requireAccess();

  const id = field(form, "id");
  const raw = field(form, "scanPriority");
  const priority = Number(raw);

  if (!Number.isInteger(priority) || priority < 1 || priority > 99) {
    back({ error: "Priority must be a whole number from 1 to 99." });
  }

  const company = await db.company.findUnique({ where: { id } });
  if (!company) back({ error: "That company no longer exists." });

  await db.company.update({ where: { id }, data: { scanPriority: priority } });
  revalidatePath("/companies");
  back({ saved: `${company.name} priority set to ${priority}.` });
}
