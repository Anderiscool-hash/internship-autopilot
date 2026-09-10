/**
 * The AI half of resume parsing.
 *
 * Runs only on what regexes genuinely cannot do: which line is the person's
 * name, where they live, and which words in the prose are skills. Everything
 * with a reliable shape — email, phone, URLs, degree, graduation date — is
 * already found by `parse-fields.ts` before this runs, and is not asked for
 * again. Asking a model to find an email address is slower, costs more and is
 * less accurate than the pattern that defines what an email address is.
 *
 * Two rules shape the prompt and the parsing of its answer:
 *
 *   1. The model may only copy, never infer. A resume that does not state a
 *      city does not get one guessed from the area code.
 *   2. Anything it is unsure about comes back null, and null means the field
 *      stays blank for the user to fill in.
 *
 * Nothing here writes to the profile either — this returns suggestions that
 * land in a review form (spec §3).
 */

import { extractJsonObject, readString, readStringArray } from "../ai/json";
import type { AiProvider } from "../ai/types";
import type { FieldSuggestion, ResumeSuggestions } from "./parse-fields";

/**
 * How much of the resume to send.
 *
 * The name and contact details are at the top, and skills sections are almost
 * always in the first half. Sending 6,000 characters keeps a local 8B model
 * inside a comfortable context and a hosted call cheap, while covering a
 * two-page resume.
 */
const MAX_CHARS = 6000;

const SYSTEM_PROMPT = `You extract facts from a resume. You are given the raw text of one person's resume.

Return ONLY a JSON object with these keys:
{
  "name": the person's full name as written, or null,
  "location": the city/state or city/country they live in, or null,
  "portfolio_url": a personal website or portfolio URL that is NOT linkedin or github, or null,
  "skills": an array of technical skills, tools and languages named in the resume,
  "desired_roles": an array of job titles the resume is aimed at, only if the resume states them (an objective line, a headline), otherwise an empty array
}

Rules you must follow:
- Copy values exactly as they appear. Do not reformat, expand abbreviations, or correct spelling.
- Never infer. If the resume does not state something, the value is null or an empty array. Do not guess a location from an area code or a university, do not guess a name from an email address.
- Skills must be terms actually written in the resume. Do not add skills that "go with" the ones listed.
- Return the JSON and nothing else.`;

/** Ask the model for the fields patterns cannot find. */
export async function parseResumeWithAi(
  provider: AiProvider,
  text: string,
): Promise<ResumeSuggestions> {
  const excerpt = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const result = await provider.complete({
    system: SYSTEM_PROMPT,
    prompt: `Resume text:\n\n${excerpt}`,
    maxTokens: 1024,
  });

  const parsed = extractJsonObject(result.text);
  if (parsed === null || typeof parsed !== "object") return {};

  const fields = parsed as Record<string, unknown>;
  const suggestions: ResumeSuggestions = {};

  // The evidence for an AI-sourced value is the model that produced it — the
  // user cannot check it against a line number, so the badge says where it
  // came from and the value stays editable.
  const evidence = `suggested by ${result.model}`;
  const suggest = (value: string): FieldSuggestion => ({
    value,
    evidence,
    source: "ai",
  });

  const name = readString(fields.name);
  if (name) suggestions.name = suggest(name);

  const location = readString(fields.location);
  if (location) suggestions.address = suggest(location);

  const portfolio = readString(fields.portfolio_url);
  if (portfolio) suggestions.portfolioUrl = suggest(portfolio);

  const skills = readStringArray(fields.skills);
  if (skills.length > 0) {
    suggestions.skills = { value: skills, evidence, source: "ai" };
  }

  return suggestions;
}

/**
 * Combine the pattern pass with the AI pass.
 *
 * Patterns win every field they found. They are checkable against a line of
 * the resume, and a model asked for an email address will occasionally return
 * a plausible one that is not in the document.
 */
export function mergeSuggestions(
  fromPatterns: ResumeSuggestions,
  fromAi: ResumeSuggestions,
): ResumeSuggestions {
  return { ...fromAi, ...fromPatterns };
}
