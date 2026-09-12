/**
 * CSV export for the application tracker (spec §24).
 *
 * Pure serialization, kept apart from the route handler on purpose: getting
 * the escaping right is the entire reason this file exists, and that is only
 * checkable with tests that never touch a database or an HTTP response.
 */

/** One row of the export. Shaped for the spreadsheet, not for Prisma. */
export interface ApplicationCsvRow {
  companyName: string;
  jobTitle: string;
  location: string | null;
  status: string;
  outcome: string | null;
  fitScore: number | null;
  postingUrl: string;
  discoveredAt: Date;
  appliedAt: Date | null;
  confirmedAt: Date | null;
  notes: string | null;
}

const HEADER = [
  "Company",
  "Job Title",
  "Location",
  "Status",
  "Outcome",
  "Fit Score",
  "Posting URL",
  "Discovered",
  "Applied",
  "Confirmed",
  "Notes",
];

/**
 * First characters Excel and Google Sheets both treat as "this cell is a
 * formula" rather than plain text. Job titles and notes are free text pulled
 * off the open internet (a scraped posting, a note someone pasted in) — a
 * value like `=CMD|'/c calc'!A1` or `@SUM(1+1)` is a real formula-injection
 * payload waiting for exactly one thing: a person opening this CSV in a
 * spreadsheet, which is the only way this export is ever consumed.
 */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);

/**
 * Defuse a formula-looking field without changing what it says.
 *
 * A leading single quote is how Excel and Google Sheets both mean "treat the
 * rest of this cell as literal text" — it renders as `=A1+1`, not `'=A1+1`,
 * so the reader sees the original value and neither program ever evaluates
 * it as a formula.
 */
function neutralizeFormulaPrefix(value: string): string {
  const first = value[0];
  if (first !== undefined && FORMULA_PREFIXES.has(first)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Render one value as an RFC 4180 CSV field.
 *
 * `null`/`undefined` become `""`, never the string "null" — a nullable
 * Prisma column that a caller forgot to guard would otherwise print the
 * literal word "null" onto a person's spreadsheet row, which reads as real
 * data rather than as the absence of any.
 *
 * A field is quoted when it contains a comma, a double quote, a newline, or
 * has leading/trailing whitespace. The whitespace case matters even though
 * it looks harmless: a trailing space is invisible once rendered in a
 * spreadsheet cell but is exactly the kind of thing a naive downstream
 * comma-split parser (or a diff of two exports) would treat as a different
 * value than the same field without it, so it is preserved by quoting
 * instead of silently trimmed.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  const raw = String(value);
  const text = neutralizeFormulaPrefix(raw);

  const needsQuoting =
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    text !== text.trim();

  if (!needsQuoting) return text;

  // Doubling is RFC 4180's escape for a literal quote inside a quoted field.
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A date as `YYYY-MM-DD`, no time component.
 *
 * This export exists to be opened in a spreadsheet, and a spreadsheet's date
 * column wants a date, not a UTC timestamp that reads as a different local
 * day depending on who opens the file.
 */
export function csvDate(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

/**
 * Serialize application rows into a complete CSV document, header included.
 *
 * Lines join on CRLF per RFC 4180 (and what Excel expects natively on
 * Windows), with a trailing CRLF so the file ends in a proper newline.
 */
export function applicationsToCsv(rows: ApplicationCsvRow[]): string {
  const lines = [HEADER.map(csvField).join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvField(row.companyName),
        csvField(row.jobTitle),
        csvField(row.location),
        csvField(row.status),
        csvField(row.outcome),
        csvField(row.fitScore),
        csvField(row.postingUrl),
        csvDate(row.discoveredAt),
        csvDate(row.appliedAt),
        csvDate(row.confirmedAt),
        csvField(row.notes),
      ].join(","),
    );
  }

  return lines.join("\r\n") + "\r\n";
}
