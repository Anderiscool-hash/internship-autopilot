/**
 * What an ATS adapter is responsible for (spec §22).
 *
 * Deliberately narrower than §22 describes. §22 lists a directory per ATS that
 * knows how to detect fields, fill text, select dropdowns, upload documents,
 * answer questions and validate — but all of that already exists in read-form,
 * classify-field, fill-plan and shadow.ts, is generic, and works across all
 * three ATSes. Rewriting working generic code into three near-identical copies
 * to satisfy a directory layout would be churn with real regression risk and no
 * behavioural gain.
 *
 * What is genuinely ATS-specific is narrower: finding the submit button,
 * recognising a successful submission, and recognising an error page.
 */

import type { Locator, Page } from "playwright";
import type { TrustLevel } from "../trust";

export interface AtsAdapter {
  id: string;

  /**
   * Every element that would submit this form.
   *
   * A list rather than a nullable single value because the submit gate has to
   * tell "none" from "several". Both mean the same thing operationally — the
   * page is not what this adapter thinks it is — but they are different bugs,
   * and the attempt row should say which.
   */
  submitButtons(page: Page): Promise<Locator[]>;

  /** Whether this page is the one an ATS shows after a successful submission. */
  detectSubmitted(page: Page): Promise<boolean>;

  /** The error the page is showing, or null. */
  detectError(page: Page): Promise<string | null>;

  /** The ceiling this adapter can reach regardless of evidence. */
  maxTrustLevel: TrustLevel;
}

/** Text an ATS confirmation page shows. Matched case-insensitively. */
export const SUBMITTED_MARKERS = [
  "application submitted",
  "thank you for applying",
  "we have received your application",
];

/** Shared body-text check, used by every adapter that can recognise success. */
export async function bodyMentionsSubmitted(page: Page): Promise<boolean> {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return SUBMITTED_MARKERS.some((marker) => text.includes(marker));
}

/** Shared first-alert reader. */
export async function firstAlertText(
  page: Page,
  selector: string,
): Promise<string | null> {
  const alert = page.locator(selector).first();
  if ((await alert.count()) === 0) return null;
  const text = (await alert.innerText().catch(() => "")).trim();
  return text.length > 0 ? text : null;
}
