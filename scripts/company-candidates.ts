/**
 * Candidate company boards — GUESSES, NOT FACTS.
 *
 * Every entry below is a *proposal*: a company that plausibly hires software,
 * data, or product interns and new grads in the US, paired with the board
 * slug it most likely uses on Greenhouse, Lever, or Ashby. Nothing here was
 * looked up in a directory and nothing here is confirmed. The slugs were
 * written down from the usual naming convention (lowercase company name, no
 * punctuation) and are expected to be wrong some of the time.
 *
 * That is fine, and it is the point: `scripts/add-companies.ts` checks every
 * single one against the live ATS through `verifyBoard()` before anything is
 * written to the database. A wrong guess fails the check and is discarded.
 *
 * The one thing verification CANNOT catch is a slug that belongs to a
 * *different real company* — that board answers with real jobs and passes.
 * Which is why the script prints sample titles for every pass, and why a
 * human reads them before running `--commit`.
 *
 * Only the three ATS platforms with a working client (see src/lib/ats/index.ts)
 * are listed. Companies on Workday/iCIMS/etc. are deliberately absent because
 * the verifier cannot check them yet.
 */

import type { AtsType } from "../src/lib/jobs/types";

/** One proposed board, before anyone has asked the ATS whether it exists. */
export interface CompanyCandidate {
  /** Display name to store if the board verifies. */
  name: string;
  /** Which platform to ask. Only greenhouse/lever/ashby are supported today. */
  atsType: AtsType;
  /** The guessed board token / site id / org slug. */
  identifier: string;
  /** Primary web domain, used for display and for duplicate detection. */
  domain?: string;
}

