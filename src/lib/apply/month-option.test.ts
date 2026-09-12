/**
 * Numeric months against month-name dropdowns.
 *
 * A live run left both the start and end month of a degree empty because the
 * answer bank held "09" and the dropdown offered January...December.
 */

import { describe, expect, it } from "vitest";
import { matchOptionForLabel, monthNameFor } from "./fill-plan";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

describe("monthNameFor", () => {
  it("maps numeric months, zero-padded or not", () => {
    expect(monthNameFor("09")).toBe("september");
    expect(monthNameFor("9")).toBe("september");
    expect(monthNameFor("1")).toBe("january");
    expect(monthNameFor("12")).toBe("december");
  });

  // The value a real answer bank held. A number that is not a month must stay
  // unmatched and be reported, never rounded to the nearest one.
  it("refuses numbers that are not months", () => {
    expect(monthNameFor("13")).toBeNull();
    expect(monthNameFor("0")).toBeNull();
    expect(monthNameFor("99")).toBeNull();
  });

  it("refuses anything that is not a plain number", () => {
    expect(monthNameFor("Sept")).toBeNull();
    expect(monthNameFor("")).toBeNull();
    expect(monthNameFor("2027")).toBeNull();
  });
});

describe("matchOptionForLabel — months", () => {
  it("matches a stored number to the named option", () => {
    expect(matchOptionForLabel("09", MONTHS, "Start date month")).toBe("September");
    expect(matchOptionForLabel("1", MONTHS, "End date month")).toBe("January");
  });

  it("leaves an impossible month unmatched", () => {
    expect(matchOptionForLabel("13", MONTHS, "Start date month")).toBeNull();
  });

  // "09" against an arbitrary list is the number nine, not September.
  it("only does this for a field whose label says month", () => {
    expect(matchOptionForLabel("09", MONTHS, "Preferred number")).toBeNull();
  });

  it("still prefers an exact match when the list holds numbers", () => {
    expect(matchOptionForLabel("09", ["08", "09", "10"], "Start date month")).toBe("09");
  });
});
