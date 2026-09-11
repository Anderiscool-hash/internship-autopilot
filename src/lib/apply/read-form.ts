/**
 * Reading an application form with a real browser.
 *
 * READ ONLY. This file opens a page, writes down what the form asks for, and
 * closes it. It does not type into anything, does not upload anything and does
 * not submit anything — there is no code here that could. Actually applying is
 * spec §22's Playwright workers, which are not built, and the decision to
 * build them is the user's rather than a natural next step of this file.
 *
 * Why a browser at all: modern ATS application forms are rendered by
 * JavaScript, so fetching the HTML gets you an empty shell. Playwright is the
 * only way to see the questions a human would see.
 */

import { chromium, type Browser, type Page } from "playwright";
import {
  classifyFieldLabel,
  cleanLabel,
  GENERIC_CONTROL_LABEL,
  humanizeIdentifier,
  looksRequired,
  type FieldKind,
} from "./classify-field";
import type { ParsedField, ParsedForm } from "./confidence";

/** How long to wait for a form to render before giving up. */
const TIMEOUT_MS = 30_000;

/** What was read off one application page, before any answers are matched in. */
export interface ReadFormResult extends Omit<ParsedForm, "fields"> {
  fields: (Omit<ParsedField, "answered"> & {
    kind: FieldKind;
    /** DOM id, when there is one — the preferred selector. */
    elementId: string;
    /** name attribute; the fallback selector and the radio-group key. */
    name: string;
    /** text | email | textarea | select | radio | checkbox | file | ... */
    inputType: string;
    /** Option labels, for selects and choice groups. */
    options: string[];
  })[];
  /** The URL actually landed on, after any redirects. */
  finalUrl: string;
}

/**
 * Open a job's application page and write down what it asks for.
 *
 * The caller owns the browser so that a preflight over many jobs pays the
 * startup cost once.
 */
/**
 * Read a form from a page that is already open.
 *
 * Split out so shadow mode can read and fill the same page: loading the
 * employer's form twice to do one application is both slower and slightly
 * rude, and it risks reading one render and filling a different one.
 */
export async function readOpenForm(page: Page, url: string): Promise<ReadFormResult> {
  const captcha = await hasCaptcha(page);
  const loginRequired = await hasLoginWall(page);
  const fields = await readFields(page);

  return {
    fields,
    unrecognizedFields: fields.filter((field) => field.kind === "unknown").length,
    captcha,
    loginRequired,
    resumeRequired: fields.some(
      (field) => field.kind === "file" && /resume|cv/i.test(field.label),
    ),
    coverLetterRequired: fields.some(
      (field) => field.kind === "file" && /cover.?letter/i.test(field.label),
    ),
    finalUrl: url,
  };
}

export async function readApplicationForm(
  browser: Browser,
  url: string,
): Promise<ReadFormResult> {
  const context = await browser.newContext({
    // A plain default context: no stored logins, no cookies carried between
    // jobs. Reading a public application page should look like a first visit,
    // because that is what it is.
    javaScriptEnabled: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    // Application forms are rendered after the initial HTML; give the network
    // a moment to settle rather than racing it.
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => undefined);

    const captcha = await hasCaptcha(page);
    const loginRequired = await hasLoginWall(page);
    const fields = await readFields(page);

    return {
      fields,
      unrecognizedFields: fields.filter((field) => field.kind === "unknown").length,
      captcha,
      loginRequired,
      // Presence of the upload, not the HTML `required` flag. ATS forms
      // routinely leave a resume field unmarked (Greenhouse does) while every
      // human reader understands it is expected — so reading the flag would
      // report "resume required? No" on a form that plainly wants one. A
      // resume field that exists is one you need something to put in.
      resumeRequired: fields.some(
        (field) => field.kind === "file" && /resume|cv/i.test(field.label),
      ),
      coverLetterRequired: fields.some(
        (field) => field.kind === "file" && /cover.?letter/i.test(field.label),
      ),
      finalUrl: page.url(),
    };
  } finally {
    await context.close();
  }
}

/**
 * Is there a CAPTCHA on this page?
 *
 * Detected, never solved. Spec §22 is explicit that a CAPTCHA pauses the
 * workflow for the user, and working around one would mean defeating a control
 * the employer deliberately put there.
 */
async function hasCaptcha(page: Page): Promise<boolean> {
  const selectors = [
    "iframe[src*='recaptcha']",
    "iframe[src*='hcaptcha']",
    ".g-recaptcha",
    "[data-sitekey]",
    "iframe[title*='challenge' i]",
  ];
  for (const selector of selectors) {
    if ((await page.locator(selector).count()) > 0) return true;
  }
  return false;
}

/** Does the page demand a login before the form can be seen? */
async function hasLoginWall(page: Page): Promise<boolean> {
  const passwordFields = await page.locator("input[type='password']").count();
  if (passwordFields > 0) return true;

  const text = (await page.textContent("body").catch(() => "")) ?? "";
  return /\b(sign in to (apply|continue)|log in to (apply|continue)|create an account to apply)\b/i.test(
    text,
  );
}

/**
 * Enumerate the form's fields.
 *
 * Labels are found the way a screen reader would: an explicit `<label for>`, an
 * aria-label, or the nearest preceding label element. Fields with no findable
 * label still get recorded — as unknown — because a field we cannot describe
 * is exactly the thing that should hold back an automated submission.
 */