// ---------------------------------------------------------------------------
// GREENHOUSE — board tokens, as in boards-api.greenhouse.io/v1/boards/<token>
// ---------------------------------------------------------------------------
const greenhouseCandidates: CompanyCandidate[] = [
  { name: "Databricks", atsType: "greenhouse", identifier: "databricks", domain: "databricks.com" },
  { name: "Robinhood", atsType: "greenhouse", identifier: "robinhood", domain: "robinhood.com" },
  { name: "Discord", atsType: "greenhouse", identifier: "discord", domain: "discord.com" },
  { name: "Notion", atsType: "greenhouse", identifier: "notion", domain: "notion.so" },
  { name: "Anthropic", atsType: "greenhouse", identifier: "anthropic", domain: "anthropic.com" },
  { name: "Plaid", atsType: "greenhouse", identifier: "plaid", domain: "plaid.com" },
  { name: "Brex", atsType: "greenhouse", identifier: "brex", domain: "brex.com" },
  { name: "Asana", atsType: "greenhouse", identifier: "asana", domain: "asana.com" },
  { name: "GitLab", atsType: "greenhouse", identifier: "gitlab", domain: "gitlab.com" },
  { name: "Flexport", atsType: "greenhouse", identifier: "flexport", domain: "flexport.com" },
  { name: "Instacart", atsType: "greenhouse", identifier: "instacart", domain: "instacart.com" },
  { name: "DoorDash", atsType: "greenhouse", identifier: "doordash", domain: "doordash.com" },
  { name: "Lyft", atsType: "greenhouse", identifier: "lyft", domain: "lyft.com" },
  { name: "Pinterest", atsType: "greenhouse", identifier: "pinterest", domain: "pinterest.com" },
  { name: "Reddit", atsType: "greenhouse", identifier: "reddit", domain: "reddit.com" },
  { name: "Twitch", atsType: "greenhouse", identifier: "twitch", domain: "twitch.tv" },
  { name: "Affirm", atsType: "greenhouse", identifier: "affirm", domain: "affirm.com" },
  { name: "Chime", atsType: "greenhouse", identifier: "chime", domain: "chime.com" },
  { name: "Gusto", atsType: "greenhouse", identifier: "gusto", domain: "gusto.com" },
  { name: "Samsara", atsType: "greenhouse", identifier: "samsara", domain: "samsara.com" },
  { name: "Rippling", atsType: "greenhouse", identifier: "rippling", domain: "rippling.com" },
  { name: "SoFi", atsType: "greenhouse", identifier: "sofi", domain: "sofi.com" },
  { name: "Wealthfront", atsType: "greenhouse", identifier: "wealthfront", domain: "wealthfront.com" },
  { name: "Roblox", atsType: "greenhouse", identifier: "roblox", domain: "roblox.com" },
  { name: "Unity", atsType: "greenhouse", identifier: "unity", domain: "unity.com" },
  { name: "Verkada", atsType: "greenhouse", identifier: "verkada", domain: "verkada.com" },
  { name: "Anduril Industries", atsType: "greenhouse", identifier: "andurilindustries", domain: "anduril.com" },
  { name: "Scale AI", atsType: "greenhouse", identifier: "scaleai", domain: "scale.com" },
  { name: "Benchling", atsType: "greenhouse", identifier: "benchling", domain: "benchling.com" },
  { name: "Airtable", atsType: "greenhouse", identifier: "airtable", domain: "airtable.com" },
  { name: "Amplitude", atsType: "greenhouse", identifier: "amplitude", domain: "amplitude.com" },
  { name: "Twilio", atsType: "greenhouse", identifier: "twilio", domain: "twilio.com" },
  { name: "Snowflake", atsType: "greenhouse", identifier: "snowflakecomputing", domain: "snowflake.com" },
  { name: "HashiCorp", atsType: "greenhouse", identifier: "hashicorp", domain: "hashicorp.com" },
  { name: "Confluent", atsType: "greenhouse", identifier: "confluent", domain: "confluent.io" },
  { name: "MongoDB", atsType: "greenhouse", identifier: "mongodb", domain: "mongodb.com" },
  { name: "Elastic", atsType: "greenhouse", identifier: "elastic", domain: "elastic.co" },
  { name: "Datadog", atsType: "greenhouse", identifier: "datadog", domain: "datadoghq.com" },
  { name: "Atlassian", atsType: "greenhouse", identifier: "atlassian", domain: "atlassian.com" },
  { name: "Dropbox", atsType: "greenhouse", identifier: "dropbox", domain: "dropbox.com" },
  { name: "Box", atsType: "greenhouse", identifier: "boxinc", domain: "box.com" },
  { name: "Okta", atsType: "greenhouse", identifier: "okta", domain: "okta.com" },
  { name: "Duolingo", atsType: "greenhouse", identifier: "duolingo", domain: "duolingo.com" },
  { name: "Grammarly", atsType: "greenhouse", identifier: "grammarly", domain: "grammarly.com" },
  { name: "Sentry", atsType: "greenhouse", identifier: "sentry", domain: "sentry.io" },
  { name: "Retool", atsType: "greenhouse", identifier: "retool", domain: "retool.com" },
  { name: "Squarespace", atsType: "greenhouse", identifier: "squarespace", domain: "squarespace.com" },
  { name: "Wayfair", atsType: "greenhouse", identifier: "wayfair", domain: "wayfair.com" },
  { name: "Carta", atsType: "greenhouse", identifier: "carta", domain: "carta.com" },
  { name: "Addepar", atsType: "greenhouse", identifier: "addepar", domain: "addepar.com" },
  { name: "Betterment", atsType: "greenhouse", identifier: "betterment", domain: "betterment.com" },
  { name: "Marqeta", atsType: "greenhouse", identifier: "marqeta", domain: "marqeta.com" },
  { name: "Deel", atsType: "greenhouse", identifier: "deel", domain: "deel.com" },
  { name: "Oscar Health", atsType: "greenhouse", identifier: "oscarhealth", domain: "hioscar.com" },
  { name: "Cruise", atsType: "greenhouse", identifier: "cruise", domain: "getcruise.com" },
  { name: "Waymo", atsType: "greenhouse", identifier: "waymo", domain: "waymo.com" },
  { name: "Applied Intuition", atsType: "greenhouse", identifier: "appliedintuition", domain: "appliedintuition.com" },
  { name: "Zipline", atsType: "greenhouse", identifier: "zipline", domain: "flyzipline.com" },
  { name: "Astranis", atsType: "greenhouse", identifier: "astranis", domain: "astranis.com" },
  { name: "Relativity Space", atsType: "greenhouse", identifier: "relativity", domain: "relativityspace.com" },
  { name: "Two Sigma", atsType: "greenhouse", identifier: "twosigma", domain: "twosigma.com" },
  { name: "Jane Street", atsType: "greenhouse", identifier: "janestreet", domain: "janestreet.com" },
  { name: "Point72", atsType: "greenhouse", identifier: "point72", domain: "point72.com" },
  { name: "Millennium", atsType: "greenhouse", identifier: "millennium", domain: "mlp.com" },
  { name: "Blend", atsType: "greenhouse", identifier: "blend", domain: "blend.com" },
  { name: "Nextdoor", atsType: "greenhouse", identifier: "nextdoor", domain: "nextdoor.com" },
  { name: "Life360", atsType: "greenhouse", identifier: "life360", domain: "life360.com" },
  { name: "Course Hero", atsType: "greenhouse", identifier: "coursehero", domain: "coursehero.com" },
  { name: "Udemy", atsType: "greenhouse", identifier: "udemy", domain: "udemy.com" },
  { name: "Handshake", atsType: "greenhouse", identifier: "joinhandshake", domain: "joinhandshake.com" },
];

