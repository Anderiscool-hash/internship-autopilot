/**
 * SmartRecruiters job-board client.
 *
 * SmartRecruiters is one of the ATS platforms we monitor (spec section 4 & 6).
 * Every company that uses it publishes a free, public, unauthenticated JSON
 * feed of its open postings at:
 *
 *   https://api.smartrecruiters.com/v1/companies/{identifier}/postings?limit=100&offset=N
 *
 * `{identifier}` is the short slug SmartRecruiters assigns the company
 * (e.g. "BoschGroup"). The response is a page, not a whole board:
 *
 *   { offset, limit, totalFound, content: [ ...postings ] }
 *
 * so this client pages through it until it has `totalFound` postings.
 *
 * --- Why this file is longer than greenhouse.ts or lever.ts -----------------
 *
 * Greenhouse (`content=true`) and Lever hand back the full job description in
 * the same response as the job list. SmartRecruiters does NOT: the list
 * endpoint carries no description and no applyUrl at all. Getting either one
 * means a second HTTP request per posting:
 *
 *   https://api.smartrecruiters.com/v1/companies/{identifier}/postings/{postingId}
 *
 * which adds applyUrl, postingUrl, active, and
 * jobAd.sections.{companyDescription,jobDescription,qualifications,additionalInformation}.
 *
 * Bosch alone publishes 4,822 postings. Fetching a description for every one
 * of them on every poll would be slow and abusive toward a free,
 * unauthenticated API, so this client only hydrates postings that
 * SmartRecruiters itself has flagged as student-level roles - see
 * `isStudentPosting` below - and returns ONLY those. Measured on the Bosch
 * board (a 1,000-posting sample), that filter keeps about 24% of the board.
 *
 * --- Why non-student postings are dropped rather than returned empty -------
 *
 * `CanonicalJob.description` is a non-nullable `string` (see
 * src/lib/jobs/types.ts). It therefore cannot express the difference between
 * "the employer wrote no description" and "we chose not to spend a request
 * fetching this one". That difference matters: `extractRequirements`
 * (src/lib/eligibility/extract.ts) returns NO_REQUIREMENTS for an empty
 * description, and the eligibility engine reads NO_REQUIREMENTS as "nothing
 * here rules you out". A posting we simply never fetched would therefore
 * masquerade as a posting whose employer stated no requirements, and could be
 * shown to a candidate as eligible on the strength of data we never read.
 *
 * Rather than invent a schema change to carry that distinction, this client
 * never creates the ambiguity: every CanonicalJob it returns has been
 * hydrated and carries a description the employer actually wrote. Postings
 * outside the student filter are not returned at all. They are roles this app
 * exists to ignore, so dropping them also saves database rows, scan time and
 * downstream classification budget.
 */

import { z } from "zod";
import type { CanonicalJob, RemoteType } from "@/lib/jobs/types";
import { stripHtml } from "./html";

/**
 * Thrown whenever something goes wrong talking to SmartRecruiters.
 *
 * `retryable` tells the caller (the continuous scanner, spec section 5)
 * whether it makes sense to back off and try again later, or whether it
 * should give up on this board entirely:
 *   - HTTP 429 (rate limited) or 5xx (SmartRecruiters having a bad day) -> retryable
 *   - HTTP 404 (the company slug doesn't exist / was removed)          -> NOT retryable
 *   - a board with zero postings (see `fetchSmartRecruitersJobs`)       -> NOT retryable
 *   - more student postings than we are willing to hydrate              -> NOT retryable
 *   - a 200 response whose JSON doesn't match what we expect            -> NOT retryable
 *     (retrying won't fix a schema mismatch; a human needs to look at it)
 */
