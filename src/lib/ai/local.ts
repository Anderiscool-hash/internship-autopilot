/**
 * A local model, over an OpenAI-compatible HTTP endpoint.
 *
 * Ollama, LM Studio and vLLM all expose the same `/chat/completions` shape, so
 * one client covers all three and switching between them is a base-URL change.
 * Ollama serves it at http://localhost:11434/v1, LM Studio at
 * http://localhost:1234/v1.
 *
 * This is the intended home for the high-volume work — requirement extraction
 * over thousands of postings, and resume parsing. Resume parsing especially:
 * that document is the candidate's real history, and a local model means it
 * never leaves the machine.
 *
 * Uses plain `fetch` rather than the OpenAI SDK on purpose. The dependency
 * would exist solely to build one JSON body, and adding an OpenAI client to a
 * project that talks to Claude and a local model would invite someone to point
 * it at Claude's API too, which is not a supported way to call Claude.
 */

import {
  AiUnavailableError,
  DEFAULT_MAX_TOKENS,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
} from "./types";

/** How long to wait for a local model before giving up. */
const TIMEOUT_MS = 120_000;

/**
 * Local models are slow compared to a hosted API — a 8B model on a consumer
 * GPU produces tens of tokens a second, so a 2,000-token answer is a minute.
 * The timeout is generous for that reason, not by accident.
 */
export function createLocalProvider(baseUrl: string, model: string): AiProvider {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    kind: "local",
    label: `Local model at ${baseUrl}`,
    model,

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const startedAt = Date.now();

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
            // Low but not zero: deterministic enough that the same resume
            // parses the same way twice, without the degenerate repetition
            // small models fall into at exactly 0.
            temperature: 0.2,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.prompt },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        // A connection refused here is the normal state of the world when the
        // model server simply is not running, so it gets a message that says
        // what to do rather than a stack trace.
        const detail = error instanceof Error ? error.message : String(error);
        throw new AiUnavailableError(
          `Could not reach a local model at ${baseUrl} (${detail}). Is Ollama or LM Studio running?`,
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AiUnavailableError(
          `Local model returned ${response.status} ${response.statusText}. ${body.slice(0, 200)}`,
        );
      }

      const payload = (await response.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
      };

      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        throw new AiUnavailableError(
          "Local model returned a response with no message content.",
        );
      }

      return {
        text,
        model: payload.model ?? model,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}

/**
 * Ask a local server which models it has.
 *
 * Used by the settings screen so the model field can be a list of what is
 * actually installed rather than a text box you have to spell correctly.
 * Returns an empty list rather than throwing when the server is not running —
 * the caller shows "could not reach the server", which is more useful than an
 * exception.
 */
export async function listLocalModels(baseUrl: string): Promise<string[]> {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/models`;

  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: { id?: string }[] };
    return (payload.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort();
  } catch {
    return [];
  }
}