// ---------------------------------------------------------------------------
// LEVER — site ids, as in api.lever.co/v0/postings/<site>
// ---------------------------------------------------------------------------
const leverCandidates: CompanyCandidate[] = [
  { name: "Netflix", atsType: "lever", identifier: "netflix", domain: "netflix.com" },
  { name: "Attentive", atsType: "lever", identifier: "attentive", domain: "attentive.com" },
  { name: "Nuro", atsType: "lever", identifier: "nuro", domain: "nuro.ai" },
  { name: "Zoox", atsType: "lever", identifier: "zoox", domain: "zoox.com" },
  { name: "Kandji", atsType: "lever", identifier: "kandji", domain: "kandji.io" },
  { name: "Veeva Systems", atsType: "lever", identifier: "veeva", domain: "veeva.com" },
  { name: "Mixpanel", atsType: "lever", identifier: "mixpanel", domain: "mixpanel.com" },
  { name: "Lattice", atsType: "lever", identifier: "lattice", domain: "lattice.com" },
  { name: "Thumbtack", atsType: "lever", identifier: "thumbtack", domain: "thumbtack.com" },
  { name: "Fetch Rewards", atsType: "lever", identifier: "fetchrewards", domain: "fetch.com" },
  { name: "Quora", atsType: "lever", identifier: "quora", domain: "quora.com" },
  { name: "KeepTruckin", atsType: "lever", identifier: "keeptruckin", domain: "gomotive.com" },
  { name: "Matterport", atsType: "lever", identifier: "matterport", domain: "matterport.com" },
  { name: "Sardine", atsType: "lever", identifier: "sardine", domain: "sardine.ai" },
  { name: "Metronome", atsType: "lever", identifier: "metronome", domain: "metronome.com" },
  { name: "Turo", atsType: "lever", identifier: "turo", domain: "turo.com" },
  { name: "Wisetack", atsType: "lever", identifier: "wisetack", domain: "wisetack.com" },
  { name: "Shield AI", atsType: "lever", identifier: "shieldai", domain: "shield.ai" },
  { name: "Cresta", atsType: "lever", identifier: "cresta", domain: "cresta.com" },
  { name: "Voleon", atsType: "lever", identifier: "voleon", domain: "voleon.com" },
];

