/**
 * Asking the candidate for the answers nobody has given this app yet.
 *
 * The question appears as a panel inside the browser window that is already
 * open on the form — not in a terminal. The person is looking at that window;
 * a prompt in a console they cannot see would be a prompt nobody answers, and
 * the button on the job page starts these runs with no terminal at all.
 *
 * Each answer is used twice: typed into the field now, and handed back to the
 * caller to store, so the next application that asks the same thing fills
 * itself. That is the loop — every form teaches it one more thing.
 *
 * WHY THE PANEL IS A STRING. It is injected with addScriptTag rather than
 * passed to page.evaluate as a function. This file is compiled by esbuild,
 * which renames-and-registers every named function through a `__name` helper;
 * that helper exists in the build, not in the employer's page, so a function
 * serialized into the browser dies on its first line with "__name is not
 * defined". Plain source text is not compiled, so it arrives intact.
 */

import type { Page } from "playwright";
import type { AskItem } from "./ask-plan";

/** What the person did with one question. */
export interface AskResult {
  question: string;
  /** Their answer, or null if they skipped it. */
  answer: string | null;
}

/** The name the injected panel calls back through. */
const CALLBACK = "__autopilotAnswer";

/** The panel, as browser source. See the note at the top of the file. */
const PANEL_SCRIPT = `
window.__autopilotRenderPanel = function (config) {
  var existing = document.getElementById("autopilot-ask");
  if (existing) existing.remove();

  var panel = document.createElement("div");
  panel.id = "autopilot-ask";
  panel.style.cssText = [
    "position:fixed", "right:16px", "bottom:16px", "z-index:2147483647",
    "width:380px", "max-width:calc(100vw - 32px)",
    "background:#0d1117", "color:#e6edf3",
    "border:1px solid #30363d", "border-radius:10px",
    "box-shadow:0 8px 32px rgba(0,0,0,.45)",
    "font:13px/1.5 'Segoe UI',system-ui,sans-serif", "padding:14px"
  ].join(";");

  var counter = document.createElement("div");
  counter.textContent = "Question " + config.position + " of " + config.total;
  counter.style.cssText = "font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9198a1;margin-bottom:6px";

  var question = document.createElement("div");
  question.textContent = config.question;
  question.style.cssText = "font-weight:600;margin-bottom:4px";

  var reason = document.createElement("div");
  reason.textContent = config.reason;
  reason.style.cssText = "font-size:12px;color:#9198a1;margin-bottom:10px";

  // A dropdown's answer has to be one of its own options, so offer those
  // rather than a text box that cannot be satisfied.
  var input;
  if (config.options && config.options.length > 0) {
    input = document.createElement("select");
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Choose...";
    input.appendChild(blank);
    for (var i = 0; i < config.options.length; i++) {
      var option = document.createElement("option");
      option.value = config.options[i];
      option.textContent = config.options[i];
      input.appendChild(option);
    }
  } else {
    input = document.createElement("input");
    input.type = "text";
  }
  input.style.cssText = "width:100%;padding:7px 9px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font:inherit;margin-bottom:10px";

  var buttons = document.createElement("div");
  buttons.style.cssText = "display:flex;gap:8px";

  var save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save and continue";
  save.style.cssText = "flex:1;padding:7px 10px;background:#1f6feb;color:#fff;border:none;border-radius:6px;font:inherit;font-weight:500;cursor:pointer";

  var skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "Skip";
  skip.style.cssText = "padding:7px 12px;background:transparent;color:#9198a1;border:1px solid #30363d;border-radius:6px;font:inherit;cursor:pointer";

  var note = document.createElement("div");
  note.textContent = "Saved for next time. Nothing is submitted.";
  note.style.cssText = "font-size:11px;color:#6e7681;margin-top:8px";

  buttons.appendChild(save);
  buttons.appendChild(skip);
  panel.appendChild(counter);
  panel.appendChild(question);
  panel.appendChild(reason);
  panel.appendChild(input);
  panel.appendChild(buttons);
  panel.appendChild(note);
  document.body.appendChild(panel);

  var send = function (value) {
    panel.remove();
    var callback = window[config.callback];
    if (callback) callback(value);
  };

  save.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    var value = String(input.value || "").trim();
    if (value.length === 0) return;
    send(value);
  });

  skip.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    send(null);
  });

  // Enter must not reach the page: on most forms that submits it.
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      save.click();
    }
  });

  input.focus();
};
`;

