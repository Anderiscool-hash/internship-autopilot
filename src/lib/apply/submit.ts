/**
 * The submit phase (spec §21-23).
 *
 * This module decides *whether* to submit and works out what happened. It
 * cannot lift the guard: the only thing it can do is call the openSubmitWindow
 * closure it is handed, which lives in shadow.ts and is scoped to the form's
 * own host and a deadline. That split is deliberate — the guard stays in the
 * file that documents it, and the routine that fills never becomes the routine
 * that submits.
 */

import type { AtsAdapter } from "./adapters";
import type { FilledHandle, ShadowRunResult } from "./shadow";
import type { TrustLevel } from "./trust";

export type GateName =
  | "blocking-gaps"
  | "captcha"
  | "login-wall"
  | "failed-fields"
  | "confidence"
  | "submit-button"
  | "authorization"
  | "trust-level";

export interface GateOutcome {
  gate: GateName;
  passed: boolean;
  detail: string;
}

/**
 * Who authorized this submission, and when.
 *
 * A value, never a boolean defaulting to true: "allowed" has to be something
 * somebody produced, attributable after the fact, and it is written to the
 * attempt row exactly as given.
 */
export interface Authorization {
  kind: "human-approval" | "auto-submit-opt-in";
  actor: string;
  at: Date;
  note?: string;
}

export interface GateInput {
  result: ShadowRunResult;
  confidence: number;
  minimumConfidence: number;
  submitButtonCount: number;
  authorization: Authorization | null;
}

export interface SubmitParams {
  adapter: AtsAdapter;
  authorization: Authorization | null;
  confidence: number;
  minimumConfidence: number;
  trustLevel: TrustLevel;
  /** How long the guard stays open. A real submit is an XHR plus a redirect. */
  windowMs: number;
  screenshotPath: string;
}

export interface SubmitOutcome {
  /** "submitted" | "refused" | "unconfirmed" | "error" */
  outcome: string;
  gates: GateOutcome[];
  refusedGate: GateName | null;
  requests: string[];
  adapterError: string | null;
  screenshotPath: string | null;
  adapterId: string;
}

/** How often detectSubmitted is asked whether the page has changed its mind. */
const POLL_INTERVAL_MS = 250;

/**
 * How long the click itself may take. Generous, and separate from the window's
 * deadline: this bounds the click's own actionability wait, not the submission,
 * and the submission's deadline is the window's.
 */
const CLICK_TIMEOUT_MS = 30_000;

/**
 * Every reason not to submit, all of them, in a fixed order.
 *
 * Nothing short-circuits. A refusal that reported only the first failing gate
 * would hand back one reason per retry, and the person fixing it would be
 * discovering the problems one at a time across several runs instead of seeing
 * the whole picture once.
 */
export async function evaluateGates(input: GateInput): Promise<GateOutcome[]> {
  const { result, confidence, minimumConfidence, submitButtonCount, authorization } = input;

  const gaps = result.blockingGaps;
  const blockingGaps: GateOutcome = {
    gate: "blocking-gaps",
    passed: gaps.length === 0,
    detail:
      gaps.length === 0
        ? "Every required field has a value."
        : `${gaps.length} required field(s) still empty: ${gaps.join(", ")}`,
  };

  const captcha: GateOutcome = {
    gate: "captcha",
    passed: !result.captcha,
    detail: result.captcha
      ? "The form is behind a CAPTCHA, which only a person can answer."
      : "No CAPTCHA on the form.",
  };

  const loginWall: GateOutcome = {
    gate: "login-wall",
    passed: !result.loginRequired,
    detail: result.loginRequired
      ? "The page is asking for a sign-in, so this is not the application form."
      : "No sign-in wall.",
  };

  // A failed field disqualifies even when the field was not required.
  //
  // The reason is not that the missing value matters — often it does not. It is
  // that a failure is a statement about the PAGE, not about that one field: the
  // filler believed it had entered something and the page did not do it. If the
  // page did not behave as read once, nothing here can claim to know what the
  // rest of the form currently holds, and submitting is a guess about a
  // document we have just been shown we misread.
  const failed = result.outcomes.filter((entry) => entry.status === "failed");
  const failedFields: GateOutcome = {
    gate: "failed-fields",
    passed: failed.length === 0,
    detail:
      failed.length === 0
        ? "Every field the plan touched did what was expected."
        : `${failed.length} field(s) did not behave as read: ` +
          failed.map((entry) => entry.label).join(", "),
  };

  const confidenceGate: GateOutcome = {
    gate: "confidence",
    passed: confidence >= minimumConfidence,
    // Both numbers, pass or fail. A bare "confidence too low" is unactionable,
    // and a bare "confidence fine" cannot be audited against a threshold that
    // may since have moved.
    detail: `Confidence ${confidence} against a minimum of ${minimumConfidence}.`,
  };

  // Zero and several are equally disqualifying. Neither is "closer to right":
  // both mean the page is not the page this adapter was written against. With
  // none there is nothing to click, and with several, clicking the first is a
  // guess about which one sends the application — "Save draft" and "Submit"
  // sit next to each other on plenty of forms.
  const submitButton: GateOutcome = {
    gate: "submit-button",
    passed: submitButtonCount === 1,
    detail:
      submitButtonCount === 1
        ? "Exactly one submit button, as the adapter expects."
        : `Found ${submitButtonCount} submit buttons — the page is not what the ` +
          "adapter expects, so which one sends the application is a guess.",
  };

  const authorizationGate: GateOutcome = {
    gate: "authorization",
    passed: authorization !== null,
    detail:
      authorization === null
        ? "Nobody authorized this submission."
        : `Authorized by ${authorization.actor} (${authorization.kind}) at ` +
          authorization.at.toISOString() +
          (authorization.note ? `: ${authorization.note}` : ""),
  };

  return [
    blockingGaps,
    captcha,
    loginWall,
    failedFields,
    confidenceGate,
    submitButton,
    authorizationGate,
  ];
}