export class SmartRecruitersApiError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number }) {
    super(message);
    this.name = "SmartRecruitersApiError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

/** The largest page SmartRecruiters' postings endpoint will serve. */
const PAGE_SIZE = 100;

/**
 * The most detail requests this client will make in a single call.
 *
 * One request per student-flagged posting, so this is really "the largest
 * student board we are prepared to hydrate in one cycle". Bosch - by a wide
 * margin the biggest board we have looked at - flags roughly 1,150 of its
 * 4,822 postings, so 1,500 makes exceeding it genuinely exceptional rather
 * than routine.
 *
 * IMPORTANT: exceeding this cap THROWS rather than returning a shortened
 * list, and that is a correctness requirement, not fastidiousness. The
 * scanner's removal detection (src/lib/scan/diff.ts `shouldTrustForRemoval`)
 * only distrusts a fetch of length ZERO; any non-empty fetch is trusted to
 * mean "every stored OPEN job for this company that is missing from this list
 * has closed". A silently truncated list would therefore mark live
 * internships CLOSED purely because our pagination window shifted when a new
 * posting appeared at the top of the board. Throwing instead means the
 * scanner records a board failure, backs the board off, and runs no
 * closed-detection at all for that cycle - nothing is lost and nothing is
 * quietly wrong.
 */
export const MAX_DETAIL_FETCHES = 1500;

/**
 * Pause between consecutive detail requests. This endpoint is free and
 * unauthenticated; hydrating a thousand postings back-to-back as fast as the
 * network allows is the sort of thing that gets a public API closed.
 */
const DETAIL_REQUEST_DELAY_MS = 150;

/**
 * A safety valve for the paging loop. `totalFound` comes from the server, so
 * a misreported value (or a board that keeps serving pages forever) must not
 * be able to spin this function indefinitely. See `fetchSmartRecruitersJobs`.
 */
const MAX_LIST_PAGES = 200;

const REQUEST_TIMEOUT_MS = 15_000;

const REQUEST_HEADERS = {
  "User-Agent": "InternshipAutopilot/1.0 (+job-discovery; contact: internship-autopilot)",
  Accept: "application/json",
};

// --- Shape of SmartRecruiters' responses, just enough to trust them ---------
//
// We only declare the fields we actually use. `id` and `name` are required on
// a list item because sourceJobId and title are non-nullable on CanonicalJob -
// a posting missing either is treated as a malformed response rather than
// silently skipped.

const SmartRecruitersLocationSchema = z
  .object({
    city: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    fullLocation: z.string().nullable().optional(),
    // SmartRecruiters exposes the work arrangement as two explicit booleans
    // rather than as free text, so unlike Greenhouse we are reading a fact
    // rather than guessing from the location string.
    remote: z.boolean().nullable().optional(),
    hybrid: z.boolean().nullable().optional(),
  })
  .nullable()
  .optional();

/** `{ id, label }` - used for experienceLevel, typeOfEmployment. */
const SmartRecruitersLabelledSchema = z
  .object({
    id: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const SmartRecruitersListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullable().optional(),
  location: SmartRecruitersLocationSchema,
  experienceLevel: SmartRecruitersLabelledSchema,
  typeOfEmployment: SmartRecruitersLabelledSchema,
});

const SmartRecruitersListResponseSchema = z.object({
  offset: z.number().nullable().optional(),
  limit: z.number().nullable().optional(),
  totalFound: z.number(),
  content: z.array(SmartRecruitersListItemSchema),
});

const SmartRecruitersSectionSchema = z
  .object({
    title: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const SmartRecruitersDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  applyUrl: z.string().nullable().optional(),
  postingUrl: z.string().nullable().optional(),
  active: z.boolean().nullable().optional(),
  releasedDate: z.string().nullable().optional(),
  location: SmartRecruitersLocationSchema,
  experienceLevel: SmartRecruitersLabelledSchema,
  typeOfEmployment: SmartRecruitersLabelledSchema,
  jobAd: z
    .object({
      sections: z
        .object({
          companyDescription: SmartRecruitersSectionSchema,
          jobDescription: SmartRecruitersSectionSchema,
          qualifications: SmartRecruitersSectionSchema,
          additionalInformation: SmartRecruitersSectionSchema,
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

type SmartRecruitersListItem = z.infer<typeof SmartRecruitersListItemSchema>;
type SmartRecruitersDetail = z.infer<typeof SmartRecruitersDetailSchema>;

/**
 * SmartRecruiters' own `experienceLevel.id` values that mean "this role is
 * open to someone still in school or just out of it". Observed values across
 * the whole enum are: internship, entry_level, associate, mid_senior_level,
 * not_applicable, executive, director.
 *
 * Note deliberately these are THEIR structured fields, not this project's
 * title classifier (src/lib/jobs/classify). The ats/ modules must not depend
 * on the classifier: an ATS client's job is to report faithfully what the
 * platform published, and deciding whether a role suits this candidate is a
 * separate layer's decision made further downstream.
 */
const STUDENT_EXPERIENCE_LEVELS = new Set(["internship", "entry_level"]);

/**
 * SmartRecruiters' own `typeOfEmployment.id` values that mean the same thing.
 * Observed values: intern, permanent, part-time, contract.
 *
 * Checked in addition to the experience level because the two are set
 * independently - a posting tagged `typeOfEmployment: intern` is an
 * internship regardless of what experience level the recruiter picked.
 */
const STUDENT_EMPLOYMENT_TYPES = new Set(["intern"]);

/**
 * Is this a posting we should spend a detail request on?
 *
 * Uses only the structured fields SmartRecruiters already gave us in the
 * list response, so the decision costs nothing.
 */
function isStudentPosting(item: SmartRecruitersListItem): boolean {
  const experienceLevel = item.experienceLevel?.id ?? null;
  const employmentType = item.typeOfEmployment?.id ?? null;
  return (
    (experienceLevel !== null && STUDENT_EXPERIENCE_LEVELS.has(experienceLevel)) ||
    (employmentType !== null && STUDENT_EMPLOYMENT_TYPES.has(employmentType))
  );
}

/**
 * Maps SmartRecruiters' two location booleans to our RemoteType.
 *
 * `hybrid` is checked before `remote` because a posting that sets both is
 * describing a role with some in-office expectation, and "hybrid" is the more
 * accurate - and more restrictive - of the two labels to show a candidate.
 *
 * Both flags explicitly false is reported as "onsite" rather than "unknown":
 * these are real booleans the employer's recruiter filled in, so false is a
 * statement, not an absence. A posting with no location object at all, or
 * with the flags missing, stays "unknown".
 */
function mapRemoteType(
  location: z.infer<typeof SmartRecruitersLocationSchema>,
): RemoteType {
  if (!location) {
    return "unknown";
  }
  if (location.hybrid === true) {
    return "hybrid";
  }
  if (location.remote === true) {
    return "remote";
  }
  if (location.remote === false && location.hybrid === false) {
    return "onsite";
  }
  return "unknown";
}

/**
 * Human-readable location string for CanonicalJob.location.
 *
 * SmartRecruiters usually supplies `fullLocation` ("Pittsburgh, PA, United
 * States") pre-assembled; when it doesn't we build the same thing from the
 * parts that are present. Null when the posting gave us nothing to show,
 * rather than an empty string.
 */
function formatLocation(
  location: z.infer<typeof SmartRecruitersLocationSchema>,
): string | null {
  if (!location) {
    return null;
  }
  const full = location.fullLocation?.trim();
  if (full) {
    return full;
  }
  const parts = [location.city, location.region, location.country]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Builds the plain-text description by concatenating SmartRecruiters' four
 * job-ad sections, each preceded by its own heading so the structure of the
 * original posting survives.
 *
 * Order is deliberate: the role-specific text (description, then
 * qualifications, then additional information) comes first, and the reusable
 * employer boilerplate in `companyDescription` comes last, so anything that
 * reads only the beginning of the description is reading about the job rather
 * than about the company.
 */
function buildDescription(detail: SmartRecruitersDetail): string {
  const sections = detail.jobAd?.sections;
  if (!sections) {
    return "";
  }

  const ordered = [
    sections.jobDescription,
    sections.qualifications,
    sections.additionalInformation,
    sections.companyDescription,
  ];

  const parts: string[] = [];
  for (const section of ordered) {
    if (!section) {
      continue;
    }
    const heading = section.title ? stripHtml(section.title) : "";
    const body = section.text ? stripHtml(section.text) : "";
    if (heading || body) {
      parts.push([heading, body].filter(Boolean).join("\n"));
    }
  }
  return parts.join("\n\n");
}

/**
 * The public posting URL SmartRecruiters serves for a company/posting pair.
 *
 * Only a fallback: every posting this client returns has been hydrated, so we
 * normally have the real `postingUrl` straight from the detail response. This
 * form is verified to resolve and exists so a detail response that somehow
 * omits both URL fields still produces a usable canonicalUrl instead of
 * throwing away an otherwise good posting.
 */
function derivePostingUrl(identifier: string, postingId: string): string {
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(postingId)}`;
}

/**
 * Converts one hydrated SmartRecruiters posting into our CanonicalJob format.
 *
 * Salary is deliberately left null: the public postings API carries no
 * compensation data (it has a `customField` array whose contents differ per
 * company and are not a documented salary field), so rather than guess we
 * treat it as absent, per the project rule of never fabricating data.
 */
function toCanonicalJob(
  detail: SmartRecruitersDetail,
  identifier: string,
  companyName: string,
): CanonicalJob {
  const postedAtRaw = detail.releasedDate ?? null;
  const postedAt = postedAtRaw ? new Date(postedAtRaw) : null;

  return {
    companyName,
    source: "SmartRecruiters",
    sourceJobId: detail.id,
    atsType: "smartrecruiters",
    // SmartRecruiters titles frequently carry a trailing space
    // ("Robot Learning Engineering Intern "), which would otherwise show up
    // in the dashboard and in the dedupe fingerprint.
    title: detail.name.trim(),
    location: formatLocation(detail.location),
    remoteType: mapRemoteType(detail.location),
    employmentType: detail.typeOfEmployment?.label ?? null,
    // See function comment above: not exposed by this API.
    salaryMin: null,
    salaryMax: null,
    currency: null,
    description: buildDescription(detail),
    // postingUrl is the clean human-facing page; applyUrl is the same page
    // with SmartRecruiters' own tracking parameter attached, so it is the
    // second choice rather than the first.
    canonicalUrl:
      detail.postingUrl ?? detail.applyUrl ?? derivePostingUrl(identifier, detail.id),
    sourcePostedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
  };
}

/**
 * Wraps `fetch` so every transport-level failure becomes a retryable error.
 *
 * `notFound` decides what a 404 means for this particular request. For the
 * board listing a 404 is fatal (wrong identifier); for a single posting it
 * just means that posting vanished, so `"null"` asks for `null` back instead
 * of an exception. Returning null is unambiguous: neither endpoint ever
 * serves a literal `null` body on success.
 */
async function requestJson(
  url: string,
  describe: string,
  notFound: { behaviour: "throw"; message: string } | { behaviour: "null" },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: REQUEST_HEADERS,
    });
  } catch (error) {
    // Network failure, DNS failure, or the timeout firing. All transient.
    throw new SmartRecruitersApiError(
      `Network error fetching ${describe}: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      if (notFound.behaviour === "null") {
        return null;
      }
      throw new SmartRecruitersApiError(notFound.message, {
        retryable: false,
        statusCode: 404,
      });
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SmartRecruitersApiError(
        `SmartRecruiters returned HTTP ${response.status} for ${describe} (rate-limited or server error).`,
        { retryable: true, statusCode: response.status },
      );
    }
    throw new SmartRecruitersApiError(
      `SmartRecruiters returned unexpected HTTP ${response.status} for ${describe}.`,
      { retryable: false, statusCode: response.status },
    );
  }

  // A 200 whose body isn't valid JSON (truncated response, proxy
  // interstitial, HTML error page) makes .json() throw. Every failure here is
  // wrapped, not just SyntaxError: reading the body can also fail with a
  // TypeError if the connection drops mid-download, or an AbortError if the
  // timeout fires while the body is still streaming. Those are exactly as
  // transient as malformed JSON, and if we let them through unwrapped the
  // scanner's backoff logic - which keys off SmartRecruitersApiError.retryable
  // - would never see them.
  try {
    return await response.json();
  } catch (error) {
    throw new SmartRecruitersApiError(
      `SmartRecruiters returned an unreadable response body for ${describe}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true },
    );
  }
}

/**
 * Pages through the postings list until every posting has been collected.
 *
 * The loop is bounded three ways, because `totalFound` is a number the server
 * chose and we should not let it drive an unbounded loop: it stops when we
 * have `totalFound` items, when a page comes back empty, and unconditionally
 * after MAX_LIST_PAGES pages.
 */
async function fetchAllListings(
  identifier: string,
): Promise<{ items: SmartRecruitersListItem[]; totalFound: number }> {
  const items: SmartRecruitersListItem[] = [];
  let totalFound = 0;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(identifier)}/postings?limit=${PAGE_SIZE}&offset=${offset}`;

    const rawBody = await requestJson(url, `company "${identifier}"`, {
      behaviour: "throw",
      message:
        `SmartRecruiters company "${identifier}" was not found (404). ` +
        `The company identifier is likely wrong or the board was removed.`,
    });

    const parsed = SmartRecruitersListResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new SmartRecruitersApiError(
        `SmartRecruiters response for company "${identifier}" did not match the expected posting-list shape: ${parsed.error.message}`,
        { retryable: false },
      );
    }

    totalFound = parsed.data.totalFound;
    items.push(...parsed.data.content);

    // An empty page ends the walk even if totalFound says otherwise - the
    // board has no more to give and asking again would just loop.
    if (parsed.data.content.length === 0 || items.length >= totalFound) {
      break;
    }
  }

  return { items, totalFound };
}

/** Sleep, used to space out the per-posting detail requests. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches the full detail record for one posting.
 *
 * Returns null - meaning "skip this posting" - ONLY on a 404, which here means
 * the posting was taken down in the gap between our list request and this one.
 * Skipping is safe in that single case because the posting really is gone, so
 * letting the scanner mark it closed is the correct outcome.
 *
 * Every other failure throws, deliberately. Swallowing a 500 or a timeout
 * would shrink the returned list, and a shorter list is exactly what makes the
 * scanner close live jobs (see MAX_DETAIL_FETCHES above). Failing the whole
 * board is the safe direction.
 */
async function fetchPostingDetail(
  identifier: string,
  postingId: string,
): Promise<SmartRecruitersDetail | null> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(identifier)}/postings/${encodeURIComponent(postingId)}`;

  const rawBody = await requestJson(
    url,
    `posting "${postingId}" of company "${identifier}"`,
    { behaviour: "null" },
  );

  if (rawBody === null) {
    return null;
  }

  const parsed = SmartRecruitersDetailSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new SmartRecruitersApiError(
      `SmartRecruiters detail response for posting "${postingId}" of company "${identifier}" did not match the expected shape: ${parsed.error.message}`,
      { retryable: false },
    );
  }

  return parsed.data;
}

/**
 * Fetches every student-level posting by one company on SmartRecruiters.
 *
 * This is the only exported entry point most callers need. Give it the
 * company's SmartRecruiters identifier (e.g. "BoschGroup") and the company's
 * display name (used to fill CanonicalJob.companyName), and you get back a
 * fully normalized, validated job list ready for deduplication and scoring.
 *
 * What comes back is NOT the whole board - it is every posting
 * SmartRecruiters itself flagged as an internship or entry-level role, each
 * one hydrated with the real description and apply URL. See the file header
 * for why partial descriptions are unacceptable and the rest of the board is
 * dropped instead.
 *
 * A board with zero postings throws a NON-retryable error rather than
 * returning an empty array. SmartRecruiters answers 200 with
 * `{ totalFound: 0, content: [] }` for a company identifier that does not
 * exist - exactly the same response a real company with no open jobs would
 * get - so "no jobs" and "no such board" are indistinguishable, and silently
 * accepting a wrong identifier is the outcome to avoid. This is the same
 * reasoning src/lib/companies/verify.ts already applies to every supported
 * ATS.
 *
 * Note the narrower case: a board that HAS postings but none flagged as
 * student roles returns an empty array normally. That is an unambiguous
 * answer ("this employer exists and is hiring, just not interns"), not a
 * broken identifier, so it is not an error.
 */
export async function fetchSmartRecruitersJobs(
  identifier: string,
  companyName: string,
): Promise<CanonicalJob[]> {
  const { items, totalFound } = await fetchAllListings(identifier);

  if (totalFound === 0 || items.length === 0) {
    throw new SmartRecruitersApiError(
      `SmartRecruiters company "${identifier}" returned no postings at all. ` +
        `SmartRecruiters answers 200 with an empty list for an identifier that ` +
        `does not exist, so this is far more likely a wrong identifier than a ` +
        `company with nothing open.`,
      { retryable: false },
    );
  }

  const candidates = items.filter(isStudentPosting);

  // Checked BEFORE any detail request, so an oversized board costs one list
  // walk rather than a thousand hydration requests. See MAX_DETAIL_FETCHES:
  // returning a truncated list here would make the scanner close live jobs.
  if (candidates.length > MAX_DETAIL_FETCHES) {
    throw new SmartRecruitersApiError(
      `SmartRecruiters company "${identifier}" has ${candidates.length} student-level postings ` +
        `(of ${totalFound} total), which exceeds the hydration cap of ${MAX_DETAIL_FETCHES}. ` +
        `Returning a partial list would make the scanner mark live jobs as closed, so nothing ` +
        `is returned. Raise MAX_DETAIL_FETCHES or narrow the filter for this board.`,
      { retryable: false },
    );
  }

  const jobs: CanonicalJob[] = [];
  for (const [index, candidate] of candidates.entries()) {
    // Space out the requests - but only between them, so a board with a
    // single internship is not delayed for no reason.
    if (index > 0) {
      await delay(DETAIL_REQUEST_DELAY_MS);
    }

    const detail = await fetchPostingDetail(identifier, candidate.id);
    if (detail === null) {
      // 404: taken down between our list request and this one.
      continue;
    }
    if (detail.active === false) {
      // Same situation, reported in the body rather than by status code.
      continue;
    }

    jobs.push(toCanonicalJob(detail, identifier, companyName));
  }

  return jobs;
}
