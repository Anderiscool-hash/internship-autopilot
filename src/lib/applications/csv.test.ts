/**
 * Tests for the CSV export.
 *
 * This file exists because the escaping rules are the one part of a CSV
 * export that is invisible until it's wrong: a missing quote doesn't throw,
 * it just silently shifts every column after it one field to the left the
 * first time a note contains a comma. The formula-injection cases matter for
 * the same reason a SQL injection test matters — job titles and notes are
 * free text from the open internet, and the failure mode (a payload that
 * executes the moment someone double-clicks the file in Excel) is silent
 * until it isn't.
 */

import { describe, it, expect } from "vitest";
import { applicationsToCsv, csvField, csvDate, type ApplicationCsvRow } from "./csv";

function row(overrides: Partial<ApplicationCsvRow> = {}): ApplicationCsvRow {
  return {
    companyName: "Acme",
    jobTitle: "Software Engineering Intern",
    location: "Remote",
    status: "CONFIRMED",
    outcome: null,
    fitScore: 88,
    postingUrl: "https://acme.example/jobs/123",
    discoveredAt: new Date("2026-01-05T12:00:00Z"),
    appliedAt: null,
    confirmedAt: null,
    notes: null,
    ...overrides,
  };
}

describe("csvField", () => {
  it("leaves a plain value untouched", () => {
    expect(csvField("Acme")).toBe("Acme");
    expect(csvField(88)).toBe("88");
  });

  it("turns null and undefined into an empty field, never the word 'null'", () => {
    // Prisma's nullable columns (outcome, notes, location, ...) come through
    // as `null`, not `undefined` — a naive `String(value)` on either would
    // print the literal text "null" into someone's spreadsheet, which reads
    // as a real (wrong) answer rather than as "not recorded".
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes a field containing a comma", () => {
    // Without quoting, "Software Engineer, Intern" would split into two
    // columns and shift every field after it out of alignment.
    expect(csvField("Software Engineer, Intern")).toBe('"Software Engineer, Intern"');
  });

  it("quotes a field containing a double quote, and doubles the inner quote", () => {
    expect(csvField('Said "great fit" in the call')).toBe(
      '"Said ""great fit"" in the call"',
    );
  });

  it("quotes a field containing a newline", () => {
    expect(csvField("Line one\nLine two")).toBe('"Line one\nLine two"');
  });

  it("quotes a field with leading or trailing whitespace", () => {
    // A trailing space is invisible once rendered in a spreadsheet cell, but
    // an unquoted trailing space is exactly what a naive comma-split parser
    // downstream would treat as part of a *different* field than the same
    // value without it — quoting preserves it instead of the value silently
    // losing the space on a round trip.
    expect(csvField(" Remote")).toBe('" Remote"');
    expect(csvField("Remote ")).toBe('"Remote "');
    expect(csvField("Remote")).toBe("Remote");
  });

  it("neutralizes a leading =, +, -, or @ so Excel/Sheets never evaluate it as a formula", () => {
    // Each of these is a real formula-injection vector when a job title or
    // note (both free text from the internet) is opened in a spreadsheet —
    // e.g. `=CMD|'/c calc'!A1` executes the moment the cell is evaluated.
    // The leading single quote is how both programs mean "literal text,
    // don't evaluate" without altering the value the reader sees.
    expect(csvField("=CMD|'/c calc'!A1")).toBe("'=CMD|'/c calc'!A1");
    expect(csvField("+1-234-555-0000")).toBe("'+1-234-555-0000");
    expect(csvField("-5 days late")).toBe("'-5 days late");
    expect(csvField("@mentioned in review")).toBe("'@mentioned in review");
  });

  it("does not touch a value that merely contains one of those characters mid-string", () => {
    // Only the *leading* character makes a spreadsheet treat a cell as a
    // formula — flagging every field with a stray hyphen would neutralize
    // ordinary text like job titles for no reason.
    expect(csvField("Full-time intern")).toBe("Full-time intern");
    expect(csvField("Backend @ Acme")).toBe("Backend @ Acme");
  });

  it("still quotes a neutralized formula field that also needs quoting", () => {
    expect(csvField("=A1,B2")).toBe('"\'=A1,B2"');
  });
});

describe("csvDate", () => {
  it("formats as ISO date only, no time", () => {
    expect(csvDate(new Date("2026-03-14T23:59:59Z"))).toBe("2026-03-14");
  });

  it("returns an empty field for null or undefined, never 'null'", () => {
    expect(csvDate(null)).toBe("");
    expect(csvDate(undefined)).toBe("");
  });
});

describe("applicationsToCsv", () => {
  it("returns just the header row when there are no applications", () => {
    // The route still needs a valid, openable CSV when the tracker is empty —
    // a blank body would look like the export itself was broken.
    expect(applicationsToCsv([])).toBe(
      "Company,Job Title,Location,Status,Outcome,Fit Score,Posting URL,Discovered,Applied,Confirmed,Notes\r\n",
    );
  });

  it("serializes a full row in the documented column order", () => {
    const csv = applicationsToCsv([
      row({
        appliedAt: new Date("2026-01-06T09:00:00Z"),
        confirmedAt: new Date("2026-01-08T09:00:00Z"),
        outcome: "INTERVIEW",
        notes: "Recruiter call went well",
      }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Company,Job Title,Location,Status,Outcome,Fit Score,Posting URL,Discovered,Applied,Confirmed,Notes",
    );
    expect(lines[1]).toBe(
      "Acme,Software Engineering Intern,Remote,CONFIRMED,INTERVIEW,88,https://acme.example/jobs/123,2026-01-05,2026-01-06,2026-01-08,Recruiter call went well",
    );
    // Trailing CRLF after the last data row.
    expect(lines[2]).toBe("");
  });

  it("leaves optional fields blank rather than printing 'null'", () => {
    const csv = applicationsToCsv([row({ location: null, outcome: null, fitScore: null, notes: null })]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBe(
      "Acme,Software Engineering Intern,,CONFIRMED,,,https://acme.example/jobs/123,2026-01-05,,,",
    );
  });

  it("joins multiple rows, each newline-terminated", () => {
    const csv = applicationsToCsv([row({ companyName: "Acme" }), row({ companyName: "Globex" })]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Acme");
    expect(lines[2]).toContain("Globex");
  });

  it("neutralizes a formula-injection attempt in a job title pulled from a posting", () => {
    const csv = applicationsToCsv([row({ jobTitle: "=HYPERLINK(\"http://evil\")" })]);
    expect(csv).toContain("'=HYPERLINK(\"\"http://evil\"\")");
  });
});