/**
 * Decide whether to submit the filled form, do it if so, and report what
 * actually happened.
 */
export async function submitFilledApplication(
  handle: FilledHandle,
  params: SubmitParams,
): Promise<SubmitOutcome> {
  const adapterId = params.adapter.id;

  // Before anything else, and deliberately outside the seven-gate list: an
  // adapter that cannot recognise its own success page must not be allowed to
  // click even once.
  //
  // Not caution for its own sake. After clicking on such an ATS we could not
  // say afterwards whether an application went out — and "we think we applied"
  // is worse than not applying, because the candidate stops chasing a role
  // nobody ever heard from them about. The same reasoning caps the trust level
  // itself at 3 before a submission is allowed at all.
  if (params.adapter.maxTrustLevel < 3 || params.trustLevel < 3) {
    return {
      outcome: "refused",
      gates: [
        {
          gate: "trust-level",
          passed: false,
          detail:
            `Adapter "${adapterId}" is capped at trust level ${params.adapter.maxTrustLevel} ` +
            `and this ATS is at level ${params.trustLevel}; submitting needs 3. ` +
            "Below that, a click could not be confirmed afterwards.",
        },
      ],
      refusedGate: "trust-level",
      requests: [],
      adapterError: null,
      screenshotPath: null,
      adapterId,
    };
  }

  try {
    const buttons = await params.adapter.submitButtons(handle.page);

    // Evaluated here, immediately before the window opens, and never earlier.
    // A gate checked thirty seconds ago is a statement about a page that no
    // longer exists: forms re-render, validation errors appear, sessions
    // expire into login walls. The only reading worth acting on is the one
    // taken at the instant of the click.
    const gates = await evaluateGates({
      result: handle.result,
      confidence: params.confidence,
      minimumConfidence: params.minimumConfidence,
      submitButtonCount: buttons.length,
      authorization: params.authorization,
    });

    const refused = gates.find((entry) => !entry.passed);
    if (refused) {
      // Nothing is clicked. Not a shorter window, not a dry run — the window
      // is never opened at all, so the guard in shadow.ts refuses anything
      // that somehow gets as far as a request.
      return {
        outcome: "refused",
        gates,
        refusedGate: refused.gate,
        requests: [],
        adapterError: null,
        screenshotPath: null,
        adapterId,
      };
    }

    const button = buttons[0];
    if (!button) {
      // Unreachable while the submit-button gate passes, which requires
      // exactly one. Kept because noUncheckedIndexedAccess is right to insist:
      // a future edit to that gate must not silently turn into a crash here.
      return {
        outcome: "refused",
        gates,
        refusedGate: "submit-button",
        requests: [],
        adapterError: null,
        screenshotPath: null,
        adapterId,
      };
    }

    const window = await handle.openSubmitWindow(params.windowMs, async () => {
      // Started, deliberately not awaited to completion.
      //
      // Playwright's click waits for any navigation the click schedules to
      // finish, and a server that accepts the POST and then never answers
      // leaves that wait pending for as long as the request stays open. That
      // turns the one case this phase most has to report honestly — the
      // application probably went out and nobody can confirm it — into a click
      // timeout, i.e. an "error", which says the opposite of what happened.
      //
      // Whether the click's own navigation settled is not the signal acted on
      // here in any case. detectSubmitted is. A click that fails outright
      // simply means the page never reaches success and the attempt is
      // reported unconfirmed, with an empty request list showing nothing left
      // the browser.
      const clicking = button.click({ timeout: CLICK_TIMEOUT_MS });
      clicking.catch(() => undefined);

      // Polled, rather than awaiting a single navigation.
      //
      // "The submit is one navigation" is only true of the simplest forms.
      // Greenhouse POSTs by XHR and then rewrites the page in place; Lever
      // redirects twice; Ashby renders the confirmation into the same
      // document. Awaiting one navigation would time out on the first and
      // land on an intermediate page on the second. Asking the adapter
      // repeatedly "is this the success page yet?" is the one question that
      // means the same thing on all three.
      const deadline = Date.now() + params.windowMs;
      while (Date.now() < deadline) {
        const submitted = await askBeforeDeadline(
          params.adapter.detectSubmitted(handle.page).catch(() => false),
          deadline,
        );
        if (submitted) return true;
        if (Date.now() >= deadline) break;
        await handle.page.waitForTimeout(POLL_INTERVAL_MS).catch(() => undefined);
      }
      return false;
    });

    // The window has shut without a confirmation, so if the page is still
    // waiting on a response that never came, that request is stopped here —
    // BEFORE the page is read, not after.
    //
    // A submit POST an ATS accepts and never answers leaves a top-level
    // navigation pending in the browser, and almost everything Playwright does
    // to a page waits for that navigation first: a live run against a fixture
    // that swallows the POST spent ten seconds timing out on the screenshot and
    // another forty-seven inside the adapter's error read, on a two-second
    // window. Nothing is lost by stopping. This phase has already decided it
    // cannot confirm the submission, and the page that gets photographed is the
    // same page either way — the navigation never committed, so the form is
    // still what is on screen.
    if (!window.value) await stopPendingLoad(handle);

    const screenshot = await captureScreenshot(handle, params.screenshotPath);
    const adapterError = await params.adapter.detectError(handle.page).catch(() => null);

    // "unconfirmed" must NOT be recorded as "submitted".
    //
    // The POST may well have arrived; we simply cannot say. The trust ladder
    // in trust.ts is built from these counts — confirmedSubmissions is what
    // unlocks auto-submit — so reading an unconfirmed attempt hopefully would
    // inflate the very evidence that decides whether this code is allowed to
    // click without a human next time. The honest count is the smaller one.
    return {
      outcome: window.value ? "submitted" : "unconfirmed",
      gates,
      refusedGate: null,
      requests: window.requests,
      adapterError,
      screenshotPath: screenshot,
      adapterId,
    };
  } catch (error) {
    // A screenshot anyway: whatever went wrong, the page as it stood is the
    // only account of it anybody will be able to read later.
    const screenshot = await captureScreenshot(handle, params.screenshotPath);
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);

    return {
      outcome: "error",
      gates: [],
      refusedGate: null,
      requests: [],
      adapterError: message ?? "unknown error",
      screenshotPath: screenshot,
      adapterId,
    };
  }
}

