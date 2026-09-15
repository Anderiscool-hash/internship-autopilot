import type { Page, Locator } from "playwright";
import { firstAlertText, type AtsAdapter } from "./types";

/**
 * The adapter for an ATS nobody has written one for.
 *
 * It can find a submit button well enough to fill and review, but it is capped
 * at trust level 2 and is never eligible to submit. The reason is not caution
 * for its own sake: on an unknown ATS we cannot recognise the confirmation
 * page, so after clicking we would be unable to tell a sent application from a
 * silently failed one — and "we think we applied" is worse than not applying.
 */
export const genericAdapter: AtsAdapter = {
  id: "generic",
  maxTrustLevel: 2,

  async submitButtons(page: Page): Promise<Locator[]> {
    return page.locator("form button[type=submit], form input[type=submit]").all();
  },

  async detectSubmitted(): Promise<boolean> {
    // Not "no" — "cannot know". Since this adapter can never submit, nothing
    // ever calls this in anger, and claiming true would be a lie.
    return false;
  },

  async detectError(page: Page): Promise<string | null> {
    return firstAlertText(page, "[role=alert], .error");
  },
};
