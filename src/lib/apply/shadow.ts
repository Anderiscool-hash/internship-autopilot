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
 *
 * ONE EXCEPTION, AND WHAT IT DOES NOT COST
 *
 * Attaching a document is itself a network request: Greenhouse POSTs the file
 * to S3 the instant the input receives it. With that blocked, uploads fail
 * silently — a live run put the resume into the input, the page never rendered
 * it, and the field stayed empty while the run claimed otherwise.
 *
 * So while a document is being attached, a non-GET aimed at a host that is NOT
 * the form's is allowed through, and every one is listed in the result. A
 * request to the form's own host — the only shape a submission can take — is
 * refused whether that window is open or not. The exception can carry a file
 * to a storage bucket; it cannot submit an application.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import type { AnswerEntry } from "../answers/match";
import { describeKind, type DocumentKind } from "../documents/kind-for-field";
import { isVerificationField } from "../email/detect-field";
import { InboxError, waitForVerification, type InboxConfig } from "../email/inbox";
import {
  buildFillPlan,
  matchOptionForLabel,
  type FillProfile,
  type PlannedField,
} from "./fill-plan";
import { askInPage, showStatus } from "./ask-overlay";
import { questionsToAsk } from "./ask-plan";
import { readOpenForm } from "./read-form";
import type { FieldOutcome } from "./shadow-types";

