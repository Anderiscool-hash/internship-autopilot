import { z } from "zod";
import type { NameParts, PatternId } from "./pattern";

/**
 * Thrown whenever a configured Hunter call goes wrong.
 *
 * Never thrown for "Hunter is not configured" - that returns null.
 *
 * `retryable` tells the discovery pipeline whether to back off and try again
 * or to give up on Hunter for this run and continue on the free signals:
 *   - 429 (usage quota) / 403 (rate limit) / 5xx / network  -> retryable
 *   - 401 (no valid API key)                                -> NOT retryable
 *   - 404                                                   -> NOT retryable
 *   - 451 (legal restriction on this person's data)         -> NOT retryable
 *   - a 200 whose JSON does not match the expected shape    -> NOT retryable
 *     (retrying a schema mismatch spends quota to be told the same thing)
 */
export class HunterApiError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number }) {
    super(message);
    this.name = "HunterApiError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

const API_BASE = "https://api.hunter.io/v2";
const REQUEST_TIMEOUT_MS = 15_000;

/** Whether a Hunter key is present. Never returns the key itself. */
export function hunterConfigured(
  /** The variables to read. A plain record, so a test can pass just these. */
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.HUNTER_API_KEY && env.HUNTER_API_KEY.trim().length > 0);
}

function apiKey(): string | null {
  const key = process.env.HUNTER_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

// --- Shape of Hunter's responses, just enough to trust them ---------------
//
// Only the fields actually read are declared. Each schema keeps one required
// anchor field so that an error body, an HTML interstitial, or a shape change
// fails validation instead of quietly parsing as "Hunter knows nothing".
// `pattern` and `email` are required KEYS whose value may be null, because
// null is Hunter's documented "no answer" and must stay distinguishable from
// a response that never mentioned the field.

const DomainSearchSchema = z.object({
  data: z.object({
    pattern: z.string().nullable(),
  }),
});

const EmailFinderSchema = z.object({
  data: z.object({
    email: z.string().email().nullable(),
  }),
});

const EmailVerifierSchema = z.object({
  data: z.object({
    status: z.string(),
  }),
});

/**
 * Hunter's pattern syntax, mapped onto our ten-pattern union.
 *
 * Hunter models patterns we do not (middle initials, employee numbers,
 * reversed initials), and anything not in this table returns null rather
 * than being squeezed into the nearest member. A wrong pattern is worse than
 * no pattern: it would be persisted to EmailPattern and would then confidently
 * generate one wrong address for every future contact at that company.
 */
const HUNTER_PATTERNS: Readonly<Record<string, PatternId>> = {
  "{first}.{last}": "first.last",
  "{first}": "first",
  "{f}{last}": "flast",
  "{first}{last}": "firstlast",
  "{first}_{last}": "first_last",
  "{f}.{last}": "f.last",
  "{last}.{first}": "last.first",
  "{first}{l}": "firstl",
  "{last}{f}": "lastf",
  "{first}-{last}": "first-last",
};

export function hunterPatternToId(pattern: string | null | undefined): PatternId | null {
  if (!pattern) return null;
  return HUNTER_PATTERNS[pattern.trim().toLowerCase()] ?? null;
}

/**
 * One GET against Hunter, with the whole error taxonomy in one place.
 *
 * The API key travels in the query string, so the URL NEVER appears in a
 * message, a log line or a thrown error - only the endpoint name does. This
 * is the same discipline src/lib/email/env-file.ts follows when it reports
 * `hasPassword` instead of the password.
 */
async function hunterGet(
  endpoint: "domain-search" | "email-finder" | "email-verifier",
  params: Record<string, string>,
  key: string,
): Promise<unknown> {
  const query = new URLSearchParams({ ...params, api_key: key });
  const url = `${API_BASE}/${endpoint}?${query.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "User-Agent": "InternshipAutopilot/1.0 (+job-discovery; contact: internship-autopilot)",
        Accept: "application/json",
      },
    });
  } catch (error) {
    // Network failure, DNS failure, or the 15s timeout firing. Transient.
    throw new HunterApiError(
      `Network error calling Hunter ${endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    const status = response.status;

    if (status === 401) {
      throw new HunterApiError(
        `Hunter rejected the API key (401) on ${endpoint}. Check HUNTER_API_KEY in .env.`,
        { retryable: false, statusCode: 401 },
      );
    }
    if (status === 404) {
      throw new HunterApiError(`Hunter returned 404 for ${endpoint}.`, {
        retryable: false,
        statusCode: 404,
      });
    }
    if (status === 451) {
      // Hunter will not process this person's data for legal reasons.
      // Retrying cannot change that answer.
      throw new HunterApiError(
        `Hunter refused ${endpoint} for legal reasons (451). This person's data will not be returned.`,
        { retryable: false, statusCode: 451 },
      );
    }
    if (status === 403 || status === 429 || status >= 500) {
      // 403 is Hunter's rate limit and 429 its usage quota; both recover on
      // their own, as does a 5xx. The caller backs off and continues on the
      // free signals rather than failing the discovery.
      throw new HunterApiError(
        `Hunter returned HTTP ${status} on ${endpoint} (rate limit, quota, or server error).`,
        { retryable: true, statusCode: status },
      );
    }
    throw new HunterApiError(`Hunter returned unexpected HTTP ${status} on ${endpoint}.`, {
      retryable: false,
      statusCode: status,
    });
  }

  try {
    return await response.json();
  } catch (error) {
    // A 200 with an unreadable body: truncation, a proxy interstitial, or the
    // timeout firing mid-stream. All transient, like the Greenhouse client.
    throw new HunterApiError(
      `Hunter returned an unreadable response body on ${endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true },
    );
  }
}

function schemaError(endpoint: string, detail: string): HunterApiError {
  return new HunterApiError(
    `Hunter's ${endpoint} response did not match the expected shape: ${detail}`,
    { retryable: false },
  );
}

/**
 * The address pattern this company uses, or null.
 *
 * Null covers three different situations on purpose, because the caller
 * treats them identically - it simply has no pattern to persist:
 * Hunter is unconfigured, Hunter knows no pattern for the domain, or Hunter
 * reported a pattern our union cannot express.
 *
 * Consult this ONCE per domain and persist the answer to EmailPattern
 * (spec section 11). It is the most expensive question we ask.
 */
export async function hunterDomainPattern(domain: string): Promise<PatternId | null> {
  const key = apiKey();
  if (!key) return null;

  const body = await hunterGet("domain-search", { domain }, key);
  const parsed = DomainSearchSchema.safeParse(body);
  if (!parsed.success) {
    throw schemaError("domain-search", parsed.error.message);
  }

  return hunterPatternToId(parsed.data.data.pattern);
}

/**
 * The address Hunter believes belongs to this person, lowercased, or null
 * when Hunter is unconfigured or found nobody.
 */
export async function hunterFindEmail(
  domain: string,
  name: NameParts,
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  const body = await hunterGet(
    "email-finder",
    { domain, first_name: name.first, last_name: name.last },
    key,
  );
  const parsed = EmailFinderSchema.safeParse(body);
  if (!parsed.success) {
    throw schemaError("email-finder", parsed.error.message);
  }

  const email = parsed.data.data.email?.trim().toLowerCase();
  return email && email.length > 0 ? email : null;
}

/**
 * Hunter's verdict on one address: true for `valid`, false for `invalid`,
 * and null for everything else.
 *
 * Null is the honest answer for `accept_all`, `webmail`, `disposable` and
 * `unknown` - none of those is a statement about whether this particular
 * person reads mail at this address, and scoring them as a negative would be
 * the same mistake the Gravatar rule exists to prevent.
 *
 * Never call this for an address already CONFIRMED or BOUNCED: we already
 * know, and the quota is small (spec section 11).
 */
export async function hunterVerify(address: string): Promise<boolean | null> {
  const key = apiKey();
  if (!key) return null;

  const body = await hunterGet("email-verifier", { email: address }, key);
  const parsed = EmailVerifierSchema.safeParse(body);
  if (!parsed.success) {
    throw schemaError("email-verifier", parsed.error.message);
  }

  const status = parsed.data.data.status.trim().toLowerCase();
  if (status === "valid") return true;
  if (status === "invalid") return false;
  return null;
}
