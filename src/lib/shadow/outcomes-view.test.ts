/**
 * Tests for reading a shadow run's stored outcomes (see outcomes-view.ts).
 *
 * These exist for one failure and one failure only: a 500 on the review queue.
 * The queue hands out the oldest unverified run first, so if a single legacy
 * row's Json throws while being rendered, the page never gets past it — the
 * backlog of unverified runs stops being clearable at all, and every adapter's
 * trust level is frozen wherever it happens to sit.
 *
 * So every case here is a shape the column might actually hold after several
 * versions of the runner wrote to it, and the assertion is always the same:
 * something sensible came back, and nothing was thrown.
 */

import { describe, it, expect } from "vitest";
import type { FieldOutcome } from "../apply/shadow-types";
import { parseOutcomes } from "./outcomes-view";

const FILLED: FieldOutcome = {
  label: "Full name",
  status: "filled",
  detail: "Ada Lovelace",
  source: "profile",
};

const ATTACHED: FieldOutcome = {
  label: "Resume",
  status: "attached",
  detail: "resume.pdf",
  source: "document",
};

describe("parseOutcomes", () => {
  it("returns nothing for values that are not arrays at all", () => {
    // Prisma hands back `null` for a column never written, and older runners
    // are just as likely to have stored a summary string or an object.
    expect(parseOutcomes(null)).toEqual([]);
    expect(parseOutcomes(undefined)).toEqual([]);
    expect(parseOutcomes("filled 12 of 14 fields")).toEqual([]);
    expect(parseOutcomes(42)).toEqual([]);
    expect(parseOutcomes(true)).toEqual([]);
    expect(parseOutcomes({ outcomes: [FILLED] })).toEqual([]);
  });

  it("keeps valid entries intact and in the order they were recorded", () => {
    // Order is the order the bot met the fields, which is how the reviewer
    // reads the screenshot: top of the form downwards.
    expect(parseOutcomes([FILLED, ATTACHED])).toEqual([FILLED, ATTACHED]);
  });

  it("drops junk sitting between valid entries", () => {
    const parsed = parseOutcomes([null, FILLED, "skipped", 7, [], ATTACHED, undefined]);
    expect(parsed).toEqual([FILLED, ATTACHED]);
  });

  it("drops entries missing the fields that make them mean anything", () => {
    const parsed = parseOutcomes([
      { status: "filled", detail: "x", source: "profile" }, // no label
      { label: "Email", detail: "x", source: "profile" }, // no status
      { label: "Phone", status: "filled", source: "profile" }, // no value
      { label: "   ", status: "filled", detail: "x", source: "profile" }, // blank label
      FILLED,
    ]);
    expect(parsed).toEqual([FILLED]);
  });

  it("drops entries whose fields are the wrong type", () => {
    const parsed = parseOutcomes([
      { label: 12, status: "filled", detail: "x", source: "profile" },
      { label: "Email", status: 3, detail: "x", source: "profile" },
      { label: "Phone", status: "filled", detail: { value: "x" }, source: "profile" },
      FILLED,
    ]);
    expect(parsed).toEqual([FILLED]);
  });

  it("drops an entry whose status is not one this app can render", () => {
    // A status nobody recognises is not a judgement that can be shown. Guessing
    // one would put a made-up verdict in front of the person doing the
    // verifying, which defeats the entire point of the queue.
    const parsed = parseOutcomes([
      { label: "Cover letter", status: "maybe-filled", detail: "x", source: "profile" },
      FILLED,
    ]);
    expect(parsed).toEqual([FILLED]);
  });

  it("records an unreadable source as none rather than losing the whole entry", () => {
    // The opposite call from status, and deliberately: label, status and value
    // are still true statements about what went into the field. Only the
    // provenance is unknown, and "none" says exactly that — nothing here
    // vouches for where this value came from.
    const parsed = parseOutcomes([
      { label: "Full name", status: "filled", detail: "Ada Lovelace" },
      { label: "Email", status: "filled", detail: "ada@example.com", source: "mailbox" },
      { label: "Phone", status: "filled", detail: "555", source: 9 },
    ]);
    expect(parsed.map((outcome) => outcome.source)).toEqual(["none", "none", "none"]);
    expect(parsed.map((outcome) => outcome.label)).toEqual(["Full name", "Email", "Phone"]);
  });

  it("keeps the email source, which the page has to flag", () => {
    const code: FieldOutcome = {
      label: "Verification code",
      status: "answered",
      detail: "481920",
      source: "email",
    };
    expect(parseOutcomes([code])).toEqual([code]);
  });

  it("survives anything at all without throwing", () => {
    // The blanket case. Whatever is in that column, the queue keeps moving.
    const nasty: unknown[] = [
      [[[]]],
      { label: null, status: null, detail: null, source: null },
      Object.create(null),
      new Date(),
      () => FILLED,
      Number.NaN,
      { label: "Ok", status: "chosen", detail: "", source: "answer-bank" },
    ];
    expect(() => parseOutcomes(nasty)).not.toThrow();
    expect(parseOutcomes(nasty)).toEqual([
      { label: "Ok", status: "chosen", detail: "", source: "answer-bank" },
    ]);
  });
});