export type { FieldOutcome } from "./shadow-types";

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
  /**
   * Non-GET requests allowed through while a document was being attached.
   *
   * Listed rather than counted: this is the one exception the guard makes, and
   * an exception nobody can see is one nobody can check. None of these can be
   * a submission — a submission goes to the form's own host, which is refused
   * whether the upload window is open or not.
   */
  allowedUploads: string[];
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
  /**
   * The candidate's saved documents, by kind. A file input gets the one its
   * label names; an empty map means every upload is left for the human.
   */
  documents?: Partial<
    Record<DocumentKind, { absolutePath: string; filename: string; mimeType?: string }>
  >;
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
  /**
   * Ask the person, in the browser, for the required fields nothing could
   * fill — then put their answers in and report them for storing.
   */
  ask?: boolean;
  /**
   * Called with each answer the person gives, so the caller can decide whether
   * it is worth keeping. The runner does not touch the database itself: what
   * gets stored about a candidate is a decision, not a side effect of filling
   * a form.
   */
  onAnswer?: (question: string, answer: string) => Promise<void>;
  /**
   * Fetch an emailed verification code from the candidate's mailbox instead of
   * making them go and find it.
   *
   * Omit it and nothing connects to any mailbox — the field is simply one more
   * question for the person, which is what it was before.
   */
  verification?: VerificationOptions;
  /**
   * A browser to borrow instead of launching one.
   *
   * The daemon keeps one warm between applications. It is never closed here —
   * only the run's own context is.
   */
  browser?: Browser;
  /**
   * Cookies from previous runs, as a Playwright storageState file path.
   *
   * Some portals — Workday especially — make you create an account before you
   * can see the form at all. Without this, every run starts logged out and the
   * form is a sign-in page.
   */
  storageState?: string;
  /** Where to write the session back to when the run finishes. */
  saveStateTo?: string;
}): Promise<ShadowRunResult> {
  // A browser lent by the daemon, or one launched just for this run. Lending
  // saves the ~400ms Chromium takes to start, and — more usefully — lets the
  // caller keep one warm between applications.
  const borrowed = options.browser ?? null;
  const browser: Browser = borrowed ?? (await chromium.launch({ headless: false }));

  // A fresh context per run either way, even when the browser is shared. The
  // submit guard is a context-level route handler, so a shared context would
  // mean one run's handoff lifting the guard out from under another's. Logins
  // survive through storageState below rather than through a shared context.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Cookies from previous runs, when the caller keeps them. This is what
    // lets a portal that made you sign in once stay signed in.
    storageState: options.storageState,
  });
  const blockedSubmissions: string[] = [];
  let blockedTrackers = 0;
  const formHost = new URL(options.url).host;

  /**
   * Open only while a document is being attached. See the note below.
   */
  let uploadWindow = false;
  const allowedUploads: string[] = [];

  // The guard. Installed before the first navigation and never lifted while
  // this function drives the page.
  await context.route("**/*", async (route, request) => {
    if (request.method() === "GET") return route.continue();

    // Same host as the form: this is the shape a submission takes, and it is
    // the one worth reporting loudly. Everything else is third-party noise.
    const sameHost = safeHost(request.url()) === formHost;

    // ── The upload window ───────────────────────────────────────────────
    // Attaching a file is itself a network request. Greenhouse POSTs the
    // document straight to S3 the moment the input receives it, and with that
    // POST blocked the attachment silently never completes — which is exactly
    // what a live run showed: the file went into the input, the page never
    // rendered it, and the resume field stayed empty.
    //
    // So during an attachment, and only then, a non-GET to a host that is NOT
    // the form's is allowed through and recorded.
    //
    // This does not weaken the promise the guard exists to keep. Submitting
    // an application is a request to the form's own host, and that stays
    // blocked unconditionally — in the window, out of it, always. What is
    // allowed here cannot submit anything; it can only carry a file to a
    // storage bucket. Every one that goes through is listed in the result, so
    // the exception is auditable rather than invisible.
    if (uploadWindow && !sameHost) {
      allowedUploads.push(`${request.method()} ${request.url()}`);
      return route.continue();
    }

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
      options.documents ?? {},
    );

    const outcomes: FieldOutcome[] = [];
    for (const item of plan.planned) {
      // The window is opened per attachment and closed immediately after, so
      // it is measured in seconds and covers one action rather than the run.
      const isAttachment = item.action.type === "attach";
      if (isAttachment) uploadWindow = true;
      try {
        outcomes.push(await applyOne(page, item));
      } finally {
        if (isAttachment) uploadWindow = false;
      }
    }

    // A field waiting on an emailed code, before the person is asked for
    // anything: if the mailbox can supply it, there is no question to put.
    if (options.verification) {
      await resolveVerificationFields(page, plan.planned, outcomes, options.verification);
    }

    // Everything the profile and the answer bank could cover is now in. What
    // is left is, by definition, something nobody has ever told this app — so
    // ask, fill it, and hand the answer back to be stored. The next form that
    // asks the same thing will not need to.
    if (options.ask) {
      const questions = questionsToAsk(
        plan.planned.map((item) => item.field),
        outcomes,
      );

      if (questions.length > 0) {
        console.log(
          `\n${questions.length} field${questions.length === 1 ? "" : "s"} need you. ` +
            "Answer them in the browser window — each answer is saved for future applications.",
        );
      }

      await askInPage(page, questions, async (item, answer) => {
        // Put it in the form straight away, using the same routine as the
        // automatic pass so a dropdown is still chosen rather than typed at.
        const filled = await applyOne(page, {
          field: item.field,
          action: { type: "fill", value: answer },
          source: "none",
        });

        // Replace the earlier "could not fill" with what actually happened.
        const index = outcomes.findIndex((outcome) => outcome.label === item.question);
        const recorded: FieldOutcome = { ...filled, source: "asked" };
        if (index >= 0) outcomes[index] = recorded;
        else outcomes.push(recorded);

        await options.onAnswer?.(item.question, answer);
      });
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
      allowedUploads,
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
    // Save the session before tearing anything down, so a portal that made the
    // person sign in does not make them do it again next time.
    if (options.saveStateTo) {
      await context
        .storageState({ path: options.saveStateTo })
        .catch(() => undefined);
    }

    if (borrowed) {
      // Not ours to close. Close the context so the window goes away and the
      // run's cookies do not leak into the next one, and leave the browser
      // warm for whoever lent it.
      await context.close().catch(() => undefined);
    } else {
      const stayOpen = options.keepOpen || options.handoff;
      if (!stayOpen) await browser.close();
      else await browser.close().catch(() => undefined);
    }
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

    if (action.type === "attach") {
      return await attachDocument(page, item, action);
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

/**
 * Attach a stored document to a file input, and confirm the page took it.
 *
 * Two things make this harder than it sounds.
 *
 * First, almost no modern ATS shows its real <input type="file">. Greenhouse,
 * Lever and Workday all hide it behind a styled "Attach" button, and a hidden
 * input fails Playwright's actionability check. So when the direct attempt
 * times out, the input is unhidden just long enough to receive the file.
 *
 * Second — and this is the part worth the code — the attachment is read back
 * from `input.files` afterwards. Setting files on a detached or replaced input
 * succeeds silently and attaches nothing, which would be reported as a filled
 * resume field on a form that has no resume on it. The same lesson the
 * comboboxes taught: whether the page registered it is a different question
 * from whether the call returned.
 */
async function attachDocument(
  page: Page,
  item: PlannedField,
  action: { path: string; filename: string; mimeType: string; kind: DocumentKind },
): Promise<FieldOutcome> {
  const { field, source } = item;
  const { path, filename, mimeType, kind } = action;
  const label = field.label;

  if (!existsSync(path)) {
    return {
      label,
      status: "failed",
      detail: `The saved ${describeKind(kind)} is missing from disk (${filename}). Upload it again on the profile screen.`,
      source,
    };
  }

  // Address the file input directly. locatorFor targets the labelled control,
  // which on these forms is often the styled button rather than the input.
  const input = fileInputFor(page, field);

  // Upload under the name the candidate gave it, not the name it has on disk.
  //
  // Files are stored content-addressed — "resume-0ed549af61853231.pdf" — which
  // is right for the folder and wrong for an employer: attaching the path
  // directly means a recruiter opens an attachment named after a hash. So the
  // bytes are read and handed over with the original filename.
  const upload = {
    name: filename,
    mimeType: mimeType || "application/octet-stream",
    buffer: readFileSync(path),
  };

  // Whether the page already said this filename before anything was attached.
  // Without this the fallback check below would call it a success on any form
  // that happens to mention the name — and a resume called "resume.pdf" on a
  // page with the words "resume.pdf" in its help text is not far-fetched.
  const filenameWasOnPage = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .then((text) => text.includes(filename))
    .catch(() => false);

  try {
    await input.setInputFiles(upload, { timeout: 5_000 });
  } catch {
    // Hidden behind a styled button. Reveal it, attach, and put it back — the
    // page's own styling is restored either way.
    const revealed = await input
      .evaluate((element: HTMLElement) => {
        const previous = element.getAttribute("style") ?? "";
        element.setAttribute(
          "style",
          `${previous};display:block!important;visibility:visible!important;opacity:1!important;width:1px;height:1px;position:fixed;left:0;top:0`,
        );
        return previous;
      })
      .catch(() => null);

    if (revealed === null) {
      return {
        label,
        status: "failed",
        detail: "Could not find the file input behind this upload button.",
        source,
      };
    }

    try {
      await input.setInputFiles(upload, { timeout: 5_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      return { label, status: "failed", detail: message ?? "unknown error", source };
    } finally {
      // Short timeout, because the element may well be gone: several ATS
      // platforms replace the input the moment it receives a file. Without
      // one this waits the full default thirty seconds to restore styling on
      // an element that no longer exists.
      await input
        .evaluate(
          (element: HTMLElement, style: string) => {
            if (style) element.setAttribute("style", style);
            else element.removeAttribute("style");
          },
          revealed,
          { timeout: 2_000 },
        )
        .catch(() => undefined);
    }
  }

  // Read it back. This is the check that matters — but it has to cope with
  // the page reacting to the upload, which the first version did not.
  //
  // On Greenhouse the input is REMOVED from the DOM the moment a file is
  // attached, and replaced by a chip showing the filename. Reading
  // `input.files` through the original handle then hangs until it times out
  // and reports nothing attached — on a form where the resume went in
  // perfectly. That false negative is worse than no check: it tells the
  // person to go and do something that is already done.
  //
  // So: ask the element if it is still there, and otherwise take the
  // filename appearing on the page as the evidence it went in. The "was it
  // there before" comparison is what keeps that second test honest.
  const attached = await page
    .evaluate(
      (selector) => {
        const element = document.querySelector(selector) as HTMLInputElement | null;
        if (!element) return null; // gone: the page swallowed it, see below
        return element.files?.[0]?.name ?? "";
      },
      fileSelectorFor(field),
    )
    .catch(() => null);

  if (typeof attached === "string" && attached.length > 0) {
    return { label, status: "attached", detail: `${attached} (${describeKind(kind)})`, source };
  }

  // The input is gone, or still empty. Either way the page's own text is the
  // remaining evidence: a filename that was not on the page before and is now
  // means the upload was accepted and rendered.
  //
  // Polled rather than read once. The chip showing the filename is rendered by
  // the page's own JavaScript in response to the change event, which has not
  // necessarily happened by the time setInputFiles returns — reading
  // immediately reported "the page did not take the resume" on a form that had
  // taken it perfectly well a few hundred milliseconds later.
  const showsFilename = !filenameWasOnPage && (await waitForText(page, filename, 5_000));

  if (showsFilename) {
    return {
      label,
      status: "attached",
      detail: `${filename} (${describeKind(kind)})`,
      source,
    };
  }

  return {
    label,
    status: "failed",
    detail: `The page did not take the ${describeKind(kind)} — attach ${filename} yourself.`,
    source,
  };
}

/** The CSS selector addressing a field's file input, for a fresh lookup. */
function fileSelectorFor(field: PlannedField["field"]): string {
  if (field.elementId) return `input[type="file"]#${cssEscape(field.elementId)}`;
  if (field.name) return `input[type="file"][name="${cssEscape(field.name)}"]`;
  return 'input[type="file"]';
}

/**
 * Find the real <input type="file"> for a labelled upload control.
 *
 * The label on these forms usually belongs to a button or a drop zone, not to
 * the input, so the input is looked up by id or name first and only then by
 * position within the labelled block.
 */
function fileInputFor(page: Page, field: PlannedField["field"]) {
  if (field.elementId) {
    const byId = page.locator(`input[type="file"]#${cssEscape(field.elementId)}`);
    return byId.first();
  }
  if (field.name) {
    return page.locator(`input[type="file"][name="${cssEscape(field.name)}"]`).first();
  }
  return page.locator('input[type="file"]').first();
}

/** What the runner needs in order to fetch a code from a mailbox. */
export interface VerificationOptions {
  config: InboxConfig;
  /** Only mail after this is read. Normally when the run started. */
  since: Date;
  /** Narrow the search to this sending domain when known. */
  fromDomain?: string;
  /** How long to wait for the mail before giving up and asking. */
  timeoutMs?: number;
}

/**
 * Fill any field that is waiting on an emailed code.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHEN THIS CAN AND CANNOT WORK — worth understanding before trusting it.
 *
 * A code only arrives because something asked the portal to send one, and
 * under the submit guard that something cannot be this code: requesting a code
 * is a POST, and every POST is blocked while the bot drives the page. So in a
 * plain shadow run the mail never comes and this times out, by design.
 *
 * Where it earns its place is `--handoff`: the person clicks "send me a code"
 * in the window themselves, and instead of switching to a mail client, reading
 * six digits and switching back, the code is already in the box when they look
 * at it.
 *
 * The alternative — lifting the guard so the bot could request the code — was
 * rejected. A guard with an exception in it is not a guard.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function resolveVerificationFields(
  page: Page,
  planned: PlannedField[],
  outcomes: FieldOutcome[],
  options: VerificationOptions,
): Promise<void> {
  const waiting = planned.filter(
    (item) =>
      isVerificationField(item.field.label) &&
      // Only one that is actually still empty. A code the profile somehow
      // filled is not a reason to open a mailbox.
      outcomes.find((outcome) => outcome.label === item.field.label)?.status === "skipped",
  );

  if (waiting.length === 0) return;

  for (const item of waiting) {
    await showStatus(
      page,
      `Waiting for the verification code in your email (up to ${Math.round(
        (options.timeoutMs ?? 120_000) / 1000,
      )}s)...`,
    );
    console.log(`\nWatching your mailbox for the code for "${item.field.label}".`);

    let found = null;
    try {
      found = await waitForVerification({
        config: options.config,
        since: options.since,
        fromDomain: options.fromDomain,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      // A mailbox that cannot be reached is reported and the person is asked
      // instead. It is not a reason to fail the run.
      const detail = error instanceof InboxError ? error.message : String(error);
      await showStatus(page, null);
      console.log(`  Could not read the mailbox: ${detail}`);
      record(outcomes, {
        label: item.field.label,
        status: "skipped",
        detail: `Mailbox unreachable, so the code was not fetched: ${detail}`,
        source: "none",
      });
      continue;
    }

    await showStatus(page, null);

    if (found === null) {
      console.log("  No verification mail arrived. You will be asked for the code instead.");
      record(outcomes, {
        label: item.field.label,
        status: "skipped",
        detail:
          "No verification email arrived. If the form has not sent one yet, request it in the window.",
        source: "none",
      });
      continue;
    }

    if (found.kind === "link") {
      // Not followed. Navigating away from a half-filled form loses everything
      // typed into it, and this run has just spent a minute filling it.
      console.log(`  The mail carried a confirmation link rather than a code: ${found.value}`);
      record(outcomes, {
        label: item.field.label,
        status: "skipped",
        detail: `A confirmation link arrived instead of a code — open it yourself: ${found.value}`,
        source: "none",
      });
      continue;
    }

    const filled = await applyOne(page, {
      field: item.field,
      action: { type: "fill", value: found.value },
      source: "none",
    });
    console.log(`  Code ${found.value} from "${found.subject}" (${found.from}).`);
    record(outcomes, { ...filled, source: "email" });
  }
}

/** Replace a field's earlier outcome, or add it when it had none. */
function record(outcomes: FieldOutcome[], outcome: FieldOutcome): void {
  const index = outcomes.findIndex((existing) => existing.label === outcome.label);
  if (index >= 0) outcomes[index] = outcome;
  else outcomes.push(outcome);
}

/**
 * Wait for a piece of text to appear anywhere on the page.
 *
 * Used to confirm an upload landed on forms that replace the file input with
 * a chip naming the file. The page renders that chip in its own time, so this
 * polls instead of reading once.
 */
async function waitForText(page: Page, needle: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await page
      .locator("body")
      .innerText({ timeout: 2_000 })
      .then((text) => text.includes(needle))
      .catch(() => false);

    if (found) return true;
    await page.waitForTimeout(250);
  }

  return false;
}