async function readFields(page: Page): Promise<ReadFormResult["fields"]> {
  const raw = await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll("input, textarea, select"),
    ) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];

    return inputs
      .filter((element) => {
        const type = (element as HTMLInputElement).type ?? "";
        // Hidden and structural inputs are not questions.
        if (type === "hidden" || type === "submit" || type === "button") return false;

        // An input with neither a name nor an id is not submitted with the
        // form at all — browsers only serialize named controls. On Greenhouse
        // these are the search boxes inside each dropdown widget. Counting
        // them as questions inflated the field count by 21 on one real form
        // and dragged the parse score down with fields nobody could answer.
        const name = (element as HTMLInputElement).name ?? "";
        if (name.length === 0 && element.id.length === 0) return false;

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => {
        const id = element.id;
        const explicit = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
          : null;
        const wrapping = element.closest("label");
        const aria = element.getAttribute("aria-label");
        // A yes/no question is a fieldset whose legend holds the question and
        // whose radio inputs are the answers. Without this, every such
        // question reads as two unlabelled fields.
        const legend = element.closest("fieldset")?.querySelector("legend");
        const describedBy = element.getAttribute("aria-describedby");
        const described = describedBy
          ? document.getElementById(describedBy)
          : null;

        const isChoice =
          (element as HTMLInputElement).type === "radio" ||
          (element as HTMLInputElement).type === "checkbox";

        // Button text a file input sits next to: "Attach", "Upload". These are
        // controls, not the name of what is being asked for, so a label that
        // is only one of these gets replaced by the surrounding field's label.
        const GENERIC = /^(attach|upload|choose file|browse|select file)$/i;

        // The nearest ancestor label/legend text, for controls with no label
        // of their own. Written as a loop rather than a helper function
        // because this code is serialized into the browser, where a bundler's
        // function-name helper would not exist.
        let ancestorLabel = "";
        let node: HTMLElement | null = element.parentElement;
        for (let depth = 0; node && depth < 5 && ancestorLabel === ""; depth += 1) {
          const candidate = node.querySelector("legend, label");
          const text = candidate?.textContent?.trim() ?? "";
          if (text.length > 0 && !GENERIC.test(text)) ancestorLabel = text;
          node = node.parentElement;
        }

        // For a radio or checkbox, the question is the group's label; the
        // input's own label is just the option text ("Yes").
        const labelText = isChoice
          ? (legend?.textContent ??
            described?.textContent ??
            aria ??
            explicit?.textContent ??
            wrapping?.textContent ??
            "")
          : (explicit?.textContent ??
            aria ??
            legend?.textContent ??
            wrapping?.textContent ??
            element.getAttribute("placeholder") ??
            element.getAttribute("name") ??
            "");

        const resolved =
          labelText.trim().length === 0 || GENERIC.test(labelText.trim())
            ? ancestorLabel || labelText
            : labelText;

        // Option labels: a select's own options, or the labels of every radio
        // sharing this control's name. Without them, a yes/no question cannot
        // be answered — and those are most of the legal questions.
        let options: string[] = [];
        if (element.tagName.toLowerCase() === "select") {
          options = Array.from((element as HTMLSelectElement).options)
            .map((option) => (option.textContent ?? "").trim())
            .filter((text) => text.length > 0);
        } else if (isChoice && (element as HTMLInputElement).name) {
          const groupSelector = `input[name="${CSS.escape((element as HTMLInputElement).name)}"]`;
          options = Array.from(document.querySelectorAll(groupSelector))
            .map((radio) => {
              const own = radio.id
                ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)
                : null;
              const wrapping = radio.closest("label");
              return (own?.textContent ?? wrapping?.textContent ?? radio.getAttribute("value") ?? "").trim();
            })
            .filter((text) => text.length > 0);
        }

        return {
          rawLabel: resolved,
          elementId: element.id ?? "",
          options,
          groupName: (element as HTMLInputElement).name ?? "",
          isChoice,
          inputType:
            element.tagName.toLowerCase() === "textarea"
              ? "textarea"
              : element.tagName.toLowerCase() === "select"
                ? "select"
                : ((element as HTMLInputElement).type ?? "text"),
          ariaRequired: element.getAttribute("aria-required"),
          htmlRequired: (element as HTMLInputElement).required === true,
        };
      });
  });

  // Collapse choice groups: the four radio buttons under one question are one
  // question, not four fields. Counting them separately inflated the field
  // count and dragged the parse score down with fields that were never
  // separate questions.
  const seenGroups = new Set<string>();

  return raw
    .filter((field) => {
      if (!field.isChoice || field.groupName.length === 0) return true;
      if (seenGroups.has(field.groupName)) return false;
      seenGroups.add(field.groupName);
      return true;
    })
    .map((field) => {
      const cleaned = cleanLabel(field.rawLabel);
      // Fall back to the control's own id when the visible text names the
      // control rather than the question — "Attach" on an input whose id is
      // "resume".
      const label =
        cleaned.length === 0 || GENERIC_CONTROL_LABEL.test(cleaned)
          ? humanizeIdentifier(field.elementId) || cleaned
          : cleaned;
      return {
        label: label.length > 0 ? label : "(unlabelled field)",
        kind: classifyFieldLabel(label, field.inputType),
        required:
          field.htmlRequired || looksRequired(field.rawLabel, field.ariaRequired),
        elementId: field.elementId,
        name: field.groupName,
        inputType: field.inputType,
        options: field.options,
      };
    });
}

/** Start a browser for a preflight run. Headless: nothing is shown, nothing is typed. */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}
