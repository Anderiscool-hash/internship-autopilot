"use server";

/**
 * Saving the auto-apply rules (spec §18).
 *
 * These numbers decide when software submits an application in someone's
 * name, so parsing is strict: a value that is not a whole number in range is
 * an error shown back on the form, never a value silently clamped into
 * something the user did not choose.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AtsType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import type { AutoApplyMode } from "@/lib/autoapply/rules";

/** Parse a whole number in a range, or return null with a message. */
function wholeNumber(
  form: FormData,
  name: string,
  label: string,
  max: number,
  errors: string[],
): number | null {
  const raw = form.get(name);
  const text = typeof raw === "string" ? raw.trim() : "";
  const value = Number(text);

  if (text.length === 0 || !Number.isInteger(value) || value < 0 || value > max) {
    errors.push(`${label} must be a whole number between 0 and ${max}.`);
    return null;
  }
  return value;
}

export async function saveRulesAction(form: FormData): Promise<void> {
  const profile = await getProfile(db);
  if (!profile) {
    redirect("/settings?error=" + encodeURIComponent("Fill in your profile first."));
  }

  const errors: string[] = [];
  const minimumFitScore = wholeNumber(form, "minimumFitScore", "Minimum fit score", 100, errors);
  const minimumApplicationConfidence = wholeNumber(
    form,
    "minimumApplicationConfidence",
    "Minimum application confidence",
    100,
    errors,
  );
  const maximumPostingAgeHours = wholeNumber(
    form,
    "maximumPostingAgeHours",
    "Maximum posting age",
    24 * 365,
    errors,
  );
  const dailyApplicationLimit = wholeNumber(
    form,
    "dailyApplicationLimit",
    "Daily application limit",
    500,
    errors,
  );
  const maxApplicationsPerCompany = wholeNumber(
    form,
    "maxApplicationsPerCompany",
    "Maximum applications per company",
    100,
    errors,
  );

  // Only the three ATS platforms with working adapters can be set to anything
  // but disabled. Offering a mode for Workday would be offering a switch that
  // turns nothing on (spec §21's adapter trust levels).
  const atsModes: Record<string, AutoApplyMode> = {};
  for (const ats of Object.values(AtsType)) {
    const raw = form.get(`ats:${ats}`);
    if (raw === "AUTO" || raw === "REVIEW") atsModes[ats] = raw;
  }

  if (errors.length > 0) {
    redirect("/settings?error=" + encodeURIComponent(errors.join("|")));
  }

  const data = {
    minimumFitScore: minimumFitScore as number,
    minimumApplicationConfidence: minimumApplicationConfidence as number,
    maximumPostingAgeHours: maximumPostingAgeHours as number,
    dailyApplicationLimit: dailyApplicationLimit as number,
    maxApplicationsPerCompany: maxApplicationsPerCompany as number,
    atsAutoApplyModes: atsModes as unknown as Prisma.InputJsonValue,
  };

  await db.candidatePreferences.upsert({
    where: { candidateId: profile.id },
    create: { candidateId: profile.id, ...data },
    update: data,
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
