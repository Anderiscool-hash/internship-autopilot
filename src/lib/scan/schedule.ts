/**
 * When to scan which board (spec §5, "Adaptive Polling").
 *
 * The scheduler is deliberately stored in Postgres rather than in a job queue:
 * every company row already carries `lastScan`, `pollInterval`, `scanPriority`
 * and `failureCount`, and the `[active, lastScan]` index makes "who is due?"
 * a cheap query. That means the scanner can be a single long-running process
 * with no broker to install, and — importantly — if the process dies, nothing
 * is lost. The schedule is on disk, not in a queue's memory.
 *
 * Everything in this file is pure: it takes company rows and a clock and
 * returns numbers. No database, no side effects.
 */

/**
 * The four polling tiers from spec §5, in minutes.
 *
 * The spec gives ranges ("every ~10–15 minutes"); these pick the specific
 * numbers. Recently-active boards get the fast end of their range because
 * that is exactly when a new internship is most likely to appear.
 */
export const POLL_MINUTES = {
  /** Companies we care most about, regardless of how active their board is. */
  priority: 5,
  /** Boards that changed in the last day. */
  active: 12,
  /** Boards that changed within the last week. */
  normal: 30,
  /** Boards with no change in over a week, or that we've never seen change. */
  dormant: 60,
} as const;

export type PollTier = keyof typeof POLL_MINUTES;

/** A company row's scheduling fields — the only parts this file looks at. */
export interface SchedulableCompany {
  id: string;
  scanPriority: number;
  pollInterval: number;
  failureCount: number;
  lastScan: Date | null;
  lastChange: Date | null;
}

/**
 * Companies with `scanPriority` at or below this are always on the fast tier.
 *
 * The schema's default is 50 and states that lower means scanned more often,
 * so this is the cutoff for what "priority company" means in spec §5.
 */
export const PRIORITY_THRESHOLD = 10;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Which tier a company belongs in right now.
 *
 * `lastChange` is the board's own activity: the last scan that actually found
 * something new, removed or edited. A board that keeps returning the identical
 * list slides down the tiers on its own, which is the whole point — it frees
 * up scanning budget for boards that are actually moving.
 */
export function pollTierFor(company: SchedulableCompany, now: Date): PollTier {
  if (company.scanPriority <= PRIORITY_THRESHOLD) return "priority";
  if (company.lastChange === null) return "dormant";

  const sinceChange = now.getTime() - company.lastChange.getTime();
  if (sinceChange <= DAY_MS) return "active";
  if (sinceChange <= 7 * DAY_MS) return "normal";
  return "dormant";
}

/** The interval, in minutes, a company should be scanned at. */
export function nextPollInterval(company: SchedulableCompany, now: Date): number {
  return POLL_MINUTES[pollTierFor(company, now)];
}

/** Longest we will ever wait between attempts on a failing board: 6 hours. */
export const MAX_BACKOFF_MINUTES = 360;

/**
 * How long to wait after a failed scan (spec §5: error → backoff → retry).
 *
 * Doubles per consecutive failure and then stops growing. Capped rather than
 * unbounded because a board that has been down for a day may well be back;
 * giving up entirely on it would need a human to notice and re-enable it.
 */
export function backoffInterval(failureCount: number, baseInterval: number): number {
  const failures = Math.max(1, failureCount);
  const doubled = baseInterval * 2 ** (failures - 1);
  return Math.min(doubled, MAX_BACKOFF_MINUTES);
}

/** Whether a company is due for a scan right now. */
export function isDue(company: SchedulableCompany, now: Date): boolean {
  // Never scanned: due immediately. This is what makes a newly added company
  // get picked up on the next cycle instead of waiting out an interval.
  if (company.lastScan === null) return true;
  const elapsedMinutes = (now.getTime() - company.lastScan.getTime()) / MINUTE_MS;
  return elapsedMinutes >= company.pollInterval;
}

/**
 * Pick the companies to scan this cycle, most overdue first.
 *
 * Ordering: priority number first (lower = more important), then whoever has
 * been waiting longest. A company that has never been scanned sorts ahead of
 * every company that has.
 *
 * `limit` bounds how much work one cycle does, so a backlog of 500 overdue
 * boards is worked through steadily rather than fired off all at once.
 */
export function selectDueCompanies<T extends SchedulableCompany>(
  companies: T[],
  now: Date,
  limit: number,
): T[] {
  return companies
    .filter((company) => isDue(company, now))
    .sort((a, b) => {
      if (a.scanPriority !== b.scanPriority) return a.scanPriority - b.scanPriority;
      const aTime = a.lastScan?.getTime() ?? -Infinity;
      const bTime = b.lastScan?.getTime() ?? -Infinity;
      return aTime - bTime;
    })
    .slice(0, limit);
}
