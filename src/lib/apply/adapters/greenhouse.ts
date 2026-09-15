import type { Page, Locator } from "playwright";
import { bodyMentionsSubmitted, firstAlertText, type AtsAdapter } from "./types";

const ERROR_SELECTOR = "[role=alert], .error, .field_with_errors";

export const greenhouseAdapter: AtsAdapter = {
  id: "greenhouse",
  maxTrustLevel: 4,

  async submitButtons(page: Page): Promise<Locator[]> {
    return page
      .locator(
        "#submit_app, form#application_form input[type=submit], " +
          "form#application_form button[type=submit]",
      )
      .all();
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
