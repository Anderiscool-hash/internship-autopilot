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
import { isVerificationField } from "../email/detect-field";
import { InboxError, waitForVerification, type InboxConfig, type VerificationResult } from "../email/inbox";
import type { AskItem } from "./ask-plan";

/** What the person did with one question. */
export interface AskResult {
  question: string;
  /** Their answer, or null if they skipped it. */
  answer: string | null;
}

/** The name the injected panel calls back through. */
const CALLBACK = "__autopilotAnswer";

/** The name the injected panel calls to check the mailbox on demand. */
const MAIL_CHECK_CALLBACK = "__autopilotCheckMail";

/**
 * What the panel needs in order to offer the "check my email" button.
 *
 * Supplying this is what turns the button on at all — see
 * `shouldOfferMailButton`. Nothing here is a long poll: each press is one
 * mailbox check, bounded by `checkTimeoutMs`, because the button has to give
 * control back to the person quickly whether or not mail has arrived yet.
 */
export interface MailboxCheck {
  config: InboxConfig;
  since: Date;
  fromDomain?: string;
  /** How long one press is willing to wait for the mailbox to answer. */
  checkTimeoutMs?: number;
}

/** What one on-demand mailbox check found, in a shape the page can render. */
export type MailCheckOutcome =
  | { status: "found"; value: string; subject: string; from: string }
  | { status: "link"; value: string }
  | { status: "empty" }
  | { status: "error"; message: string };

/**
 * Should this field's question offer the "check my email" button?
 *
 * Pure and narrow on purpose, same reasoning as `isVerificationField` itself:
 * the button only belongs on a field that is actually waiting on an emailed
 * code, and only when a mailbox was ever configured to look in. Without the
 * second half of that, every plain "type your answer" field would grow a
 * button that calls a mailbox nothing wired up — the point of an opt-in
 * feature is that leaving it unconfigured leaves the panel exactly as it was.
 */
export function shouldOfferMailButton(fieldLabel: string, mailboxConfigured: boolean): boolean {
  return mailboxConfigured && isVerificationField(fieldLabel);
}

/**
 * Turn what a mailbox check found (or threw) into what the panel shows.
 *
 * Pure — no I/O, no Playwright, so this is testable without a real mailbox.
 * Mirrors the three-way branch `resolveVerificationFields` in shadow.ts makes
 * for the up-front CLI poll: null is "nothing yet", a link is not a code and
 * must not be auto-filled, and a thrown error is reported rather than left to
 * look like silence.
 */
export function classifyMailCheck(found: VerificationResult | null, error?: unknown): MailCheckOutcome {
  if (error !== undefined) {
    const message = error instanceof InboxError ? error.message : String(error);
    return { status: "error", message };
  }
  if (found === null) return { status: "empty" };
  if (found.kind === "link") return { status: "link", value: found.value };
  return { status: "found", value: found.value, subject: found.subject, from: found.from };
}

/**
 * Do one on-demand mailbox check and classify the result.
 *
 * `timeoutMs === pollMs` below is what makes this a single check rather than
 * a poll loop: `waitForVerification` runs one pass, sees no time left, and
 * returns — instead of sitting on the connection for up to two minutes the
 * way the up-front CLI poll does. A button the person just pressed has to let
 * go quickly, win or lose; they can press it again once the portal has sent
 * a code, whereas a long-blocking button reads as broken.
 */
