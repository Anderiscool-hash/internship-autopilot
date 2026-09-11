/**
 * The profile screen: who you are, and what is true about you.
 *
 * Everything downstream depends on this page having been filled in — the
 * eligibility engine (spec §11) reads the work-authorization and graduation
 * fields, and the resume builder (spec §14) may only make claims the Truth
 * Ledger below supports.
 */

import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { aiUnavailableReason } from "@/lib/ai";
import type { ResumeSuggestions } from "@/lib/resume/parse-fields";
import { ProfileForm } from "./profile-form";
import { ResumeImport } from "./resume-import";
import { Documents } from "./documents";
import { listDocuments } from "@/lib/documents/store";
import { TruthLedger } from "./truth-ledger";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profile — Internship Autopilot",
};

interface ProfilePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Read one string out of the search params, ignoring repeats. */
function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** What each `saved=` value should say to the reader. */
const SAVED_MESSAGES: Record<string, string> = {
  profile: "Profile saved.",
  fact: "Added to the Truth Ledger.",
  deleted: "Removed from the Truth Ledger.",
  imported: "Resume read.",
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  // Errors are joined with "|" by the server actions so several can survive a
  // single redirect.
  const errors = (one(params, "errors") ?? "").split("|").filter(Boolean);

  let profile = null;
  let dbError: string | null = null;
  try {
    profile = await getProfile(db);
  } catch (error) {
    dbError = error instanceof Error ? error.message : String(error);
  }

  // What is on file to attach to an application. Empty until the profile
  // exists, since a document belongs to a person.
  const documents = profile ? await listDocuments(db, profile.id) : [];

  // A resume import in the URL means "show me what you read, filled into the
  // form". Nothing from it has touched the profile — the user reviews the
  // values and presses Save, or does not.
  const importId = one(params, "import");
  const note = one(params, "note");
  let suggestions: ResumeSuggestions = {};
  let importedFile: string | null = null;

  if (importId && dbError === null) {
    const imported = await db.resumeImport.findUnique({ where: { id: importId } });
    if (imported) {
      suggestions = imported.suggestions as ResumeSuggestions;
      importedFile = imported.filename;
    }
  }

  const aiOff = dbError === null ? await aiUnavailableReason(db) : null;

  if (dbError !== null) {
    return (
      <main className="page page-wide">
        <h1>Profile</h1>
        <div className="notice notice-error">
          <p>
            <strong>Can&apos;t reach the database.</strong> Start Postgres, then
            reload this page.
          </p>
          <p className="detail">{dbError}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-wide">
      <h1>Profile</h1>
      <p className="lede">
        Filled in once and reused everywhere: eligibility checks, resumes, cover
        letters, and application forms.
      </p>

      {saved && SAVED_MESSAGES[saved] ? (
        <div className="notice notice-ok">{SAVED_MESSAGES[saved]}</div>
      ) : null}

      {errors.length > 0 ? (
        <div className="notice notice-error">
          <p>
            <strong>Nothing was saved.</strong>
          </p>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {note ? <div className="notice">{note}</div> : null}

      {profile === null ? (
        <div className="notice">
          No profile yet. Name and email are all that is required to start —
          everything else can be filled in as you go. Or upload your resume
          below and check what it reads.
        </div>
      ) : null}

      <ResumeImport aiOff={aiOff} importedFile={importedFile} />

      <Documents documents={documents} />

      {importedFile ? (
        <div className="notice notice-ok">
          Filled in from <strong>{importedFile}</strong>. Everything below is a
          suggestion — check it, fix anything wrong, then press Save. Nothing has
          been stored yet.
        </div>
      ) : null}

      <ProfileForm profile={profile} suggestions={suggestions} />

      <TruthLedger facts={profile?.truthFacts ?? []} canAdd={profile !== null} />
    </main>
  );
}
