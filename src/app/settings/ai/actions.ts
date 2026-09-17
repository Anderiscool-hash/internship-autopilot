"use server";

/**
 * Saving AI provider settings, and testing them.
 *
 * The test button is the point of this screen. Provider configuration fails in
 * boring, specific ways — the server is not running, the model name has a typo,
 * the key is stale — and every one of them is a thing the user can fix in
 * seconds once they are told which one it is. Saving settings that have never
 * been exercised just moves the failure to the first feature that needs them.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiProviderKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getProvider, saveAiSettings, DEFAULT_LOCAL_BASE_URL } from "@/lib/ai";
import { AiUnavailableError } from "@/lib/ai/types";

// Next.js dispatches server actions by action ID, not by route, so a POST to any
// path the middleware skips can still reach the actions below. The check has to
// live in each action itself; middleware cannot be the boundary for these.
import { requireAccess } from "@/lib/auth/guard";

/** Read one trimmed field. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function back(params: Record<string, string>): never {
  redirect(`/settings/ai?${new URLSearchParams(params).toString()}`);
}

/** Narrow a submitted string to a real provider kind. */
function toProvider(value: string): AiProviderKind | null {
  return value in AiProviderKind
    ? AiProviderKind[value as keyof typeof AiProviderKind]
    : null;
}

export async function saveAiSettingsAction(form: FormData): Promise<void> {
  await requireAccess();

  const provider = toProvider(field(form, "provider"));
  if (provider === null) back({ error: "Pick a provider." });

  const baseUrl = field(form, "baseUrl") || DEFAULT_LOCAL_BASE_URL;
  const model = field(form, "model");

  // A local provider with no model would save cleanly and then fail on first
  // use, which is exactly the outcome this screen exists to prevent.
  if (provider === AiProviderKind.LOCAL && model.length === 0) {
    back({ error: "Choose a model — a local provider needs to know which one to load." });
  }

  await saveAiSettings(db, { provider, baseUrl, model });
  revalidatePath("/settings/ai");
  back({ saved: "1" });
}

/**
 * Save, then actually call the model and report what came back.
 *
 * Deliberately a real completion rather than a ping: reaching the server
 * proves nothing about whether the named model is installed and can answer.
 */
export async function testAiSettingsAction(form: FormData): Promise<void> {
  await requireAccess();

  const provider = toProvider(field(form, "provider"));
  if (provider === null) back({ error: "Pick a provider." });

  const baseUrl = field(form, "baseUrl") || DEFAULT_LOCAL_BASE_URL;
  const model = field(form, "model");

  if (provider === AiProviderKind.NONE) {
    back({ error: "There is nothing to test — no provider is selected." });
  }
  if (provider === AiProviderKind.LOCAL && model.length === 0) {
    back({ error: "Choose a model before testing." });
  }

  // Save first so the test exercises exactly what is stored, and so a working
  // configuration is not lost if the test itself throws.
  await saveAiSettings(db, { provider, baseUrl, model });
  revalidatePath("/settings/ai");

  try {
    const configured = await getProvider(db);
    if (!configured) back({ error: "No provider is configured." });

    const result = await configured.complete({
      system:
        "You are being tested for connectivity. Reply with exactly the word: ready",
      prompt: "Reply with one word.",
      maxTokens: 16,
    });

    const reply = result.text.trim().slice(0, 80) || "(empty response)";
    back({
      tested: `${result.model} replied in ${(result.latencyMs / 1000).toFixed(1)}s: "${reply}"`,
    });
  } catch (error) {
    // A redirect() inside the try above throws a control-flow error that Next
    // uses to perform the redirect — it must not be caught and reported as a
    // provider failure.
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }

    const message =
      error instanceof AiUnavailableError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    back({ error: message });
  }
}
