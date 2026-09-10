/**
 * Choosing which model backend to use.
 *
 * Settings live in a single database row; the API key, when one is needed,
 * lives in `.env`. Callers ask for `getProvider(db)` and get either a working
 * provider or null, and null always means the same thing: the feature is off,
 * say so, do nothing. Nothing here silently substitutes a different model or
 * falls back to a default backend — a resume parsed by a model the user did
 * not choose is exactly the kind of surprise this project avoids.
 */

import { AiProviderKind as DbAiProviderKind, type PrismaClient } from "@prisma/client";
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL, hasAnthropicKey } from "./anthropic";
import { createLocalProvider } from "./local";
import { AiUnavailableError, type AiProvider } from "./types";

/** The id of the one settings row. */
const SETTINGS_ID = "singleton";

/** Sensible default for Ollama, which is what most people will be running. */
export const DEFAULT_LOCAL_BASE_URL = "http://localhost:11434/v1";

/** The stored settings, with defaults applied. */
export interface AiSettings {
  provider: DbAiProviderKind;
  baseUrl: string;
  model: string;
}

/** Read the settings row, or the defaults if it has never been saved. */
export async function loadAiSettings(db: PrismaClient): Promise<AiSettings> {
  const row = await db.aiSettings.findUnique({ where: { id: SETTINGS_ID } });

  return {
    provider: row?.provider ?? DbAiProviderKind.NONE,
    baseUrl: row?.baseUrl ?? DEFAULT_LOCAL_BASE_URL,
    model: row?.model ?? "",
  };
}

/** Write the settings row. */
export async function saveAiSettings(
  db: PrismaClient,
  settings: AiSettings,
): Promise<void> {
  const data = {
    provider: settings.provider,
    baseUrl: settings.baseUrl.trim() || null,
    model: settings.model.trim() || null,
  };

  await db.aiSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
}

/**
 * Build the configured provider, or null if AI features are switched off.
 *
 * Throws `AiUnavailableError` only when a provider IS configured but cannot be
 * built — a missing API key, a blank model. That distinction is what lets the
 * UI say "AI features are off" in one case and "your settings are incomplete"
 * in the other.
 */
export async function getProvider(db: PrismaClient): Promise<AiProvider | null> {
  const settings = await loadAiSettings(db);

  switch (settings.provider) {
    case DbAiProviderKind.NONE:
      return null;

    case DbAiProviderKind.LOCAL: {
      if (settings.model.length === 0) {
        throw new AiUnavailableError(
          "No local model is selected. Pick one on the AI settings screen.",
        );
      }
      return createLocalProvider(settings.baseUrl, settings.model);
    }

    case DbAiProviderKind.ANTHROPIC:
      return createAnthropicProvider(settings.model || DEFAULT_ANTHROPIC_MODEL);

    default:
      return null;
  }
}

/**
 * Why AI features are unavailable, or null if they are available.
 *
 * Used by screens that want to explain the situation before the user clicks
 * something that cannot work.
 */
export async function aiUnavailableReason(db: PrismaClient): Promise<string | null> {
  const settings = await loadAiSettings(db);

  if (settings.provider === DbAiProviderKind.NONE) {
    return "No AI provider is configured.";
  }
  if (settings.provider === DbAiProviderKind.LOCAL && settings.model.length === 0) {
    return "A local provider is selected but no model is chosen.";
  }
  if (settings.provider === DbAiProviderKind.ANTHROPIC && !hasAnthropicKey()) {
    return "Claude is selected but ANTHROPIC_API_KEY is not set in .env.";
  }
  return null;
}

export { AiUnavailableError };
export type { AiProvider };
