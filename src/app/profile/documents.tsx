/**
 * The documents an application will attach.
 *
 * The point of this panel is that a person can see, at a glance, whether the
 * one field every form requires is covered. A run that reports "no resume is
 * saved" is only useful if there is somewhere obvious to fix that.
 */

import { deleteDocumentAction, uploadDocumentAction } from "./document-actions";
import type { StoredDocument } from "@/lib/documents/store";

const KIND_LABELS: Record<string, string> = {
  RESUME: "Resume",
  COVER_LETTER: "Cover letter",
  TRANSCRIPT: "Transcript",
  OTHER: "Other",
};

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Documents({ documents }: { documents: StoredDocument[] }) {
  const hasResume = documents.some((document) => document.kind === "RESUME" && document.present);

  return (
    <section className="import-panel">
      <h2>Documents</h2>
      <p className="note">
        Saved once, attached automatically. A file goes in only when the form&rsquo;s field
        clearly names it — an unlabelled &ldquo;Attach a file&rdquo; is left for you, because
        the wrong document in an upload slot looks answered and reads wrong.
      </p>

      {!hasResume && (
        <p className="notice notice-warn">
          No resume is saved, so every application will stop at the upload field. Reading a
          resume in the panel above saves it here at the same time.
        </p>
      )}

      {documents.length === 0 ? (
        <p className="empty-compact">Nothing on file yet.</p>
      ) : (
        <div className="table-wrap entry-list">
          <table>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">File</th>
                <th scope="col">Size</th>
                <th scope="col">Remove</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>{KIND_LABELS[document.kind] ?? document.kind}</td>
                  <td>
                    {document.filename}
                    {/* The row can outlive the file — a restored database, a cleared
                        folder. Saying so here beats discovering it mid-application. */}
                    {!document.present && (
                      <span className="badge badge-reject"> missing from disk</span>
                    )}
                  </td>
                  <td>{sizeLabel(document.sizeBytes)}</td>
                  <td>
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="id" value={document.id} />
                      <button type="submit" className="link-button">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={uploadDocumentAction} className="entry-form">
        <label className="field">
          <span>Kind</span>
          <select name="kind" defaultValue="RESUME">
            <option value="RESUME">Resume</option>
            <option value="COVER_LETTER">Cover letter</option>
            <option value="TRANSCRIPT">Transcript</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="field">
          <span>File</span>
          <input type="file" name="document" accept=".pdf,.doc,.docx,.txt,.rtf,.md" required />
          <small>
            Uploading replaces whatever was saved for that kind — a form asks for
            &ldquo;your resume&rdquo;, singular.
          </small>
        </label>
        <button type="submit" className="small-button">
          Save document
        </button>
      </form>
    </section>
  );
}
