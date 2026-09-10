/**
 * The one interface every AI provider implements.
 *
 * Two implementations exist: a local model over an OpenAI-compatible endpoint
 * (Ollama, LM Studio, vLLM) and Claude through the official Anthropic SDK.
 * Everything downstream — resume parsing, requirement extraction, document
 * drafting — talks to this interface and never to a vendor SDK directly, so
 * swapping providers is a settings change rather than a rewrite.
 *
 * Deliberately small. This app asks a model for text and occasionally for
 * JSON; it does not need streaming, tool use or conversation state, and an
 * interface that promised those would have to be honoured by both backends.
 */

/** What to ask the model. */
export interface CompletionRequest {
  /** Instructions about the task and the rules the answer must obey. */
  system: string;
  /** The content to work on. */
  prompt: string;
  /** Ceiling on the response length. Providers may cap this lower. */
  maxTokens?: number;
}

/** What came back. */
export interface CompletionResult {
  text: string;
  /** The model that actually answered — not necessarily the one requested. */
  model: string;
  /** Round-trip time, used by the settings screen's connection test. */
  latencyMs: number;
}

/** A configured, ready-to-use provider. */
export interface AiProvider {
  /** Which backend this is: "local" or "anthropic". */
  readonly kind: AiProviderKind;
  /** Human-readable description for the settings screen. */
  readonly label: string;
  /** The model id this provider will use. */
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** The backends this app knows how to talk to. */
export type AiProviderKind = "local" | "anthropic";

/**
 * Thrown when no provider is configured, or the configured one cannot run.
 *
 * A distinct error type because the callers must treat it differently from a
 * model that answered badly: no provider means "this feature is switched off",
 * which is a thing to tell the user plainly, not an error to retry.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** Default ceiling when a caller does not set one. */
export const DEFAULT_MAX_TOKENS = 2048;
