/**
 * Tests for adaptive polling (spec §5).
 *
 * The behaviour worth pinning down is that a board's tier follows its own
 * activity — active boards speed up, quiet ones slow down — and that a
 * failing board backs off without ever being abandoned.
 */

import { describe, it, expect } from "vitest";
import {
  backoffInterval,
  isDue,
  MAX_BACKOFF_MINUTES,
  nextPollInterval,
  POLL_MINUTES,
  pollTierFor,
  selectDueCompanies,
  type SchedulableCompany,
} from "./schedule";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A normal-priority company with no history, overridable per test. */
function company(overrides: Partial<SchedulableCompany> = {}): SchedulableCompany {
  return {
    id: "cmp_1",
    scanPriority: 50,
    pollInterval: 30,
    failureCount: 0,
    lastScan: null,
    lastChange: null,
    ...overrides,
  };
}

describe("pollTierFor", () => {
  it("puts priority companies on the fast tier whatever their activity", () => {
    expect(pollTierFor(company({ scanPriority: 5, lastChange: null }), NOW)).toBe(
      "priority",
    );
    expect(
      pollTierFor(
        company({ scanPriority: 5, lastChange: new Date(NOW.getTime() - 30 * DAY) }),
        NOW,
      ),
    ).toBe("priority");
  });

  it("speeds up a board that changed in the last day", () => {
    const lastChange = new Date(NOW.getTime() - 3 * HOUR);
    expect(pollTierFor(company({ lastChange }), NOW)).toBe("active");
  });

  it("uses the normal tier for a board that changed within the week", () => {
    const lastChange = new Date(NOW.getTime() - 3 * DAY);
    expect(pollTierFor(company({ lastChange }), NOW)).toBe("normal");
  });

  it("treats a board with no change in over a week as dormant", () => {
    const lastChange = new Date(NOW.getTime() - 30 * DAY);
    expect(pollTierFor(company({ lastChange }), NOW)).toBe("dormant");
  });

  it("treats a board we have never seen change as dormant", () => {
    expect(pollTierFor(company({ lastChange: null }), NOW)).toBe("dormant");
  });

  it("orders the tiers fastest to slowest, as spec §5 describes", () => {
    expect(POLL_MINUTES.priority).toBeLessThan(POLL_MINUTES.active);
    expect(POLL_MINUTES.active).toBeLessThan(POLL_MINUTES.normal);
    expect(POLL_MINUTES.normal).toBeLessThan(POLL_MINUTES.dormant);
  });
});

describe("nextPollInterval", () => {
  it("returns the minutes for the company's tier", () => {
    expect(nextPollInterval(company({ scanPriority: 1 }), NOW)).toBe(
      POLL_MINUTES.priority,
    );
    expect(nextPollInterval(company(), NOW)).toBe(POLL_MINUTES.dormant);
  });
});

describe("backoffInterval", () => {
  it("doubles with each consecutive failure", () => {
    expect(backoffInterval(1, 30)).toBe(30);
    expect(backoffInterval(2, 30)).toBe(60);
    expect(backoffInterval(3, 30)).toBe(120);
  });

  it("stops growing at the cap so a board is never abandoned", () => {
    expect(backoffInterval(99, 30)).toBe(MAX_BACKOFF_MINUTES);
  });

  it("treats a zero failure count as the first failure", () => {
    expect(backoffInterval(0, 30)).toBe(30);
  });
});

describe("isDue", () => {
  it("is due immediately when never scanned", () => {
    expect(isDue(company({ lastScan: null }), NOW)).toBe(true);
  });

  it("is due once the interval has elapsed", () => {
    const justScanned = company({ lastScan: new Date(NOW.getTime() - 5 * MINUTE) });
    const staleScan = company({ lastScan: new Date(NOW.getTime() - 31 * MINUTE) });
    expect(isDue(justScanned, NOW)).toBe(false);
    expect(isDue(staleScan, NOW)).toBe(true);
  });

  it("is due exactly on the boundary", () => {
    const exactly = company({ lastScan: new Date(NOW.getTime() - 30 * MINUTE) });
    expect(isDue(exactly, NOW)).toBe(true);
  });
});

describe("selectDueCompanies", () => {
  it("skips companies that are not due yet", () => {
    const due = company({ id: "due", lastScan: new Date(NOW.getTime() - HOUR) });
    const notDue = company({ id: "fresh", lastScan: new Date(NOW.getTime() - MINUTE) });
    expect(selectDueCompanies([notDue, due], NOW, 10).map((c) => c.id)).toEqual(["due"]);
  });

  it("scans higher-priority companies first", () => {
    const normal = company({ id: "normal", scanPriority: 50 });
    const priority = company({ id: "priority", scanPriority: 1 });
    expect(selectDueCompanies([normal, priority], NOW, 10).map((c) => c.id)).toEqual([
      "priority",
      "normal",
    ]);
  });

  it("breaks ties by who has waited longest, never-scanned first", () => {
    const old = company({ id: "old", lastScan: new Date(NOW.getTime() - 5 * HOUR) });
    const older = company({ id: "older", lastScan: new Date(NOW.getTime() - 9 * HOUR) });
    const never = company({ id: "never", lastScan: null });
    expect(selectDueCompanies([old, older, never], NOW, 10).map((c) => c.id)).toEqual([
      "never",
      "older",
      "old",
    ]);
  });

  it("caps how much work one cycle takes on", () => {
    const many = Array.from({ length: 10 }, (_, i) => company({ id: `c${i}` }));
    expect(selectDueCompanies(many, NOW, 3)).toHaveLength(3);
  });
});
