/**
 * AI provider settings.
 *
 * The app's AI-assisted features — resume parsing today, requirement
 * extraction and document drafting later — all go through one provider chosen
 * here. Two backends, picked for opposite reasons:
 *
 *   Local  — free, private, and the right home for high-volume work. Your
 *            resume and Truth Ledger never leave this machine.
 *   Claude — better prose, the right home for the handful of documents that
 *            carry your name.
 *
 * Default is neither. Nothing turns itself on.
 */

import { AiProviderKind } from "@prisma/client";
import { db } from "@/lib/db";
import { loadAiSettings, DEFAULT_LOCAL_BASE_URL } from "@/lib/ai";
import { hasAnthropicKey, DEFAULT_ANTHROPIC_MODEL } from "@/lib/ai/anthropic";
import { listLocalModels } from "@/lib/ai/local";
import { saveAiSettingsAction, testAiSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI provider — Internship Autopilot",
};

interface AiSettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function AiSettingsPage({ searchParams }: AiSettingsPageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  const tested = one(params, "tested");
  const error = one(params, "error");

  const settings = await loadAiSettings(db);
  const keyPresent = hasAnthropicKey();

  // Ask the local server what it actually has installed, so the model field
  // can be a list rather than something you have to spell correctly. Empty
  // when the server is not running, which the page then says.
  const localModels = await listLocalModels(settings.baseUrl || DEFAULT_LOCAL_BASE_URL);

  return (
    <main className="page page-wide">
      <h1>AI provider</h1>
      <p className="lede">
        Which model the AI-assisted features use. Nothing is enabled by default,
        and no feature silently falls back to a different provider.
      </p>

      {saved ? <div className="notice notice-ok">Settings saved.</div> : null}
      {tested ? (
        <div className="notice notice-ok">
          <strong>Connection works.</strong> {tested}
        </div>
      ) : null}
      {error ? (
        <div className="notice notice-error">
          <strong>That did not work.</strong> {error}
        </div>
      ) : null}

      <form className="stack" action={saveAiSettingsAction}>
        <fieldset>
          <legend>Provider</legend>
          <div className="stack-tight">
            <label className="radio-row">
              <input
                type="radio"
                name="provider"
                value={AiProviderKind.NONE}
                defaultChecked={settings.provider === AiProviderKind.NONE}
              />
              <span>
                <strong>Off</strong>
                <small>
                  AI features stay disabled and say so. Everything else in the app
                  — discovery, eligibility, fit scoring, the tracker — is
                  rule-based and works without a model.
                </small>
              </span>
            </label>

            <label className="radio-row">
              <input
                type="radio"
                name="provider"
                value={AiProviderKind.LOCAL}
                defaultChecked={settings.provider === AiProviderKind.LOCAL}
              />
              <span>
                <strong>Local model</strong>
                <small>
                  An OpenAI-compatible server on this machine — Ollama, LM Studio
                  or vLLM. Free, and your resume never leaves the machine. Best
                  for the high-volume work.
                </small>
              </span>
            </label>

            <label className="radio-row">
              <input
                type="radio"
                name="provider"
                value={AiProviderKind.ANTHROPIC}
                defaultChecked={settings.provider === AiProviderKind.ANTHROPIC}
              />
              <span>
                <strong>Claude</strong>
                <small>
                  Better prose, for the documents that carry your name.{" "}
                  {keyPresent ? (
                    <>
                      <code>ANTHROPIC_API_KEY</code> is set in <code>.env</code>.
                    </>
                  ) : (
                    <>
                      Needs <code>ANTHROPIC_API_KEY</code> in <code>.env</code> —
                      not set right now. Keys are never stored in the database.
                    </>
                  )}
                </small>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Local model settings</legend>
          <div className="grid">
            <label className="field">
              <span>Server URL</span>
              <input
                type="text"
                name="baseUrl"
                defaultValue={settings.baseUrl || DEFAULT_LOCAL_BASE_URL}
              />
              <small>
                Ollama: <code>http://localhost:11434/v1</code>. LM Studio:{" "}
                <code>http://localhost:1234/v1</code>.
              </small>
            </label>

            <label className="field">
              <span>Model</span>
              {localModels.length > 0 ? (
                <select name="model" defaultValue={settings.model}>
                  <option value="">Choose a model…</option>
                  {localModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  name="model"
                  defaultValue={settings.model}
                  placeholder="e.g. an 8B instruct model you have pulled"
                />
              )}
              <small>
                {localModels.length > 0
                  ? `${localModels.length} model${localModels.length === 1 ? "" : "s"} found on that server.`
                  : "Could not reach that server, so this is a free-text box. Start Ollama or LM Studio and reload to pick from a list."}
              </small>
            </label>
          </div>
          <p className="note">
            For Claude, leave the model blank to use <code>{DEFAULT_ANTHROPIC_MODEL}</code>,
            or type a specific model id in the box above — the field is shared.
          </p>
        </fieldset>

        <div className="form-actions">
          <button type="submit">Save</button>
          <button type="submit" formAction={testAiSettingsAction} className="secondary-button">
            Save and test connection
          </button>
        </div>
      </form>

      <section>
        <h2>What uses this</h2>
        <p className="note">
          <strong>Working now:</strong> autofill from resume, on the{" "}
          <a href="/profile">profile screen</a> — and the parts of it that are
          pattern-based (email, phone, links, degree, graduation date) work with
          no provider at all. A provider adds your name, location and skills.
        </p>
        <p className="note">
          <strong>Not built yet:</strong> the fuzzy half of requirement
          extraction (§10), resume tailoring and cover letters (§14/§15). The
          hard eligibility engine, fit scoring and the classifier are all
          rule-based and never call a model.
        </p>
      </section>
    </main>
  );
}