/**
 * Put the questions to the person, one at a time, inside the page.
 *
 * Resolves when every question has been answered or skipped, or when the
 * window is closed.
 */
export async function askInPage(
  page: Page,
  items: AskItem[],
  onAnswer: (item: AskItem, answer: string) => Promise<void>,
): Promise<AskResult[]> {
  if (items.length === 0) return [];

  const results: AskResult[] = [];

  // One callback for the whole run: registering it per question would throw on
  // the second one, since the name is already taken.
  let resolveCurrent: ((value: string | null) => void) | null = null;
  await page.exposeFunction(CALLBACK, (value: string | null) => {
    resolveCurrent?.(value);
    resolveCurrent = null;
  });
  await page.addScriptTag({ content: PANEL_SCRIPT });

  for (const [index, item] of items.entries()) {
    const answer = await new Promise<string | null>((resolve) => {
      resolveCurrent = resolve;

      // If the window is closed mid-question, stop waiting rather than hang.
      page.once("close", () => resolve(null));

      void page.evaluate(
        (config) => {
          const render = (
            window as unknown as Record<string, ((value: unknown) => void) | undefined>
          ).__autopilotRenderPanel;
          render?.(config);
        },
        {
          question: item.question,
          reason: item.reason,
          options: item.options,
          position: index + 1,
          total: items.length,
          callback: CALLBACK,
        },
      );
    });

    results.push({ question: item.question, answer });
    if (answer !== null) await onAnswer(item, answer);
  }

  await page
    .evaluate(() => document.getElementById("autopilot-ask")?.remove())
    .catch(() => undefined);

  return results;
}

/** The status banner, as browser source. Same reason as PANEL_SCRIPT above. */
const STATUS_SCRIPT = `
window.__autopilotStatus = function (message) {
  var existing = document.getElementById("autopilot-status");
  if (message === null) {
    if (existing) existing.remove();
    return;
  }
  var banner = existing || document.createElement("div");
  banner.id = "autopilot-status";
  banner.style.cssText = [
    "position:fixed", "right:16px", "bottom:16px", "z-index:2147483646",
    "width:380px", "max-width:calc(100vw - 32px)",
    "background:#0d1117", "color:#e6edf3",
    "border:1px solid #30363d", "border-radius:10px",
    "box-shadow:0 8px 32px rgba(0,0,0,.45)",
    "font:13px/1.5 'Segoe UI',system-ui,sans-serif", "padding:12px 14px"
  ].join(";");
  banner.textContent = message;
  if (!existing) document.body.appendChild(banner);
};
`;

/**
 * Show a one-line status in the page, or clear it with null.
 *
 * The person is looking at the browser window, not at a terminal — a run that
 * pauses for ninety seconds waiting on an email has to say so where they can
 * see it, or it just looks frozen.
 */
export async function showStatus(page: Page, message: string | null): Promise<void> {
  await page
    .evaluate(
      ([source, text]) => {
        const holder = window as unknown as Record<string, unknown>;
        if (typeof holder.__autopilotStatus !== "function") {
          // Injected by evaluating the source, not by addScriptTag: this can
          // be called after a navigation, when any previously added tag is
          // gone along with the old document.
          const install = new Function(source as string);
          install();
        }
        (holder.__autopilotStatus as (value: string | null) => void)(text as string | null);
      },
      [STATUS_SCRIPT, message] as const,
    )
    .catch(() => undefined);
}
