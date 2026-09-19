import { describe, expect, it } from "vitest";
import { composeMime, encodeSubjectValue, formatRfc5322Date } from "./compose";
const base = { from: "Alex <alex@example.com>", to: "jane@acme.com", subject: "Summer internship", body: "Hi Jane,\n\nAlex", date: new Date("2026-09-15T14:12:42Z") };
function decodeQp(text: string): string {
  const joined = text.replace(/=\r\n/g, ""); const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i] ?? "";
    if (ch === "=" && /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))) { bytes.push(parseInt(joined.slice(i + 1, i + 3), 16)); i += 2; }
    else for (const byte of Buffer.from(ch)) bytes.push(byte);
  }
  return Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
}
describe("composeMime", () => {
  it("is deterministic, dated in UTC, and has no lone newlines", () => {
    const mime = composeMime({ ...base, body: "One\nTwo\rThree\r\nFour" });
    expect(mime).toBe(composeMime({ ...base, body: "One\nTwo\rThree\r\nFour" }));
    expect(mime).toContain("Date: Tue, 15 Sep 2026 14:12:42 +0000\r\n");
    expect(mime).toMatch(/Message-ID: <[0-9a-z]+\.[0-9a-z]+@example\.com>/);
    expect(mime.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    expect(mime).toContain("Content-Transfer-Encoding: quoted-printable");
  });
  it("round trips quoted-printable with long lines, Unicode, dots and trailing spaces", () => {
    const body = `.NET\né${"x".repeat(2000)}\nAlex  `;
    const mime = composeMime({ ...base, body });
    const encoded = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    expect(encoded).toContain("=2ENET");
    expect(encoded).toContain("=C3=A9");
    expect(encoded).toContain("Alex =20");
    expect(decodeQp(encoded).trimEnd()).toBe(body.trimEnd());
    expect(encoded.split("\r\n").every(line => Buffer.byteLength(line) <= 76)).toBe(true);
  });
  it("folds long subjects and strips injected headers", () => {
    const mime = composeMime({ ...base, subject: "Hello\r\nBcc: attacker@example.com " + "word ".repeat(100) });
    expect(mime).not.toContain("\r\nBcc:");
    expect(mime.split("\r\n").every(line => Buffer.byteLength(line) <= 998)).toBe(true);
  });
  it("keeps emoji code points intact in encoded words", () => {
    const subject = "Thanks " + "🚀".repeat(40);
    const words = encodeSubjectValue(subject).split(" ");
    expect(words.every(word => word.length <= 75)).toBe(true);
    expect(words.map(word => Buffer.from(word.slice(10, -2), "base64").toString("utf8")).join("")).toBe(subject);
  });
  it("pads single digit UTC fields", () => expect(formatRfc5322Date(new Date("2027-01-05T03:04:05Z"))).toBe("Tue, 05 Jan 2027 03:04:05 +0000"));
});
