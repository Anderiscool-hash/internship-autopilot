/**
 * What is probably misspelled in the candidate's own stored profile.
 *
 * ============================================================================
 * THIS SCRIPT NEVER WRITES TO THE DATABASE. It reads, it prints, it exits 0.
 * ============================================================================
 *
 * It exists because of a real shadow run: the profile stored in this database
 * typed "Computer Science & Cyber Secuirty" and "108 autum ave" onto a live
 * Greenhouse application. The typos are in the stored data, so every future
 * application repeats them until a person fixes the profile.
 *
 * So this is a REPORT, not a gate and not a fixer:
 *   - it always exits 0, so it can never block an apply run,
 *   - it never calls a write, so it can never "tidy" someone's own words,
 *   - it prints the surrounding text with every finding, so a human can look
 *     at it and decide. Some findings will be wrong - unusual surnames, course
 *     codes, company names. Wrong findings are the expected cost of a checker
 *     that is only allowed to suggest.
 *
 * The candidate's NAME is exempt. A person's name is never a misspelling, and
 * a tool that suggests a "correction" to someone's name is broken.
 *
 * Run it with:  npx tsx scripts/spellcheck.ts
 */

import { db } from "../src/lib/db";
import { checkText, MODEL_NEVER_REWRITE, type SpellSuggestion } from "../src/lib/spellcheck/check";

/** How much text to show on either side of a finding. */
const CONTEXT_RADIUS = 45;

/** One piece of stored text to check, and where it came from. */
interface Source {
  /** Printed as the group heading, e.g. "Profile / degree". */
  where: string;
  text: string;
}

/** A finding, plus enough context for a person to judge it. */
interface Finding extends SpellSuggestion {
  where: string;
  context: string;
}

/**
 * Show the word in its surroundings, with the word itself marked.
 *
 * Without this the report is a list of naked words and the reader has no way
 * to tell a real typo from a surname. With it, the judgement takes a second.
 */
function contextAround(text: string, offset: number, length: number): string {
  const start = Math.max(0, offset - CONTEXT_RADIUS);
  const end = Math.min(text.length, offset + length + CONTEXT_RADIUS);

  const before = text.slice(start, offset).replace(/\s+/g, " ");
  const word = text.slice(offset, offset + length);
  const after = text.slice(offset + length, end).replace(/\s+/g, " ");

  return `${start > 0 ? "..." : ""}${before}[${word}]${after}${end < text.length ? "..." : ""}`;
}

/** Every word of the candidate's name, lowercase. These are never flagged. */
function nameWords(name: string): Set<string> {
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(words);
}

async function main(): Promise<void> {
  // One read. Nothing in this script updates, creates or deletes anything.
  const candidates = await db.candidate.findMany({
    include: {
      answerBankEntries: { orderBy: { createdAt: "asc" } },
      truthFacts: { orderBy: { createdAt: "asc" } },
    },
  });

  if (candidates.length === 0) {
    console.log("No candidate profile is stored yet - nothing to check.");
    return;
  }

  console.log("Spelling report for stored candidate data.");
  console.log("This is a report only: nothing here has been changed.\n");

  let totalFindings = 0;
  let totalSourcesChecked = 0;
  let totalWordsChecked = 0;

  for (const candidate of candidates) {
    const exempt = nameWords(candidate.name);

    // Everything worth checking, labelled with where it lives. The name is
    // absent on purpose (see the header); so are email, phone and URLs, which
    // are not prose and would only produce noise.
    const sources: Source[] = [];
    const add = (where: string, text: string | null | undefined): void => {
      if (typeof text === "string" && text.trim().length > 0) {
        sources.push({ where, text });
      }
    };

    add("Profile / address", candidate.address);
    add("Profile / school", candidate.school);
    add("Profile / degree", candidate.degree);
    add("Profile / work authorization", candidate.workAuthorization);
    add("Profile / citizenship", candidate.citizenship);

    candidate.skills.forEach((skill, index) => add(`Profile / skills[${index}]`, skill));
    candidate.certifications.forEach((cert, index) =>
      add(`Profile / certifications[${index}]`, cert),
    );
    candidate.desiredRoles.forEach((role, index) =>
      add(`Profile / desiredRoles[${index}]`, role),
    );
    candidate.preferredLocations.forEach((location, index) =>
      add(`Profile / preferredLocations[${index}]`, location),
    );

    for (const entry of candidate.answerBankEntries) {
      const label = entry.section ? `${entry.section} - ${entry.question}` : entry.question;
      // Legal/EEO answers are still *reported* - a typo in one is worth
      // knowing about. What must never happen is anything rewriting them, and
      // nothing in this tool can. The flag is printed so the reader knows to
      // be extra careful with that row.
      add(`Answer bank / ${label}${entry.isLegal ? "  [LEGAL/EEO]" : ""}`, entry.answer);
    }

    for (const fact of candidate.truthFacts) {
      add(`Truth fact / ${fact.category}`, fact.statement);
    }

    // Collect the findings before printing, so a clean profile prints one
    // reassuring line instead of a wall of empty headings.
    const findings: Finding[] = [];

    for (const source of sources) {
      totalSourcesChecked += 1;
      totalWordsChecked += (source.text.match(/[A-Za-z]{4,}/g) ?? []).length;

      for (const suggestion of checkText(source.text)) {
        // Never second-guess the person's own name, wherever it appears.
        if (exempt.has(suggestion.word.toLowerCase())) continue;

        findings.push({
          ...suggestion,
          where: source.where,
          context: contextAround(source.text, suggestion.offset, suggestion.word.length),
        });
      }
    }

    totalFindings += findings.length;

    console.log("=".repeat(76));
    console.log(`${candidate.name}  <${candidate.email}>`);
    console.log(
      `${sources.length} stored text field(s) checked, ${findings.length} possible typo(s).`,
    );
    console.log("=".repeat(76));

    if (findings.length === 0) {
      console.log("\n  Nothing flagged.\n");
      continue;
    }

    // Grouped by where it was found, in the order the sources were listed, so
    // profile fields come before the long free-text answers.
    let currentGroup = "";
    for (const finding of findings) {
      if (finding.where !== currentGroup) {
        currentGroup = finding.where;
        console.log(`\n${currentGroup}`);
      }
      console.log(`  "${finding.word}"  ->  "${finding.suggestion}"`);
      console.log(`      ${finding.context}`);
    }
    console.log("");
  }

  console.log("-".repeat(76));
  console.log(
    `${totalFindings} possible typo(s) across ${totalSourcesChecked} field(s) ` +
      `(~${totalWordsChecked} words examined).`,
  );
  console.log(
    "Nothing was changed. Fix anything real on the profile screens; ignore the rest.",
  );

  // The seam, printed where the person reading the report will see it. If a
  // local model is ever added as a second pass (see the bottom of
  // src/lib/spellcheck/check.ts), these limits hold for it too.
  console.log("\nIf a model pass is added later, it must never be allowed to rewrite:");
  for (const item of MODEL_NEVER_REWRITE) console.log(`  - ${item}`);
  console.log("  ...and it must never apply a correction on its own.");
}

main()
  .catch((error) => {
    // Even a crash does not fail the run: this is a report, and a report that
    // breaks an apply pipeline is worse than no report.
    console.error("Spelling report could not finish:", error);
  })
  .finally(() => db.$disconnect());
