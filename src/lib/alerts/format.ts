/**
 * What an internship alert says (spec §28).
 *
 * The spec's example is four lines:
 *
 *   Software Engineering Intern
 *   Location: NYC / Remote
 *   Posted: < 24 hours
 *   Minimum Match: 85%
 *
 * Three of those we can fill in truthfully today. The fourth — the match
 * percentage — comes from the fit engine in Phase 3, which does not exist yet.
 * So it is omitted rather than filled with a placeholder number: an alert that
 * says "Match: 85%" when nothing computed 85 is a fabricated fact, and this
 * project does not print those (spec §3).
 *
 * Pure string building. Nothing here sends anything.
 */

import type { Verdict } from "../jobs/filters";

/** The parts of a job an alert quotes. */
export interface AlertableJob {
  id: string;
  title: string;
  companyName: string;
  location: string | null;
  canonicalUrl: string;
  firstSeenAt: Date;
  /** The classifier's read on the title (spec §9). */
  verdict: Verdict;
}

/**
 * How long ago the posting turned up, in the vocabulary spec §28 uses.
 *
 * Rounded deliberately coarsely. Alerts are a "look at this now" signal, and
 * "< 24 hours" is the distinction that actually changes whether you act.
 */
export function describeAge(firstSeenAt: Date, now: Date): string {
  const hours = (now.getTime() - firstSeenAt.getTime()) / (60 * 60 * 1000);
  if (hours < 1) return "< 1 hour";
  if (hours < 24) return "< 24 hours";
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * One job as plain text.
 *
 * An "ambiguous" verdict is labelled as such. The keyword classifier is
 * explicitly not a decision (spec §9 escalates ambiguous titles to AI later),
 * and an alert that presents a maybe as a definitely trains you to distrust
 * the alerts.
 */
export function formatAlert(job: AlertableJob, now: Date): string {
  const lines = [
    `${job.title} — ${job.companyName}`,
    `Location: ${job.location?.trim() || "not stated"}`,
    `Posted: ${describeAge(job.firstSeenAt, now)}`,
  ];
  if (job.verdict === "ambiguous") {
    lines.push("Student role: unconfirmed — title is ambiguous");
  }
  lines.push(job.canonicalUrl);
  return lines.join("\n");
}

/** The most jobs one alert message lists before it just gives a count. */
export const MAX_JOBS_PER_MESSAGE = 10;

/**
 * Bundle a batch of new jobs into a single message.
 *
 * One message per batch rather than one per job: a scan that discovers thirty
 * internships at once should not produce thirty notifications, which is how
 * people end up muting the channel that was supposed to be useful.
 */
export function formatAlertBatch(jobs: AlertableJob[], now: Date): string {
  if (jobs.length === 0) return "";

  const heading =
    jobs.length === 1
      ? "1 new student-role posting"
      : `${jobs.length} new student-role postings`;

  const shown = jobs.slice(0, MAX_JOBS_PER_MESSAGE);
  const body = shown.map((job) => formatAlert(job, now)).join("\n\n");
  const remainder = jobs.length - shown.length;

  return remainder > 0
    ? `${heading}\n\n${body}\n\n…and ${remainder} more on the dashboard.`
    : `${heading}\n\n${body}`;
}
