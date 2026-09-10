/**
 * Where a job's application form actually lives.
 *
 * The canonical URL stored with a job (spec §6) is the employer's own posting
 * page, which is the right thing to link a human to — but it is often a
 * marketing page that embeds the real form in an iframe, or hides it behind an
 * "Apply" button. Preflight found this the hard way: a Coinbase posting parsed
 * as zero fields because the form was never on the page it landed on.
 *
 * Every ATS we support publishes its form at a predictable URL built from the
 * board identifier and the employer's own job id — both of which are already
 * stored on the job. That URL is what a form reader should open.
 */

/** The pieces needed to build an application URL. */
export interface ApplicationUrlInput {
  /** Database ATS enum spelling, e.g. GREENHOUSE. */
  atsType: string;
  /** The company's board token/slug, or null if never confirmed (spec §4). */
  atsIdentifier: string | null;
  /** The employer's own id for this posting. */
  sourceJobId: string;
  /** The employer's posting page, used as the fallback. */
  canonicalUrl: string;
}

/**
 * The best URL to read the application form from.
 *
 * Falls back to the canonical URL whenever the ATS-native form URL cannot be
 * built — an unconfirmed board slug, or a platform with no known pattern. The
 * fallback may well parse as nothing, and that is now reported as a failed
 * read rather than as a perfect score.
 */
export function applicationUrlFor(input: ApplicationUrlInput): string {
  const { atsType, atsIdentifier, sourceJobId, canonicalUrl } = input;
  if (!atsIdentifier) return canonicalUrl;

  const board = encodeURIComponent(atsIdentifier);
  const jobId = encodeURIComponent(sourceJobId);

  switch (atsType) {
    case "GREENHOUSE":
      // The embed endpoint, not job-boards.greenhouse.io/<board>/jobs/<id>.
      // For companies that host their own careers page — Coinbase, Stripe and
      // most of the registry — the hosted board 302s straight back to that
      // page, where the form is inside an iframe. This endpoint serves the
      // form itself, which is the thing a reader needs.
      return `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${jobId}`;
    case "LEVER":
      // Lever's posting page has the form on a /apply sub-path.
      return `https://jobs.lever.co/${board}/${jobId}/apply`;
    case "ASHBY":
      return `https://jobs.ashbyhq.com/${board}/${jobId}/application`;
    default:
      return canonicalUrl;
  }
}
