/**
 * The "autofill from resume" panel.
 *
 * Upload a resume, and the fields below fill in with what was read from it —
 * as a draft. Nothing is stored until Save is pressed on the profile form, and
 * every suggested value shows the line of the resume it came from so it can be
 * checked rather than trusted (spec §3).
 *
 * Works with no AI provider at all: email, phone, LinkedIn, GitHub, degree and
 * graduation date have shapes a pattern reads reliably. A provider adds the
 * things patterns cannot do — your name, your location, and your skills.
 */

import { importResumeAction } from "./resume-actions";

export function ResumeImport({
  aiOff,
  importedFile,
}: {
  /** Why the AI half is unavailable, or null when a provider is configured. */
  aiOff: string | null;
  /** The file a review is currently showing, if any. */
  importedFile: string | null;
}) {
  return (
    <section className="import-panel">
      <h2>Autofill from resume</h2>
      <p className="note">
        Upload a PDF, DOCX or text resume and the form below fills in with what
        it says. Everything stays editable and nothing is saved until you press
        Save — a value read out of a document is a suggestion, not a fact.
      </p>

      <form action={importResumeAction} className="import-form">
        <label className="field">
          <span>Resume file</span>
          <input type="file" name="resume" accept=".pdf,.docx,.txt,.md" required />
          <small>
            {aiOff === null
              ? "Contact details, degree and graduation date are read by pattern; your name, location and skills come from your configured model."
              : `Contact details, degree and graduation date will be read by pattern. ${aiOff} Name, location and skills will be left blank — set up a model on the AI settings screen to fill those too.`}
          </small>
        </label>
        <button type="submit" className="small-button">
          {importedFile ? "Read another resume" : "Read resume"}
        </button>
      </form>

      {aiOff !== null ? (
        <p className="note">
          <a href="/settings/ai">AI provider settings →</a>
        </p>
      ) : null}
    </section>
  );
}
