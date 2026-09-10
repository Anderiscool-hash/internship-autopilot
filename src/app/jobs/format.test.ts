/**
 * Tests for dashboard display formatting.
 *
 * The salary cases matter most: they are where an invented currency would
 * show up (spec §3 bans exactly that), so there is a test asserting bare
 * numbers when the posting gave no currency.
 */

import { describe, it, expect } from "vitest";
import { formatAge, formatEnum, formatLocation, formatSalary, NOT_STATED } from "./format";

describe("formatSalary", () => {
  it("shows an em dash when the posting stated no pay", () => {
    expect(formatSalary(null, null, null)).toBe(NOT_STATED);
    expect(formatSalary(null, null, "USD")).toBe(NOT_STATED);
  });

  it("abbreviates salaries so a range fits the dashboard column", () => {
    // The full form truncated mid-number in the table, which reads as a
    // complete figure and is not one.
    expect(formatSalary(80000, 120000, "USD")).toBe("80k–120k USD");
    expect(formatSalary(137500, 210000, "USD")).toBe("137.5k–210k USD");
  });

  it("leaves hourly and monthly figures exact", () => {
    expect(formatSalary(45, 60, "USD")).toBe("45–60 USD");
    expect(formatSalary(4500, null, "USD")).toBe("4,500+ USD");
  });

  it("collapses a range whose ends are equal", () => {
    expect(formatSalary(45, 45, "USD")).toBe("45 USD");
  });

  it("never invents a currency the posting did not state", () => {
    expect(formatSalary(80000, 120000, null)).toBe("80k–120k");
    expect(formatSalary(80000, 120000, null)).not.toContain("$");
    expect(formatSalary(80000, 120000, null)).not.toContain("USD");
  });

  it("handles one-sided ranges", () => {
    expect(formatSalary(50000, null, "EUR")).toBe("50k+ EUR");
    expect(formatSalary(null, 50000, "EUR")).toBe("up to 50k EUR");
  });
});

describe("formatAge", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("uses the shortest sensible unit", () => {
    expect(formatAge(ago(30 * 1000), now)).toBe("just now");
    expect(formatAge(ago(5 * MINUTE), now)).toBe("5m ago");
    expect(formatAge(ago(3 * HOUR), now)).toBe("3h ago");
    expect(formatAge(ago(9 * DAY), now)).toBe("9d ago");
    expect(formatAge(ago(75 * DAY), now)).toBe("2mo ago");
  });

  it("does not print a negative age for a future timestamp", () => {
    expect(formatAge(new Date(now.getTime() + HOUR), now)).toBe("just now");
  });
});

describe("formatEnum", () => {
  it("makes database enums readable", () => {
    expect(formatEnum("ON_SITE")).toBe("On Site");
    expect(formatEnum("GREENHOUSE")).toBe("Greenhouse");
    expect(formatEnum("SAP_SUCCESSFACTORS")).toBe("Sap Successfactors");
  });
});

describe("formatLocation", () => {
  it("falls back to an em dash for missing or blank locations", () => {
    expect(formatLocation(null)).toBe(NOT_STATED);
    expect(formatLocation("   ")).toBe(NOT_STATED);
    expect(formatLocation(" Remote - US ")).toBe("Remote - US");
  });
});
