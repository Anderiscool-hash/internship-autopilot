/**
 * Claude, through the official Anthropic SDK.
 *
 * This is the intended home for the low-volume, high-stakes work: resume
 * tailoring and cover letters (spec §14/§15), where the output carries the
 * candidate's name and a local 8B model's prose is the weak link. The
 * high-volume extraction work belongs on the local provider — see local.ts.
 *
 * The API key is read from the environment, never from the database. Storing a
 * key in Postgres would put it in every backup and every `SELECT *`; the
 * project's convention is that secrets live in the git-ignored `.env`.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  AiUnavailableError,
  DEFAULT_MAX_TOKENS,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
} from "./types";

/** The default model when the settings screen has not pinned one. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

/** Is there a key available for Claude at all? */
export function hasAnthropicKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export function createAnthropicProvider(model: string): AiProvider {
  if (!hasAnthropicKey()) {
    throw new AiUnavailableError(
      "ANTHROPIC_API_KEY is not set. Add it to .env (it is git-ignored) and restart the server.",
    );
  }

  // Zero-arg constructor: the SDK resolves ANTHROPIC_API_KEY itself.
  const client = new Anthropic();

  return {
    kind: "anthropic",
    label: `Claude (${model})`,
    model,

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const startedAt = Date.now();

      try {
        const response = await client.messages.create({
          model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
        });

        // content is a discriminated union; narrow before reading .text.
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");

        return {
          text,
          model: response.model,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        // Turn the two failures a user can actually fix into instructions, and
        // let everything else through as itself.
        if (error instanceof Anthropic.AuthenticationError) {
          throw new AiUnavailableError(
            "Claude rejected the API key in .env. Check it is current and has credit.",
          );
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new AiUnavailableError(
            "Claude is rate limiting this key. Wait a moment and try again.",
          );
        }
        throw error;
      }
    },
  };
}