async function checkMailboxOnce(mailbox: MailboxCheck): Promise<MailCheckOutcome> {
  const timeoutMs = mailbox.checkTimeoutMs ?? 8_000;
  try {
    const found = await waitForVerification({
      config: mailbox.config,
      since: mailbox.since,
      fromDomain: mailbox.fromDomain,
      timeoutMs,
      pollMs: timeoutMs,
    });
    return classifyMailCheck(found);
  } catch (error) {
    return classifyMailCheck(null, error);
  }
}

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

  // Only present when the field is waiting on an emailed code AND a mailbox
  // was configured for this run. See shouldOfferMailButton — this mirrors
  // that same condition on the browser side, config.mailButton is computed
  // there and just handed over as a flag.
  var mailArea = null;
  if (config.mailButton) {
    mailArea = document.createElement("div");
    mailArea.style.cssText = "margin-bottom:10px";

    var mailButton = document.createElement("button");
    mailButton.type = "button";
    // A stable id, not just text, is what makes this button reliably
    // addressable: its own label changes to "Checking your email..." while a
    // check is in flight, which is exactly the state anything watching it is
    // usually most interested in.
    mailButton.id = "autopilot-mail-check";
    mailButton.textContent = "Check my email for the code";
    mailButton.style.cssText = "width:100%;padding:7px 10px;background:#238636;color:#fff;border:none;border-radius:6px;font:inherit;font-weight:500;cursor:pointer;margin-bottom:6px";

    var mailStatus = document.createElement("div");
    mailStatus.style.cssText = "font-size:12px;color:#9198a1";
    mailStatus.textContent = 'Press "send code" on the form first, then press this.';

    var resetMailButton = function () {
      mailButton.disabled = false;
      mailButton.textContent = "Check my email for the code";
    };

    mailButton.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();

      // Disabled and relabelled for the duration of the check, so a person
      // who does not see anything happen right away cannot fire off five
      // overlapping mailbox connections by pressing it again.
      mailButton.disabled = true;
      mailButton.textContent = "Checking your email...";
      mailStatus.textContent = "";

      var callback = window[config.mailCallback];
      if (!callback) {
        resetMailButton();
        mailStatus.textContent = "Mailbox check is not available.";
        return;
      }

      callback().then(function (outcome) {
        if (outcome.status === "found") {
          input.value = outcome.value;
          mailStatus.textContent = "Code received: " + outcome.value;
          // The whole point of the button is that the person does not have
          // to also click Save — the code just found is the answer.
          send(outcome.value, "email");
          return;
        }
        if (outcome.status === "link") {
          mailStatus.textContent =
            "A confirmation link arrived instead of a code — open it yourself: " + outcome.value;
        } else if (outcome.status === "error") {
          mailStatus.textContent = "Could not check your mailbox: " + outcome.message;
        } else {
          mailStatus.textContent =
            'No mail has arrived yet. Press "send code" on the form, then try again.';
        }
        resetMailButton();
      }).catch(function () {
        mailStatus.textContent = "Could not check your mailbox.";
        resetMailButton();
      });
    });

    mailArea.appendChild(mailButton);
    mailArea.appendChild(mailStatus);
  }

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
  if (mailArea) panel.appendChild(mailArea);
  panel.appendChild(buttons);
  panel.appendChild(note);
  document.body.appendChild(panel);

  // The source argument distinguishes a code the mailbox handed over from one
  // the person typed. The two must not be treated alike on the Node side: a
  // typed answer is worth remembering for the next application, a one-time
  // emailed code is not and would just be a stale code on a future form.
  var send = function (value, source) {
    panel.remove();
    var callback = window[config.callback];
    if (callback) callback(value, source || "typed");
  };

  save.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    var value = String(input.value || "").trim();
    if (value.length === 0) return;
    send(value, "typed");
  });

  skip.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    send(null, "typed");
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
 *
 * `mailbox`, when supplied, is what turns on the "check my email" button for
 * whichever question is a verification field (see `shouldOfferMailButton`).
 * Omitting it leaves the panel exactly as it behaved before this button
 * existed — requirement 1 of the feature this argument was added for.
 */
export async function askInPage(
  page: Page,
  items: AskItem[],
  onAnswer: (item: AskItem, answer: string, source: "typed" | "email") => Promise<void>,
  mailbox?: MailboxCheck,
): Promise<AskResult[]> {
  if (items.length === 0) return [];

  const results: AskResult[] = [];

  // One callback for the whole run: registering it per question would throw on
  // the second one, since the name is already taken.
  let resolveCurrent: ((value: string | null, source: "typed" | "email") => void) | null = null;
  await page.exposeFunction(CALLBACK, (value: string | null, source?: string) => {
    resolveCurrent?.(value, source === "email" ? "email" : "typed");
    resolveCurrent = null;
  });

  // Only registered when a mailbox was actually configured. An unconfigured
  // run never exposes this function, so `window[config.mailCallback]` in the
  // panel is simply undefined and the button branch never renders for it —
  // belt and braces alongside `shouldOfferMailButton` deciding not to ask
  // for a button in the first place.
  if (mailbox) {
    await page.exposeFunction(MAIL_CHECK_CALLBACK, () => checkMailboxOnce(mailbox));
  }

  await page.addScriptTag({ content: PANEL_SCRIPT });

  for (const [index, item] of items.entries()) {
    let source: "typed" | "email" = "typed";
    const answer = await new Promise<string | null>((resolve) => {
      resolveCurrent = (value, resolvedSource) => {
        source = resolvedSource;
        resolve(value);
      };

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
          mailButton: shouldOfferMailButton(item.field.label, mailbox !== undefined),
          mailCallback: MAIL_CHECK_CALLBACK,
        },
      );
    });

    results.push({ question: item.question, answer });
    if (answer !== null) await onAnswer(item, answer, source);
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
