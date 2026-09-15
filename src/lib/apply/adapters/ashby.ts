import type { Page, Locator } from "playwright";
import { bodyMentionsSubmitted, firstAlertText, type AtsAdapter } from "./types";

const ERROR_SELECTOR = "[role=alert], .error, [data-error]";

export const ashbyAdapter: AtsAdapter = {
  id: "ashby",
  maxTrustLevel: 4,

  async submitButtons(page: Page): Promise<Locator[]> {
    return page.locator("form button[type=submit], form input[type=submit]").all();
  },

  async detectSubmitted(page: Page): Promise<boolean> {
    // An error page can also contain the word "application", so an error being
    // visible disqualifies a success reading before the text is even checked.
    if ((await firstAlertText(page, ERROR_SELECTOR)) !== null) return false;
    return bodyMentionsSubmitted(page);
  },

  async detectError(page: Page): Promise<string | null> {
    return firstAlertText(page, ERROR_SELECTOR);
  },
};
