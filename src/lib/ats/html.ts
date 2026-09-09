/**
 * Shared HTML stripper for job descriptions across all ATS platforms.
 *
 * All three ATS client modules (greenhouse, lever, ashby) need to convert
 * raw HTML job descriptions into plain text. Rather than maintaining three
 * identical copies of stripHtml() that drift apart, the implementation lives
 * here and is imported by all three clients. Keeps the parsing logic in one
 * place and makes maintenance changes easier.
 */

/**
 * Turns HTML into plain, readable text.
 *
 * Job platforms publish descriptions as raw HTML (meant to be rendered on
 * their careers pages). We store plain text in CanonicalJob.description so
 * downstream AI steps (requirement extraction, match scoring) work with
 * clean text instead of markup. This is a simple, dependency-free stripper:
 * good enough for job descriptions, not a full HTML parser.
 */
export function stripHtml(html: string): string {
  if (!html) {
    return "";
  }

  const withLineBreaks = html
    // Turn block-ending tags into newlines so paragraphs don't run together.
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    // Turn list items into "- item" style lines before we strip the tag.
    .replace(/<\s*li[^>]*>/gi, "\n- ");

  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, "");

  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"');

  // Collapse repeated blank lines and trim each line so the result reads
  // like normal text instead of whitespace soup.
  return decoded
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n")
    .trim();
}
