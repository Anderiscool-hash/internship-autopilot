/**
 * Types shared between the shadow runner and the modules that reason about
 * its results.
 *
 * Extracted so the pure planning code (ask-plan.ts) can describe outcomes
 * without importing shadow.ts, which pulls in Playwright — a browser engine is
 * a heavy thing to load into a unit test that only wants to decide which
 * questions to ask.
 */

import type { PlannedField } from "./fill-plan";

/** What happened to one field when the plan met the real page. */
export interface FieldOutcome {
  label: string;
  status: "filled" | "chosen" | "skipped" | "failed" | "answered";
  /** The value entered, or the reason nothing was. */
  detail: string;
  source: PlannedField["source"] | "asked";
}
