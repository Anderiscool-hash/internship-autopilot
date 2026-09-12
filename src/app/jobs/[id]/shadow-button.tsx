/**
 * "Fill this application" — starts a shadow run (spec §20).
 *
 * Only rendered for a local request, because the browser window opens on the
 * machine running the server. Offering it on a hosted copy would promise
 * something the viewer would never see.
 */

import { mailboxStatus } from "@/lib/email/env-file";
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

  const configured = mailboxStatus().configured;

  return (
    <form action={startShadowRunAction} className="shadow-start">
      <input type="hidden" name="jobId" value={jobId} />
      <button type="submit" className="secondary-button">
        Fill this application for me
      </button>
      <small>
        Opens the real form in a browser and fills what it can from your profile
        and answers. It never submits — when it finishes, the window is yours to
        check and send.{" "}
        {configured ? (
          "It will also check your mailbox for a verification code if the form asks for one."
        ) : (
          <>
            No mailbox is configured, so it cannot read a verification code for
            you — <a href="/settings/mailbox">set one up</a>.
          </>
        )}
      </small>
    </form>
  );
}
