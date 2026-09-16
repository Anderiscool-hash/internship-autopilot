/**
 * Auto-apply rules (spec §18).
 *
 * This screen is where a person decides how much authority the software has
 * to act on their behalf. Nothing here is switched on by default: with no
 * preferences saved, every ATS is disabled and nothing is ever submitted
 * automatically. That is spec §18's own `unknown: false`, applied to the
 * product as a whole.
 */

import { AtsType } from "@prisma/client";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/candidate/store";
import { DEFAULT_RULES, readAtsModes } from "@/lib/autoapply/rules";
import { formatEnum } from "../jobs/format";
import { saveRulesAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Auto-apply — Internship Autopilot",
};

/**
 * ATS platforms with a working client today.
 *
 * The others are in the schema because the registry can describe them, but
 * there is no adapter to apply through, so offering a mode would be offering a
 * switch that turns nothing on.
 */
const SUPPORTED_ATS: AtsType[] = [AtsType.GREENHOUSE, AtsType.LEVER, AtsType.ASHBY];

interface SettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  const errors = (one(params, "error") ?? "").split("|").filter(Boolean);

  const profile = await getProfile(db);
  if (!profile) {
    return (
      <main className="page page-wide">
        <h1>Auto-apply</h1>
        <div className="notice">
          These rules belong to a person. <a href="/profile">Fill in your profile</a>{" "}
          first.
        </div>
      </main>
    );
  }

  const stored = await db.candidatePreferences.findUnique({
    where: { candidateId: profile.id },
  });
  const rules = stored ?? DEFAULT_RULES;
  const atsModes = readAtsModes(stored?.atsAutoApplyModes);

  return (
    <main className="page page-wide">
      <h1>Auto-apply</h1>
      <p className="lede">
        How much authority the software has to apply on your behalf (spec §18).
      </p>

      {/* This notice used to say the apply workers were "Phase 5 and not
          built", which stopped being true on 2026-09-15 and left the page
          reassuring people about software that now exists. A stale promise on
          the screen that authorises sending applications is worse than no
          promise, so it states what is actually holding submission back —
          which is evidence, and is therefore temporary by design. */}
      <div className="notice notice-warn">
        <p>
          <strong>These settings are live.</strong> The apply workers exist and
          can submit applications. What stops them today is evidence, not code:
          an ATS must reach trust level 3 before anything is sent, and that
          takes verified shadow runs you have not recorded yet.
        </p>
        <p>
          <strong>&ldquo;Auto&rdquo; is not inert.</strong> Setting an ATS to
          Auto <em>is</em> the opt-in for unattended submission — the one human
          decision that level 4 cannot make for itself. Choose{" "}
          <strong>Review</strong> if you want to see each application before it
          goes. See <a href="/shadow-runs">the review queue</a> for where each
          ATS currently stands.
        </p>
      </div>

      {saved ? <div className="notice notice-ok">Rules saved.</div> : null}
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

      <form className="stack" action={saveRulesAction}>
        <fieldset>
          <legend>Thresholds</legend>
          <div className="grid">
            <label className="field">
              <span>Minimum fit score</span>
              <input
                type="number"
                name="minimumFitScore"
                min={0}
                max={100}
                defaultValue={rules.minimumFitScore}
              />
              <small>Below this, a job is never queued at all (spec §18).</small>
            </label>

            <label className="field">
              <span>Minimum application confidence</span>
              <input
                type="number"
                name="minimumApplicationConfidence"
                min={0}
                max={100}
                defaultValue={rules.minimumApplicationConfidence}
              />
              <small>
                Spec §17&rsquo;s separate score: how sure the bot is it filled the
                form in correctly.
              </small>
            </label>

            <label className="field">
              <span>Maximum posting age (hours)</span>
              <input
                type="number"
                name="maximumPostingAgeHours"
                min={0}
                defaultValue={rules.maximumPostingAgeHours}
              />
              <small>Older postings are likely already filled.</small>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Limits</legend>
          <div className="grid">
            <label className="field">
              <span>Applications per day</span>
              <input
                type="number"
                name="dailyApplicationLimit"
                min={0}
                defaultValue={rules.dailyApplicationLimit}
              />
            </label>
            <label className="field">
              <span>Applications per company</span>
              <input
                type="number"
                name="maxApplicationsPerCompany"
                min={0}
                defaultValue={rules.maxApplicationsPerCompany}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Per-ATS authority</legend>
          <p className="note">
            Only platforms with a working client are listed. Anything not set to
            auto or review is disabled, and an ATS you never configure is
            disabled too — spec §18&rsquo;s <code>unknown: false</code>.
          </p>
          <div className="grid">
            {SUPPORTED_ATS.map((ats) => (
              <label key={ats} className="field">
                <span>{formatEnum(ats)}</span>
                <select name={`ats:${ats}`} defaultValue={atsModes[ats] ?? "DISABLED"}>
                  <option value="DISABLED">Disabled — never apply</option>
                  <option value="REVIEW">Review — prepare, then ask me</option>
                  <option value="AUTO">Auto — submit without asking</option>
                </select>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-actions">
          <button type="submit">Save rules</button>
        </div>
      </form>
    </main>
  );
}
