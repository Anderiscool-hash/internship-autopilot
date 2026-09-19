/**
 * The Hunter key, and nothing else.
 *
 * Hunter is the optional paid half of a hybrid design: the free path — MX
 * lookup, name permutation, Gravatar, bounce feedback and a learned
 * per-domain pattern — is the default AND the fallback, never a degraded mode
 * that has to be opted into (design §1). A key here buys a verified address
 * and the domain's known pattern when Hunter has them; without one the
 * feature works, just less certainly.
 *
 * The key lives in .env like every other secret in this project, written by
 * the settings screen through writeEnvVars, never in Postgres, and never read
 * back to the browser.
 *
 * OutreachVar is a separate union from MailboxVar on purpose. Two settings
 * screens write to the same .env file, and neither should be able to express
 * the other's variables: this file's writeOutreachVars cannot name IMAP_*,
 * and the mailbox screen's values cannot name HUNTER_API_KEY.
 */

import { writeEnvVars } from "../email/env-file";

/** The variables the outreach screen owns. Nothing else in .env is touched. */
export type OutreachVar = "HUNTER_API_KEY";

/**
 * Set the outreach variables, leaving the rest of .env exactly as it was.
 *
 * A thin wrapper over writeEnvVars rather than a second implementation: that
 * function's in-place rewrite is the only code in this project that edits the
 * file holding DATABASE_URL, and a second copy of it is a second chance to
 * get it wrong. Note the explicit `path` pass-through — writeEnvVars throws
 * when NODE_ENV is "test" and the path is the real .env, and a test that
 * calls this must supply a temporary file (see env-file.ts:46-50 for the
 * incident that guard exists because of).
 */
export function writeOutreachVars(
  values: Partial<Record<OutreachVar, string>>,
  path?: string,
): void {
  if (path === undefined) writeEnvVars(values);
  else writeEnvVars(values, path);
}

/**
 * What the settings screen is allowed to know about the stored key.
 *
 * One boolean, and deliberately nothing else. mailboxStatus can return a host
 * and an address because those are not secrets; an API key has no non-secret
 * part, so there is nothing here to return but whether one exists. No masked
 * preview, no first four characters, no length — each of those is a real
 * clue, and all of them end up in the page source, the browser history and
 * every screenshot.
 */
export interface HunterStatus {
  configured: boolean;
}

export function hunterStatus(
  env: Record<string, string | undefined> = process.env,
): HunterStatus {
  const key = env.HUNTER_API_KEY?.trim();
  // .env.example ships HUNTER_API_KEY="" (line 37). An empty string means the
  // placeholder is still there, which is not a configured key.
  return { configured: Boolean(key && key.length > 0) };
}
