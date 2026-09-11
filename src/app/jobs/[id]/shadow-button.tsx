/**
 * "Fill this application" — starts a shadow run (spec §20).
 *
 * Only rendered for a local request, because the browser window opens on the
 * machine running the server. Offering it on a hosted copy would promise
 * something the viewer would never see.
 */

import { startShadowRunAction } from "./shadow-actions";

export function ShadowButton({
  jobId,
  local,
  hasProfile,
}: {
  jobId: string;
  local: boolean;
  hasProfile: boolean;
}) {
  if (!local || !hasProfile) return null;

  return (
    <form action={startShadowRunAction} className="shadow-start">
      <input type="hidden" name="jobId" value={jobId} />
      <button type="submit" className="secondary-button">
        Fill this application for me
      </button>
      <small>
        Opens the real form in a browser and fills what it can from your profile
        and answers. It never submits — when it finishes, the window is yours to
        check and send.
      </small>
    </form>
  );
}