/**
 * Cancel a navigation the page is still waiting on.
 *
 * Done over CDP rather than through the page API on purpose: `page.evaluate`,
 * `page.goto` and the rest all wait for the pending navigation themselves,
 * which is the very thing being cancelled, so they hang instead of helping.
 * `Page.stopLoading` is the browser being told directly, and it returns
 * immediately.
 *
 * Chromium-only, and best-effort: every failure is swallowed, because a page
 * that could not be stopped is still a page this phase has finished with.
 */
async function stopPendingLoad(handle: FilledHandle): Promise<void> {
  try {
    const cdp = await handle.page.context().newCDPSession(handle.page);
    await cdp.send("Page.stopLoading");
    await cdp.detach().catch(() => undefined);
  } catch {
    // Not Chromium, or the page is already gone. Either way there is nothing
    // to stop and nothing to report.
  }
}

/**
 * Await one probe, but never past the deadline it is being checked against.
 *
 * A probe is not allowed to outlive the window it belongs to. detectSubmitted
 * reads the live page, and reading a page whose navigation is still in flight
 * blocks for Playwright's own default timeout — thirty seconds, fifteen times
 * the window a caller testing a stalled server opens. The window's deadline is
 * the promise this phase makes about how long it will hold the guard open, and
 * a single probe ignoring it would break that promise silently.
 *
 * Reports false on expiry, which is the honest reading: the deadline passed
 * without anybody confirming a submission.
 */
async function askBeforeDeadline(
  probe: Promise<boolean>,
  deadline: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
  });

  try {
    return await Promise.race([probe, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Photograph whatever the page is showing now, and never let that fail the run.
 *
 * Bounded explicitly, because this is often called with a navigation still in
 * flight — a form whose POST the server has not answered leaves the page in
 * exactly that state — and the default timeout would stall the caller for
 * thirty seconds over a picture.
 */
async function captureScreenshot(
  handle: FilledHandle,
  path: string,
): Promise<string | null> {
  return handle.page
    .screenshot({ path, fullPage: true, timeout: 10_000 })
    .then(() => path)
    .catch(() => undefined)
    .then((value) => value ?? null);
}
