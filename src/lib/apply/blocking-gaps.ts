/**
 * Which required fields are actually still blocking submission, once the
 * real page's result is known — not just what the plan intended.
 *
 * `buildFillPlan`'s own `blockingGaps` (fill-plan.ts) counts only fields the
 * planner chose to `skip`. That undercounts: a field the planner planned to
 * *fill* can still fail once it meets the real page — a combobox whose
 * option never matched, a control Playwright could not find, an upload that
 * silently didn't attach — and a runtime failure on a required field blocks
 * submission exactly as much as a planned skip does.
 *
 * A live run against a real Greenhouse form found this the hard way: the
 * required "School" dropdown was planned to fill, failed during live option
 * matching, and never showed up in `blockingGaps` — the run reported "3
 * required fields still empty" when a person looking at the form would have
 * counted 4.
 *
 * This looks at every planned field's *actual outcome* rather than its
 * intended action, so a runtime failure on a required field is reported
 * exactly like a planned skip would have been. Pure: a plan and its outcomes
 * in, the corrected list of blocking labels out — no browser involved, so
 * it is testable on its own.
 */

import type { PlannedField } from "./fill-plan";
import type { FieldOutcome } from "./shadow-types";

/**
 * Outcome statuses that mean a required field genuinely holds a value once
 * the run is over. Anything else — skipped, failed, or a field the run never
 * recorded an outcome for at all — still blocks submission.
 */
const RESOLVED_STATUSES = new Set<FieldOutcome["status"]>([
  "filled",
  "chosen",
  "attached",
  "answered",
]);

/**
 * Required fields left without a usable value once the run finished.
 *
 * Supersedes `FillPlan.blockingGaps` for reporting purposes: every field that
 * pure planner already flagged (`action.type === "skip"`) ends this run with
 * a non-resolved outcome too, so it reappears here — nothing from the
 * original list is lost, and nothing is double-counted, because this
 * rebuilds the list from scratch off the final outcome rather than
 * appending to the planner's.
 */
export function computeBlockingGaps(
  planned: PlannedField[],
  outcomes: FieldOutcome[],
): string[] {
  const byLabel = new Map(outcomes.map((outcome) => [outcome.label, outcome]));
  const gaps: string[] = [];
  const seen = new Set<string>();

  for (const item of planned) {
    if (!item.field.required) continue;

    const label = item.field.label;
    if (seen.has(label)) continue; // a repeated label (e.g. two fields with
    // the same visible text) blocks once, not twice.

    const outcome = byLabel.get(label);
    const resolved = outcome !== undefined && RESOLVED_STATUSES.has(outcome.status);

    if (!resolved) {
      gaps.push(label);
      seen.add(label);
    }
  }

  return gaps;
}
