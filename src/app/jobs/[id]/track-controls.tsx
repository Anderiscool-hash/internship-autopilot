/**
 * Saving a job onto the tracker from its detail page (spec §24).
 *
 * Two buttons, because there are two honest answers: "I want to apply to this"
 * and "I already did, elsewhere". The second is not the first followed by
 * five machine states that never happened — the state machine allows a person
 * to report reality directly, and this is where that happens.
 */

import { ApplicationStatus } from "@prisma/client";
import { trackJobAction } from "@/app/applications/actions";

export function TrackControls({
  jobId,
  fitScore,
  trackedStatus,
  hasProfile,
}: {
  jobId: string;
  fitScore: number | null;
  /** The application's current status, if this job is already tracked. */
  trackedStatus: string | null;
  hasProfile: boolean;
}) {
  if (!hasProfile) {
    return (
      <p className="note">
        <a href="/profile">Fill in your profile</a> to track this job.
      </p>
    );
  }

  if (trackedStatus !== null) {
    return (
      <p className="note">
        On your tracker as <strong>{trackedStatus}</strong> —{" "}
        <a href="/applications">open the tracker</a>.
      </p>
    );
  }

  return (
    <div className="track-controls">
      <form action={trackJobAction}>
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="status" value={ApplicationStatus.DISCOVERED} />
        {fitScore !== null ? (
          <input type="hidden" name="fitScore" value={fitScore} />
        ) : null}
        <button type="submit">Save to tracker</button>
      </form>

      <form action={trackJobAction}>
        <input type="hidden" name="jobId" value={jobId} />
        <input
          type="hidden"
          name="status"
          value={ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION}
        />
        {fitScore !== null ? (
          <input type="hidden" name="fitScore" value={fitScore} />
        ) : null}
        <button type="submit" className="secondary-button">
          I already applied
        </button>
      </form>
    </div>
  );
}
