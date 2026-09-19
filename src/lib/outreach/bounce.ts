/** Conservative RFC 3464 delivery-status parser. */
const STATUS = /^([245])\.(\d{1,3})\.(\d{1,3})$/;
export interface BounceReport { failedRecipient: string; status: string; hard: boolean; diagnostic?: string }
export function isHardStatus(status: string): boolean { const s = status.trim(); return STATUS.test(s) && s.startsWith("5.") && s !== "5.2.2"; }
function unfold(block: string): string[] {
  const lines: string[] = [];
  for (const line of block.split("\n")) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""} ${line.trim()}`;
    else lines.push(line);
  }
  return lines;
}
function split(text: string): { headers: string[]; body: string } {
  const at = text.indexOf("\n\n");
  return at < 0 ? { headers: unfold(text), body: "" } : { headers: unfold(text.slice(0, at)), body: text.slice(at + 2) };
}
function field(lines: string[], name: string): string | null {
  const prefix = `${name.toLowerCase()}:`;
  return lines.find(line => line.toLowerCase().startsWith(prefix))?.slice(prefix.length).trim() ?? null;
}
function recipient(value: string | null): string | null {
  if (!value) return null;
  const bare = value.slice(value.indexOf(";") + 1).trim();
  const address = (/<([^>]+)>/.exec(bare)?.[1] ?? bare).trim();
  return /^[^\s@]+@[^\s@]+$/.test(address) ? address : null;
}
function readStatus(body: string): BounceReport | null {
  for (const block of body.split(/\n[ \t]*\n/)) {
    const lines = unfold(block);
    if (field(lines, "Action")?.toLowerCase() !== "failed") continue;
    const failedRecipient = recipient(field(lines, "Final-Recipient")) ?? recipient(field(lines, "Original-Recipient"));
    const status = field(lines, "Status");
    if (!failedRecipient || !status || !STATUS.test(status)) continue;
    const diagnostic = field(lines, "Diagnostic-Code");
    return { failedRecipient, status, hard: isHardStatus(status), ...(diagnostic ? { diagnostic } : {}) };
  }
  return null;
}
export function parseDsn(raw: string): BounceReport | null {
  const outer = split(raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const type = field(outer.headers, "Content-Type");
  if (!type || !/multipart\/report/i.test(type) || !/report-type\s*=\s*"?delivery-status"?/i.test(type)) return null;
  const boundary = /boundary\s*=\s*"([^"]+)"/i.exec(type)?.[1] ?? /boundary\s*=\s*([^;\s]+)/i.exec(type)?.[1];
  if (!boundary) return null;
  for (const chunk of outer.body.split(`--${boundary}`).slice(1)) {
    if (chunk.startsWith("--")) break;
    const part = split(chunk.replace(/^\n/, ""));
    if (/message\/delivery-status/i.test(field(part.headers, "Content-Type") ?? "")) {
      const report = readStatus(part.body);
      if (report) return report;
    }
  }
  return null;
}
