/**
 * Shadow Mode (spec §20): do the whole application except the last step.
 *
 * Opens the real form in a visible browser, fills everything it has a stored
 * answer for, screenshots the result, and stops. The candidate looks at the
 * screenshot and says whether the fields are right — which is both the safety
 * check and the reliability data spec §21 wants before any adapter is trusted
 * further.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SUBMIT GUARD
 *
 * "We simply never wrote a click" is not a guarantee; it is an absence. A
 * stray Enter keypress in a text input submits most forms, and an adapter
 * edited six months from now could add a click without anyone remembering why
 * that was forbidden.
 *
 * So submission is blocked at the network layer: while this code drives the
 * page, every request that is not a GET is aborted before it leaves. An
 * application cannot be submitted without a POST. If something in here ever
 * tries, the attempt fails and is recorded — the run reports it rather than
 * the employer receiving it.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { chromium, type Browser, type Page } from "playwright";
import type { AnswerEntry } from "../answers/match";
import { buildFillPlan, type FillProfile, type PlannedField } from "./fill-plan";
import { readOpenForm } from "./read-form";

/** What happened to one field when the plan met the real page. */
export interface FieldOutcome {
  label: string;
  /** filled | chosen | skipped | failed */
  status: "filled" | "chosen" | "skipped" | "failed";
  /** The value entered, or the reason nothing was. */
  detail: string;
  source: PlannedField["source"];
}

export interface ShadowRunResult {
  url: string;
  outcomes: FieldOutcome[];
  /** Required fields still empty when the run finished. */
  blockingGaps: string[];
  /** Absolute path to the screenshot of the filled form. */
  screenshotPath: string;
  captcha: boolean;
  loginRequired: boolean;
  /**
   * Non-GET requests the guard refused that were aimed at the form's own host.
   * A submission has to be one of these, so this is the list that matters.
   * It should always be empty.
   */
  blockedSubmissions: string[];
  /**
   * Everything else the guard refused — analytics beacons, ad pixels, session
   * replay. A real ATS page fires a dozen of these and none of them is an
   * application. Counted rather than listed, because reporting them as
   * "something tried to submit" would cry wolf on every single run and teach
   * the reader to ignore the warning that matters.
   */
  blockedTrackers: number;
}

/**
 * Fill a job's application form without submitting it.
 *
 * `headless: false` on purpose — the point of shadow mode is that a person
 * watches it work and can see the finished form, not just a screenshot of it.
 */
export async function runShadowApply(options: {
  url: string;
  profile: FillProfile;
  answers: AnswerEntry[];
  screenshotPath: string;
  /** Leave the browser open when done, so the human can check and submit. */
  keepOpen?: boolean;
}): Promise<ShadowRunResult> {
  const browser: Browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const blockedSubmissions: string[] = [];
  let blockedTrackers = 0;
  const formHost = new URL(options.url).host;

  // The guard. Installed before the first navigation and never lifted while
  // this function drives the page.
  await context.route("**/*", async (route, request) => {
    if (request.method() === "GET") return route.continue();

    // Same host as the form: this is the shape a submission takes, and it is
    // the one worth reporting loudly. Everything else is third-party noise.
    const sameHost = safeHost(request.url()) === formHost;
    if (sameHost) blockedSubmissions.push(`${request.method()} ${request.url()}`);
    else blockedTrackers += 1;

    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();

  try {
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

    // Read the page that is already open, with the same reader preflight uses,
    // so what shadow mode fills and what preflight scored are the same
    // understanding of the same render.
    const form = await readOpenForm(page, options.url);

    const plan = buildFillPlan(
      form.fields.map((field) => ({
        label: field.label,
        kind: field.kind,
        required: field.required,
        elementId: field.elementId,
        name: field.name,
        inputType: field.inputType,
        options: field.options,
      })),
      options.profile,
      options.answers,
    );

    const outcomes: FieldOutcome[] = [];
    for (const item of plan.planned) {
      outcomes.push(await applyOne(page, item));
    }

    await page.screenshot({ path: options.screenshotPath, fullPage: true });

    const result: ShadowRunResult = {
      url: options.url,
      outcomes,
      blockingGaps: plan.blockingGaps,
      screenshotPath: options.screenshotPath,
      captcha: form.captcha,
      loginRequired: form.loginRequired,
      blockedSubmissions,
      blockedTrackers,
    };

    if (options.keepOpen) {
      // Hand the browser over. The guard stays on: if the person wants to
      // submit, they can do it in their own browser, where nothing this code
      // wrote is in the way. Lifting the guard here would mean shadow mode
      // ends with submission enabled, which is the one thing it promises not
      // to do.
      console.log(
        "\nThe browser is left open so you can check the filled form.\n" +
          "Submission is still blocked in this window — apply in your own browser when you are happy.\n" +
          "Close the window to finish.",
      );
      await page.waitForEvent("close", { timeout: 0 }).catch(() => undefined);
    }

    return result;
  } finally {
    if (!options.keepOpen) await browser.close();
    else await browser.close().catch(() => undefined);
  }
}

/** Carry out one planned action, and report what actually happened. */
async function applyOne(page: Page, item: PlannedField): Promise<FieldOutcome> {
  const { field, action, source } = item;

  if (action.type === "skip") {
    return { label: field.label, status: "skipped", detail: action.reason, source };
  }

  const locator = locatorFor(page, item);
  if (locator === null) {
    return {
      label: field.label,
      status: "failed",
      detail: "Could not find this control on the page to fill it.",
      source,
    };
  }

  try {
    if (action.type === "fill") {
      await locator.fill(action.value, { timeout: 5_000 });
      return { label: field.label, status: "filled", detail: action.value, source };
    }

    if (action.type === "select") {
      await locator.selectOption({ label: action.option }, { timeout: 5_000 });
      return { label: field.label, status: "chosen", detail: action.option, source };
    }

    // A choice group: click the option whose visible label matches the stored
    // answer. Addressed by label rather than by index, because option order is
    // not stable across postings on the same ATS.
    const byLabel = page.getByLabel(action.option, { exact: false }).first();
    await byLabel.check({ timeout: 5_000 });
    return { label: field.label, status: "chosen", detail: action.option, source };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { label: field.label, status: "failed", detail: message ?? "unknown error", source };
  }
}

/** Address a control by id, then by name. */
function locatorFor(page: Page, item: PlannedField) {
  if (item.field.elementId.length > 0) {
    return page.locator(`#${cssEscape(item.field.elementId)}`).first();
  }
  if (item.field.name.length > 0) {
    return page.locator(`[name="${cssEscape(item.field.name)}"]`).first();
  }
  return null;
}

/** The host of a URL, or an empty string if it will not parse. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Minimal CSS identifier escaping for ids and names taken from a page. */
function cssEscape(value: string): string {
  return value.replace(/["\\\]\[]/g, "\\$&");
}
