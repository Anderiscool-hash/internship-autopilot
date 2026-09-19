/** Deterministic RFC 5322 draft composition for IMAP APPEND. */
type Message = { from: string; to: string; subject: string; body: string; date: Date };
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatRfc5322Date(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()] ?? "Sun"}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()] ?? "Jan"} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}
export function encodeSubjectValue(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  const words: string[] = []; let chunk = "";
  for (const char of subject) {
    if (Buffer.byteLength(chunk + char) > 45) { words.push(`=?utf-8?B?${Buffer.from(chunk).toString("base64")}?=`); chunk = char; }
    else chunk += char;
  }
  if (chunk) words.push(`=?utf-8?B?${Buffer.from(chunk).toString("base64")}?=`);
  return words.join(" ");
}
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 0x01000193) >>> 0; }
  return value.toString(36);
}
function hardWrap(line: string): string[] {
  const out: string[] = [];
  while (line.length > 998) { out.push(line.slice(0, 997)); line = ` ${line.slice(997)}`; }
  return [...out, line];
}
function header(name: string, raw: string): string {
  const value = raw.replace(/[\r\n]+/g, " ");
  if (`${name}: ${value}`.length <= 78) return hardWrap(`${name}: ${value}`).join("\r\n");
  const lines: string[] = []; let current = `${name}:`;
  for (const token of value.split(" ")) {
    if (!token) continue;
    const next = `${current} ${token}`;
    if (next.length > 78 && current !== `${name}:`) { lines.push(current); current = ` ${token}`; }
    else current = next;
  }
  lines.push(current);
  return lines.flatMap(hardWrap).join("\r\n");
}
function qp(line: string): string[] {
  const bytes = Buffer.from(line); const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0; const space = b === 32 || b === 9;
    pieces.push((space && i < bytes.length - 1) || (!space && b >= 33 && b <= 126 && b !== 61)
      ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`);
  }
  if (pieces[0] === ".") pieces[0] = "=2E";
  const lines: string[] = []; let current = "";
  for (const piece of pieces) {
    if (current.length + piece.length > 72) {
      if (current.endsWith(" ")) current = `${current.slice(0, -1)}=20`;
      if (current.endsWith("\t")) current = `${current.slice(0, -1)}=09`;
      lines.push(`${current}=`); current = "";
    }
    current += piece;
  }
  return [...lines, current];
}
export function composeMime(message: Message): string {
  const domain = message.from.includes("@") ? message.from.slice(message.from.lastIndexOf("@") + 1).replace(/[>\s]/g, "") || "localhost" : "localhost";
  const id = `<${message.date.getTime().toString(36)}.${hash([message.from, message.to, message.subject, message.body].join("\0"))}@${domain}>`;
  const headers = [header("From", message.from), header("To", message.to), header("Subject", encodeSubjectValue(message.subject)), header("Date", formatRfc5322Date(message.date)), header("Message-ID", id), "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable"];
  const body = message.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").flatMap(qp).join("\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}
