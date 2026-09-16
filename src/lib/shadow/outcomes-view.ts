/**
 * Reading a shadow run's stored `outcomes` column back out (spec §20).
 *
 * The column is Json, so what comes back was written by whatever version of
 * the runner happened to be installed that day. Nothing validates it on the
 * way in and nothing can be assumed about it on the way out.
 *
 * That makes this parser's contract unusually strict: it must never throw. The
 * review queue serves the OLDEST unverified run first, so a page that dies on
 * one malformed legacy row does not lose one run — it wedges the whole queue
 * behind that row forever, and the backlog it exists to clear can never be
 * cleared. Returning less is always better than refusing to render.
 */

import type { FieldOutcome } from "../apply/shadow-types";

/**
 * The statuses a run may record. Written out rather than derived from the type,
 * because the type does not survive to runtime and the stored data predates it.
 */
const STATUSES = new Set<FieldOutcome["status"]>([
  "filled",
  "chosen",
  "skipped",
  "failed",
  "answered",
  "attached",
]);

/** Provenance values the display knows how to describe. */
const SOURCES = new Set<FieldOutcome["source"]>([
  "profile",
  "answer-bank",
  "none",
  "document",
  "asked",
  "email",
]);

/**
 * Narrow a stored `outcomes` value to the entries that can actually be shown.
 *
 * Entries are dropped rather than repaired where the missing piece is what
 * makes the entry mean anything — a row with no label names no field, and a
 * row with an unrecognised status makes no claim about what the bot did.
 * Inventing either would put a fabricated judgement in front of the person
 * being asked to judge, which is worse than showing them one row fewer.
 *
 * `source` is the exception: it qualifies an outcome rather than constituting
 * one. An entry whose label, status and value are all intact still tells the
 * truth about what went into the field, so an unreadable source is recorded as
 * "none" — unknown provenance and no provenance are the same fact to a reader:
 * nothing here vouches for where this came from.
 *
 * Callers that care how much was thrown away can compare the length of this
 * against the run's own `fieldsTotal`, which is a separate column and survives
 * whatever happened to the JSON.
 */
export function parseOutcomes(raw: unknown): FieldOutcome[] {
  if (!Array.isArray(raw)) return [];

  const outcomes: FieldOutcome[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;

    const record = entry as Record<string, unknown>;
    const { label, status, detail, source } = record;

    if (typeof label !== "string" || label.trim().length === 0) continue;
    if (typeof status !== "string" || !STATUSES.has(status as FieldOutcome["status"])) continue;
    if (typeof detail !== "string") continue;

    outcomes.push({
      label,
      status: status as FieldOutcome["status"],
      detail,
      source:
        typeof source === "string" && SOURCES.has(source as FieldOutcome["source"])
          ? (source as FieldOutcome["source"])
          : "none",
    });
  }

  return outcomes;
}
