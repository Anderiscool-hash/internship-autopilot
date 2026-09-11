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
import {
  buildFillPlan,
  matchOptionForLabel,
  type FillProfile,
  type PlannedField,
} from "./fill-plan";
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
  /** Leave the browser open when done, so the human can check the result. */
  keepOpen?: boolean;
  /**
   * Hand the filled form over: keep the window open AND lift the submit guard
   * once filling has finished, so the person can review and submit themselves.
   *
   * The guarantee this file makes is that **the bot** never submits, and that
   * survives: the guard is only lifted after every field has been filled, at
   * which point nothing automated is driving the page any more. A POST after
   * that is a human pressing a button in a window they are looking at. Leaving
   * the guard on instead would mean the person has to re-fill the whole form
   * somewhere else to apply, which is how a safety measure ends up being
   * switched off wholesale.
   */
  handoff?: boolean;
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
        isCombobox: field.isCombobox,
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

    if (options.handoff) {
      // Filling is done, so the bot stops driving and the guard comes off.
      //
      // The promise this file makes is that *the bot* never submits, and that
      // survives: nothing automated touches the page after this line, so a
      // POST from here is a person pressing a button in a window they are
      // looking at. Keeping the guard on instead would mean re-filling the
      // whole form somewhere else in order to apply — which is how a safety
      // measure ends up being switched off wholesale.
      await context.unroute("**/*");
      console.log(
        "\n" +
          "─".repeat(70) +
          "\nThe form is filled and the browser is now yours.\n" +
          "The bot has stopped driving it and will not touch it again.\n" +
          "Check every field, attach your resume, then submit it yourself if you want to.\n" +
          "Close the window when you are done.\n" +
          "─".repeat(70),
      );
      await page.waitForEvent("close", { timeout: 0 }).catch(() => undefined);
    } else if (options.keepOpen) {
      console.log(
        "\nThe browser is left open so you can check the filled form.\n" +
          "Submission is still blocked in this window — run with --handoff to submit from it.\n" +
          "Close the window to finish.",
      );
      await page.waitForEvent("close", { timeout: 0 }).catch(() => undefined);
    }

    return result;
  } finally {
    const stayOpen = options.keepOpen || options.handoff;
    if (!stayOpen) await browser.close();
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
      // A combobox is not a text box. Greenhouse renders "Are you at least 18
      // years of age?" as role=combobox with a popup list, and typing into it
      // leaves the form's actual value unset — the text appears, and the field
      // submits empty. So the option has to be opened and clicked, and if none
      // matches, that is reported rather than left looking filled.
      if (field.isCombobox) {
        return await chooseFromCombobox(page, locator, field.label, action.value, source);
      }

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

/**
 * Open a combobox, click the matching option, and confirm it took.
 *
 * The confirmation is the point. Typing into these controls always "works" in
 * the sense that text appears; whether the form registered a choice is a
 * different question, and the only honest answer comes from reading the value
 * back afterwards.
 */
async function chooseFromCombobox(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  label: string,
  value: string,
  source: PlannedField["source"],
): Promise<FieldOutcome> {
  // Opening the control is what creates its menu, and what links the two via
  // an aria-controls id that only exists once it is open. Searching the whole
  // page for [role="option"] instead finds the phone widget's hidden list of
  // every country on earth, which is how an earlier version came to believe
  // "Andorra" answered a sponsorship question.
  await locator.click({ timeout: 5_000 });
  await page.waitForTimeout(350);

  const menuId = await locator.getAttribute("aria-controls");
  if (!menuId) {
    return { label, status: "failed", detail: "This control did not open a list.", source };
  }

  const readOptions = () =>
    page.evaluate((id) => {
      const menu = document.getElementById(id);
      return Array.from(
        menu?.querySelectorAll('[role="option"], [class*="select__option"]') ?? [],
      ).map((option) => (option.textContent ?? "").trim());
    }, menuId);

  // 1. Try the list as it opens. Short fixed lists — Yes/No, degree levels —
  //    are entirely present here, and this is where the degree mapping works.
  const initial = await readOptions();
  let chosen = initial.length > 0 ? matchOptionForLabel(value, initial, label) : null;

  // 2. Otherwise search. Long lists are filtered as you type and only render a
  //    slice of themselves: the university dropdown holds thousands and shows
  //    about a hundred, so reading the open menu for "John Jay College" finds
  //    nothing while sitting in the A's. The search term drops any parenthetical,
  //    which is the part a list is least likely to carry ("(CUNY)").
  const searchTerm = value.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  let filtered: string[] = [];

  if (chosen === null) {
    await locator.fill(searchTerm.slice(0, 60), { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    filtered = await readOptions();

    chosen = matchOptionForLabel(value, filtered, label);

    // 3. The site's own search narrowing to a single option that contains what
    //    was typed is a match, even when the wording differs: the profile says
    //    "John Jay College of Criminal Justice (CUNY)" and the list says
    //    "CUNY - John Jay College of Criminal Justice". One result means the
    //    page agrees there is no ambiguity.
    if (chosen === null && filtered.length === 1) {
      const only = filtered[0] as string;
      if (only.toLowerCase().includes(searchTerm.toLowerCase())) chosen = only;
    }
  }

  // 4. No list at all, before or after typing: a plain type-ahead, where what
  //    was typed is the answer.
  if (chosen === null && initial.length === 0 && filtered.length === 0) {
    const typed = (await locator.inputValue().catch(() => "")).trim();
    return {
      label,
      status: typed.length > 0 ? "filled" : "failed",
      detail: typed.length > 0 ? typed : "Typing into this control had no effect.",
      source,
    };
  }

  if (chosen === null) {
    // Leaving typed text behind would look filled and submit as nothing, which
    // is worse than an obviously empty field.
    const seen = filtered.length > 0 ? filtered : initial;
    await locator.fill("", { timeout: 5_000 }).catch(() => undefined);
    await page.keyboard.press("Escape").catch(() => undefined);
    return {
      label,
      status: "failed",
      detail:
        `Dropdown. Your answer ("${value.slice(0, 40)}") matched none of its ` +
        `${seen.length} options` +
        (seen.length <= 8 ? `: ${seen.join(", ")}` : `, e.g. ${seen.slice(0, 6).join(", ")}...`),
      source,
    };
  }

  await page
    .locator(`#${cssEscape(menuId)} [role="option"], #${cssEscape(menuId)} [class*="select__option"]`)
    .filter({ hasText: new RegExp(`^${escapeRegExp(chosen)}$`, "i") })
    .first()
    .click({ timeout: 5_000 });

  // Read it back. Text appearing is not the same as the form holding a value,
  // and only the read-back can tell the difference.
  const settled = (await locator.inputValue().catch(() => "")).trim();
  const shown = settled.length > 0 ? settled : await selectedText(page, locator);

  return {
    label,
    status: shown.length > 0 ? "filled" : "failed",
    detail: shown.length > 0 ? shown : `Clicked "${chosen}" but the field did not register it.`,
    source,
  };
}

/**
 * What a combobox displays once an option is chosen.
 *
 * react-select clears its text input and renders the choice in a sibling
 * element, so reading the input's value alone reports an empty field for one
 * that is correctly filled.
 */
async function selectedText(
  page: Page,
  locator: ReturnType<Page["locator"]>,
): Promise<string> {
  return locator
    .evaluate((element) => {
      const container = element.closest('[class*="select__control"]')?.parentElement;
      const value = container?.querySelector('[class*="select__single-value"]');
      return (value?.textContent ?? "").trim();
    })
    .catch(() => "");
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
