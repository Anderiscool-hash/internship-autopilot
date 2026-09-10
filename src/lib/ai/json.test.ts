/**
 * Tests for reading JSON out of model output.
 *
 * The cases here are all things models actually do: fence the JSON, chat
 * before it, chat after it, put braces inside strings, and answer "unknown"
 * instead of leaving a field out. The last one matters most — "unknown" must
 * become null, because null means "leave the profile field blank" and the
 * string would become someone's recorded degree.
 */

import { describe, it, expect } from "vitest";
import { extractJsonObject, readString, readStringArray } from "./json";

describe("extractJsonObject", () => {
  it("reads plain JSON", () => {
    expect(extractJsonObject('{"name":"Ander"}')).toEqual({ name: "Ander" });
  });

  it("reads JSON inside a code fence", () => {
    const text = 'Here you go:\n```json\n{"name":"Ander"}\n```\n';
    expect(extractJsonObject(text)).toEqual({ name: "Ander" });
  });

  it("ignores chat before and after", () => {
    const text = 'Sure! Here is the JSON:\n{"a":1}\nLet me know if you need more.';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("is not confused by braces inside string values", () => {
    const text = '{"note":"salary is {negotiable}","ok":true}';
    expect(extractJsonObject(text)).toEqual({ note: "salary is {negotiable}", ok: true });
  });

  it("is not confused by escaped quotes", () => {
    const text = '{"quote":"she said \\"hi\\" once"}';
    expect(extractJsonObject(text)).toEqual({ quote: 'she said "hi" once' });
  });

  it("handles nested objects", () => {
    expect(extractJsonObject('prefix {"a":{"b":{"c":1}}} suffix')).toEqual({
      a: { b: { c: 1 } },
    });
  });

  it("returns null when there is no JSON at all", () => {
    expect(extractJsonObject("I could not find anything in this resume.")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });

  it("returns null for a truncated response rather than a partial object", () => {
    expect(extractJsonObject('{"name":"Ander","skills":["Py')).toBeNull();
  });

  it("returns null for balanced but invalid JSON", () => {
    // Trailing comma — a real thing small models emit.
    expect(extractJsonObject('{"a":1,}')).toBeNull();
  });
});

describe("readString", () => {
  it("keeps a real value", () => {
    expect(readString("  Rutgers University  ")).toBe("Rutgers University");
  });

  it("treats the ways models say 'I do not know' as null", () => {
    for (const value of ["unknown", "Unknown", "N/A", "n/a", "none", "null", "not stated", "Not specified", "not found"]) {
      expect(readString(value), value).toBeNull();
    }
  });

  it("treats blanks and non-strings as null", () => {
    expect(readString("")).toBeNull();
    expect(readString("   ")).toBeNull();
    expect(readString(null)).toBeNull();
    expect(readString(2027)).toBeNull();
    expect(readString(undefined)).toBeNull();
  });
});

describe("readStringArray", () => {
  it("keeps real values and drops the rest", () => {
    expect(readStringArray(["Python", "", "unknown", "SQL", null, 7])).toEqual([
      "Python",
      "SQL",
    ]);
  });

  it("deduplicates", () => {
    expect(readStringArray(["Python", "Python "])).toEqual(["Python"]);
  });

  it("returns an empty array for anything that is not a list", () => {
    expect(readStringArray("Python, SQL")).toEqual([]);
    expect(readStringArray(null)).toEqual([]);
  });
});
