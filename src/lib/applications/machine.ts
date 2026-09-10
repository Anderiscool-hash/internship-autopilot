/**
 * The application workflow state machine (spec §23).
 *
 * Spec §23 opens with the requirement that shapes everything here: "every
 * application should be resumable". So the state lives in the database, one
 * row per application, and every legal move is written down in this file
 * rather than implied by whatever code happens to call `update`. If the
 * process dies mid-apply, the row still says exactly where it got to and what
 * may happen next.
 *
 * Two vocabularies share the enum, and keeping them straight matters:
 *
 *   - the pipeline states are the bot's progress through the work
 *   - the exception states are places it stopped and needs something
 *
 * On top of both sits the human, who is the authority on what actually
 * happened. "I applied to this myself" is legal from anywhere, because it is
 * a report of reality, not a step in the bot's plan.
 */

import { ApplicationStatus } from "@prisma/client";

/**
 * The happy path, in order (spec §23's arrows).
 *
 * An application advances one step at a time along this list. The order is
 * the spec's, not a rearrangement of it.
 */
export const PIPELINE: ApplicationStatus[] = [
  ApplicationStatus.DISCOVERED,
  ApplicationStatus.NORMALIZED,
  ApplicationStatus.ELIGIBLE,
  ApplicationStatus.MATCHED,
  ApplicationStatus.MATERIALS_READY,
  ApplicationStatus.PREFLIGHTED,
  ApplicationStatus.QUEUED,
  ApplicationStatus.APPLYING,
  ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION,
  ApplicationStatus.CONFIRMED,
];

/**
 * States where the bot stopped and something is needed (spec §23's exceptions).
 *
 * Reachable from any pipeline state — a CAPTCHA can appear at any point — and
 * every one of them except JOB_CLOSED can be recovered from.
 */
export const EXCEPTIONS: ApplicationStatus[] = [
  ApplicationStatus.WAITING_FOR_USER,
  ApplicationStatus.CAPTCHA,
  ApplicationStatus.LOGIN_REQUIRED,
  ApplicationStatus.AMBIGUOUS_QUESTION,
  ApplicationStatus.JOB_CLOSED,
  ApplicationStatus.FAILED,
  ApplicationStatus.SKIPPED,
];

/**
 * Moves the human may always make, whatever state the row is in.
 *
 * The bot's pipeline is strict; a person reporting what they did is not
 * bound by it. Someone who applied on the company's site directly needs to be
 * able to say so without walking the row through six machine states that
 * never happened.
 */
export const MANUAL_ANYWHERE: ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION,
  ApplicationStatus.CONFIRMED,
  ApplicationStatus.SKIPPED,
  ApplicationStatus.JOB_CLOSED,
];

/** Where an exception state resumes to when the blockage clears. */
const RESUME_TO: Partial<Record<ApplicationStatus, ApplicationStatus>> = {
  [ApplicationStatus.WAITING_FOR_USER]: ApplicationStatus.QUEUED,
  [ApplicationStatus.CAPTCHA]: ApplicationStatus.QUEUED,
  [ApplicationStatus.LOGIN_REQUIRED]: ApplicationStatus.QUEUED,
  [ApplicationStatus.AMBIGUOUS_QUESTION]: ApplicationStatus.QUEUED,
  // A failed attempt goes back into the queue rather than being abandoned;
  // most failures are a timeout or a changed form, both worth retrying.
  [ApplicationStatus.FAILED]: ApplicationStatus.QUEUED,
  // Un-skipping starts the row over from the beginning.
  [ApplicationStatus.SKIPPED]: ApplicationStatus.DISCOVERED,
};

/** Is this one of the spec's exception states? */
export function isException(status: ApplicationStatus): boolean {
  return EXCEPTIONS.includes(status);
}

/** Nothing further happens from here on its own. */
export function isTerminal(status: ApplicationStatus): boolean {
  return (
    status === ApplicationStatus.CONFIRMED || status === ApplicationStatus.JOB_CLOSED
  );
}

/** The next pipeline state, or null at the end of the line (or off it). */
export function nextInPipeline(status: ApplicationStatus): ApplicationStatus | null {
  const index = PIPELINE.indexOf(status);
  if (index === -1 || index === PIPELINE.length - 1) return null;
  return PIPELINE[index + 1] ?? null;
}

/** Where this exception state resumes to, or null if it is not resumable. */
export function resumeTarget(status: ApplicationStatus): ApplicationStatus | null {
  return RESUME_TO[status] ?? null;
}

/**
 * May the application move from one state to another?
 *
 * Legal moves are: one step forward along the pipeline, into any exception
 * state, out of a resumable exception back to where it resumes, and any of
 * the moves a human is always allowed to make.
 */
export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  if (from === to) return false;

  if (MANUAL_ANYWHERE.includes(to)) return true;
  if (isTerminal(from)) return false;
  if (nextInPipeline(from) === to) return true;
  if (isException(to)) return true;
  if (resumeTarget(from) === to) return true;

  return false;
}

/** Every state this application may legally move to right now. */
export function allowedTransitions(from: ApplicationStatus): ApplicationStatus[] {
  return Object.values(ApplicationStatus).filter((status) =>
    canTransition(from, status),
  );
}

/**
 * The columns the tracker groups applications into (spec §24).
 *
 * Deliberately coarser than the state machine: eleven pipeline states are the
 * bot's business, while a person looking at their search wants to see roughly
 * "saved / in progress / applied / needs me / done".
 */
export const TRACKER_COLUMNS = [
  {
    key: "saved",
    label: "Saved",
    statuses: [
      ApplicationStatus.DISCOVERED,
      ApplicationStatus.NORMALIZED,
      ApplicationStatus.ELIGIBLE,
      ApplicationStatus.MATCHED,
    ],
  },
  {
    key: "preparing",
    label: "Preparing",
    statuses: [
      ApplicationStatus.MATERIALS_READY,
      ApplicationStatus.PREFLIGHTED,
      ApplicationStatus.QUEUED,
      ApplicationStatus.APPLYING,
    ],
  },
  {
    key: "needs-you",
    label: "Needs you",
    statuses: [
      ApplicationStatus.WAITING_FOR_USER,
      ApplicationStatus.CAPTCHA,
      ApplicationStatus.LOGIN_REQUIRED,
      ApplicationStatus.AMBIGUOUS_QUESTION,
      ApplicationStatus.FAILED,
    ],
  },
  {
    key: "applied",
    label: "Applied",
    statuses: [
      ApplicationStatus.SUBMITTED_PENDING_CONFIRMATION,
      ApplicationStatus.CONFIRMED,
    ],
  },
  {
    key: "closed",
    label: "Closed",
    statuses: [ApplicationStatus.SKIPPED, ApplicationStatus.JOB_CLOSED],
  },
] as const;

export type TrackerColumnKey = (typeof TRACKER_COLUMNS)[number]["key"];

/** Which tracker column a status belongs in. */
export function columnFor(status: ApplicationStatus): TrackerColumnKey {
  for (const column of TRACKER_COLUMNS) {
    if ((column.statuses as readonly ApplicationStatus[]).includes(status)) {
      return column.key;
    }
  }
  // Unreachable while the columns cover the enum — asserted by a test.
  return "saved";
}
