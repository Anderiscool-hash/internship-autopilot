/**
 * Noticing that a posting has been taken down (spec §5, removal tracking).
 *
 * A board never tells us "job 123 is closed" — it simply stops listing it. So
 * closure is inferred: anything we have stored as OPEN for this company that
 * did not appear in the fetch we just made is presumed gone.
 *
 * That inference is only as trustworthy as the fetch. See
 * `shouldTrustForRemoval` below for the case where it is not.
 */

/** The stored jobs we compare a fresh fetch against. */
export interface KnownJob {
  id: string;
  sourceJobId: string;
}

/**
 * Whether a fetch is solid enough to close jobs on the strength of it.
 *
 * An empty board is indistinguishable from a board that briefly returned
 * nothing — a deploy, a rate limit answered with an empty list, an ATS glitch.
 * Closing every job a company has on that basis would wipe a company's entire
 * listing set from one bad response, and `firstSeenAt` would be lost when the
 * jobs came back as "new".
 *
 * So an empty fetch closes nothing. The cost of being wrong in this direction
 * is a job showing as open a little longer; the cost in the other direction is
 * losing real discovery history. That is not a close call.
 */
export function shouldTrustForRemoval(fetchedCount: number): boolean {
  return fetchedCount > 0;
}

/**
 * Which stored jobs did not show up in this fetch.
 *
 * Returns database ids, ready to hand to an `updateMany`. Order follows the
 * `known` array so the result is deterministic for tests and logs.
 */
export function findDisappearedJobs(
  known: KnownJob[],
  fetchedSourceJobIds: Iterable<string>,
): string[] {
  const seen = new Set(fetchedSourceJobIds);
  return known.filter((job) => !seen.has(job.sourceJobId)).map((job) => job.id);
}

/**
 * Did this scan find anything that matters for adaptive polling?
 *
 * Only appearances and disappearances count. Every re-scan "updates" every job
 * it sees (that is just `lastSeenAt` moving), so counting updates as change
 * would mean every board looked permanently active and no board would ever
 * drop to a slower tier.
 */
export function boardChanged(created: number, closed: number): boolean {
  return created > 0 || closed > 0;
}
