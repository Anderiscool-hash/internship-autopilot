/**
 * Getting JSON back out of a model's answer.
 *
 * Asking a model for JSON and getting *only* JSON are different things. Local
 * models in particular wrap it in ```json fences, prefix it with "Sure! Here
 * is the JSON:", or append a paragraph explaining what they did. All of that
 * is normal, none of it is an error, and none of it survives `JSON.parse`.
 *
 * So the rule here is: find the first balanced JSON object in the text and
 * ignore everything around it. If there isn't one, return null — never a
 * half-parsed guess. A caller that gets null should treat the field as
 * unknown, which everywhere in this app means "leave it blank", not "make
 * something up".
 */

/**
 * Pull the first balanced `{...}` object out of arbitrary model output.
 *
 * Brace counting rather than a regex, because a regex cannot tell a closing
 * brace inside a string value ("salary: {negotiable}") from the end of the
 * object. Strings and their escapes are tracked so those braces are skipped.
 */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      // Only meaningful inside a string, but harmless outside one.
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // Balanced braces but invalid JSON — a trailing comma, a single
          // quote, an unquoted key. Not recoverable without guessing at what
          // was meant, so it counts as no answer.
          return null;
        }
      }
    }
  }

  // Ran off the end with braces still open: the response was truncated,
  // usually by max_tokens. Also no answer.
  return null;
}

/**
 * Read a string field from parsed JSON, or null.
 *
 * Every field the model returns goes through one of these readers rather than
 * being trusted. A model asked for a graduation date can return `"unknown"`,
 * `""`, `null`, or the number 2027 — all of which must become "we don't know"
 * rather than a value that gets written to someone's profile.
 */
export function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Models say these instead of omitting a field. They are not answers.
  if (/^(unknown|n\/?a|none|null|not (stated|specified|provided|found))$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Read an array of non-empty strings, deduplicated, or an empty array. */
export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => readString(item))
    .filter((item): item is string => item !== null);
  return [...new Set(items)];
}