// ---------------------------------------------------------------------------
// ASHBY — org slugs, as in api.ashbyhq.com/posting-api/job-board/<org>
// ---------------------------------------------------------------------------
const ashbyCandidates: CompanyCandidate[] = [
  { name: "Linear", atsType: "ashby", identifier: "linear", domain: "linear.app" },
  { name: "Vanta", atsType: "ashby", identifier: "vanta", domain: "vanta.com" },
  { name: "Cohere", atsType: "ashby", identifier: "cohere", domain: "cohere.com" },
  { name: "Perplexity AI", atsType: "ashby", identifier: "perplexity.ai", domain: "perplexity.ai" },
  { name: "Sierra", atsType: "ashby", identifier: "sierra", domain: "sierra.ai" },
  { name: "Harvey", atsType: "ashby", identifier: "harvey", domain: "harvey.ai" },
  { name: "Clay", atsType: "ashby", identifier: "clay", domain: "clay.com" },
  { name: "Mercor", atsType: "ashby", identifier: "mercor", domain: "mercor.com" },
  { name: "Deepgram", atsType: "ashby", identifier: "deepgram", domain: "deepgram.com" },
  { name: "Modal", atsType: "ashby", identifier: "modal", domain: "modal.com" },
  { name: "Replit", atsType: "ashby", identifier: "replit", domain: "replit.com" },
  { name: "Supabase", atsType: "ashby", identifier: "supabase", domain: "supabase.com" },
  { name: "Hex", atsType: "ashby", identifier: "hex", domain: "hex.tech" },
  { name: "Chainguard", atsType: "ashby", identifier: "chainguard", domain: "chainguard.dev" },
  { name: "Gamma", atsType: "ashby", identifier: "gamma", domain: "gamma.app" },
  { name: "ElevenLabs", atsType: "ashby", identifier: "elevenlabs", domain: "elevenlabs.io" },
  { name: "Runway", atsType: "ashby", identifier: "runwayml", domain: "runwayml.com" },
  { name: "Together AI", atsType: "ashby", identifier: "togetherai", domain: "together.ai" },
  { name: "Browserbase", atsType: "ashby", identifier: "browserbase", domain: "browserbase.com" },
  { name: "Warp", atsType: "ashby", identifier: "warp", domain: "warp.dev" },
  { name: "Anysphere (Cursor)", atsType: "ashby", identifier: "anysphere", domain: "cursor.com" },
  { name: "Decagon", atsType: "ashby", identifier: "decagon", domain: "decagon.ai" },
  { name: "Abridge", atsType: "ashby", identifier: "abridge", domain: "abridge.com" },
  { name: "Watershed", atsType: "ashby", identifier: "watershed", domain: "watershed.com" },
  { name: "Assembled", atsType: "ashby", identifier: "assembled", domain: "assembled.com" },
  { name: "Zip", atsType: "ashby", identifier: "zip", domain: "ziphq.com" },
  { name: "Baseten", atsType: "ashby", identifier: "baseten", domain: "baseten.co" },
  { name: "LangChain", atsType: "ashby", identifier: "langchain", domain: "langchain.com" },
  { name: "Weights & Biases", atsType: "ashby", identifier: "wandb", domain: "wandb.ai" },
  { name: "Notable", atsType: "ashby", identifier: "notable", domain: "notablehealth.com" },
  { name: "Astronomer", atsType: "ashby", identifier: "astronomer", domain: "astronomer.io" },
  { name: "Doss", atsType: "ashby", identifier: "doss", domain: "doss.com" },
  { name: "Mux", atsType: "ashby", identifier: "mux", domain: "mux.com" },
  { name: "Tailscale", atsType: "ashby", identifier: "tailscale", domain: "tailscale.com" },
  { name: "Render", atsType: "ashby", identifier: "render", domain: "render.com" },
  { name: "Rain", atsType: "ashby", identifier: "rain", domain: "rain.com" },
  { name: "Sourcegraph", atsType: "ashby", identifier: "sourcegraph", domain: "sourcegraph.com" },
  { name: "Sardine AI", atsType: "ashby", identifier: "sardineai", domain: "sardine.ai" },
  { name: "Foursquare", atsType: "ashby", identifier: "foursquare", domain: "foursquare.com" },
  { name: "Luminance", atsType: "ashby", identifier: "luminance", domain: "luminance.com" },
];

/**
 * Every candidate, in one list. Grouped above by ATS purely for readability —
 * the script verifies them in this order, one at a time.
 */
export const COMPANY_CANDIDATES: CompanyCandidate[] = [
  ...greenhouseCandidates,
  ...leverCandidates,
  ...ashbyCandidates,
];
