/**
 * The fill-in-by-hand answer sheet: exporting the questions the autofill
 * could not answer, and reading the filled-in file back.
 *
 * WHY THIS EXISTS
 * ---------------
 * The review queue (`/shadow-runs`) shows one recorded run at a time so a
 * person can judge it. What it does not give you is a way to *fix* the gaps:
 * the unverified runs have between them roughly a hundred distinct questions
 * that nothing filled, and the only cure for a question nobody has ever
 * answered is for the candidate to answer it once. Doing that inside a
 * browser, one field at a time, across dozens of runs, is the reason it has
 * not happened.
 *
 * So this module turns those gaps into one Markdown file the person fills in
 * at their own pace, and then reads that same file back into the answer bank.
 * One file format, two directions.
 *
 * WHAT THIS MODULE IS AND IS NOT
 * ------------------------------
 * Everything here is pure: it takes plain objects in and gives strings and
 * plain objects back. It never touches the database, the filesystem or the
 * network — `scripts/answer-sheet.ts` does all of that. That split is what
 * lets the parser be tested hard (a typed answer containing a colon, a
 * multi-line answer, a missing marker line) without a database anywhere near
 * the test.
 *
 * THE ONE RULE THAT OVERRIDES EVERYTHING HERE
 * -------------------------------------------
 * A person's typed answer is a fact about that person. This code never
 * invents one, never rewrites one, never "corrects" one, and never guesses at
 * one it could not read. Surrounding whitespace is trimmed — that is an
 * artifact of typing into a text file, not part of what they said — and
 * nothing else is done to it. When something cannot be understood it is
 * reported as skipped with a reason, never silently repaired.
 */

import { ambiguousLabelReason, looksLikeFieldId } from "./ambiguous-labels";
import { conceptOf } from "./concepts";

// ============================================================================
// INPUT SHAPES
// ============================================================================

/**
 * One recorded run, reduced to only what the sheet needs.
 *
 * Deliberately a plain structural type rather than the Prisma row: this file
 * has no business knowing what a `ShadowRun` looks like, and a test that had
 * to build one would need a database schema to write three lines of fixture.
 */
export interface SheetRun {
  /** The employer whose form this was, e.g. "Coinbase". */
  companyName: string;
  /** The ATS the form runs on, as stored, e.g. "GREENHOUSE". */
  atsType: string;
  /** Required fields left empty — these are what stop a submission. */
  blockingGaps: string[];
  /** Per-field record of what happened. Already narrowed by parseOutcomes. */
  outcomes: SheetOutcome[];
}

/** One field's fate in a run. A subset of `FieldOutcome` on purpose. */
export interface SheetOutcome {
  label: string;
  status: string;
  /** The value entered, or the reason nothing was. */
  detail: string;
}

// ============================================================================
// WHAT COUNTS AS "NOT ANSWERED"
// ============================================================================

/**
 * Did this field actually end up holding a value?
 *
 * Only "filled" and "chosen" mean the form took the answer. Everything else —
 * skipped, failed, attached, answered — left the question open as far as the
 * answer bank is concerned.
 *
 * "attached" is the interesting one: it means a document was uploaded, which
 * did work. Those rows (Resume, Cover letter) still show up on the sheet, and
 * that is deliberate rather than an oversight — see the note in `buildSheet`.
 */
function wasAnswered(outcome: SheetOutcome): boolean {
  return outcome.status === "filled" || outcome.status === "chosen";
}

// ============================================================================
// A STABLE ID FOR A QUESTION
// ============================================================================

/**
 * A short, stable id for a question, used as the anchor in the file.
 *
 * WHY AN ID AT ALL, when the question text is right there: because the person
 * is going to be typing in this file, and a stray edit to a heading — a fixed
 * typo, a smart quote their editor "helpfully" substituted, a wrapped long
 * line — would silently turn the entry into a different question and file
 * their answer under wording no form ever used. The id is a checksum of the
 * exact text the employer wrote. If the heading changes, the id no longer
 * matches it and the import says so out loud instead of guessing.
 *
 * FNV-1a, hand-rolled, run twice with different seeds for 64 bits of output.
 * No import needed, deterministic across machines and Node versions, and 64
 * bits is far past any collision worry for a file with a hundred entries in
 * it. This is not a security hash and is not used as one.
 */
export function questionId(question: string): string {
  return `${fnv1a(question, 0x811c9dc5)}${fnv1a(question, 0x01000193)}`;
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime, 16777619, applied by shift-and-add. A plain
    // `hash * 16777619` loses precision as soon as the product passes 2^53,
    // which it does immediately, and would make the hash machine-dependent.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ============================================================================
// PULLING THE OPTIONS OUT OF A FAILURE MESSAGE
// ============================================================================

/** The choices a dropdown offered, as far as the failure message recorded them. */
export interface RecordedOptions {
  /** The option texts that were written down. Empty when none were. */
  options: string[];
  /** How many the control actually had, when the message said. */
  total: number | null;
  /** False when the message only listed the first few of a longer list. */
  complete: boolean;
}

const NO_OPTIONS: RecordedOptions = { options: [], total: null, complete: true };

/**
 * Read a dropdown's options back out of the recorded failure text.
 *
 * WHY THIS IS PARSING PROSE. The options a form offered are not stored as
 * data anywhere — `ShadowRun.outcomes` keeps a `detail` string written for a
 * human to read, and that sentence is the only surviving record that the
 * dropdown contained "Yes, No, I don't wish to answer". Recovering them
 * matters more than it sounds: an answer to a dropdown has to be one of ITS
 * words. "No thanks" is a perfectly good answer to the question and a useless
 * one to the form.
 *
 * Several wordings exist in the stored data, because the runner's message has
 * been rewritten over time and old runs keep the old text. All the shapes
 * actually present in this database are handled:
 *
 *   Dropdown. Your answer ("x") matched none of its 2 options: Yes, No
 *   Dropdown. Your answer ("x") matched none of its 73 options, e.g. A, B, C...
 *   Dropdown. Your answer ("x") is not one of: Associate's Degree, High School
 *
 * and the two that record no options at all fall through to an empty list:
 *
 *   Your answer ("No") does not match any of the offered options.
 *   This is a dropdown and none of its options match "x". Pick one yourself.
 *
 * KNOWN LIMIT, stated rather than hidden: the options were joined with ", "
 * and are split back on ", ", so an option containing a comma comes back as
 * two. Nothing in the stored text can tell the difference. This is why the
 * sheet prints them as a hint under the question rather than as a list to be
 * matched against mechanically — a person reads them, and a person can see
 * when one has been split oddly.
 */
export function optionsFromDetail(detail: string): RecordedOptions {
  // "...matched none of its N options: a, b, c" — the whole list.
  const full = /matched none of its (\d+) options:\s*(.+)$/s.exec(detail);
  if (full && full[2] !== undefined) {
    return { options: splitOptions(full[2]), total: Number(full[1]), complete: true };
  }

  // "...matched none of its N options, e.g. a, b, c..." — only the first few.
  const sample = /matched none of its (\d+) options,\s*e\.g\.\s*(.+?)\.\.\.\s*$/s.exec(detail);
  if (sample && sample[2] !== undefined) {
    return { options: splitOptions(sample[2]), total: Number(sample[1]), complete: false };
  }

  // The older wording, which always listed the lot and never counted them.
  const older = /is not one of:\s*(.+)$/s.exec(detail);
  if (older && older[1] !== undefined) {
    const options = splitOptions(older[1]);
    return { options, total: options.length, complete: true };
  }

  return NO_OPTIONS;
}

function splitOptions(list: string): string[] {
  return list
    .split(", ")
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
}

// ============================================================================
// ONE ENTRY ON THE SHEET
// ============================================================================

/** One employer that asked this question. */
export interface Asker {
  companyName: string;
  atsType: string;
}

/** Everything the file shows about one distinct question. */
export interface SheetEntry {
  /** The question exactly as the employer worded it. Never reworded. */
  question: string;
  /** The anchor written into the file, from `questionId`. */
  id: string;
  /** How many runs ran into this question. */
  runCount: number;
  /** Who asked it, deduplicated, in the order first seen. */
  askers: Asker[];
  /** True when at least one run listed it as a required field left empty. */
  blocking: boolean;
  /** The choices the form offered, when the failure message recorded them. */
  options: RecordedOptions;
  /** Why nothing filled it, in the runner's own words. */
  reason: string;
  /** Whether an answer here should be kept for future applications. */
  reuse: boolean;
  /** Why not, when `reuse` is false. Null when it is true. */
  noReuseReason: string | null;
}

/**
 * Why this codebase already refuses to keep an answer to this question, or
 * null when it does not refuse.
 *
 * This asks the EXISTING rules rather than inventing a second opinion:
 * `worthStoring` (../apply/ask-plan.ts) is what the live apply run consults
 * before writing to the answer bank, and the two helpers imported above are
 * how it explains itself. If the sheet defaulted a question to reusable and
 * the import then refused it, the person would have filled in a box for
 * nothing.
 *
 * `worthStoring` is passed in rather than imported. It lives in ../apply,
 * which is the browser-driving half of the app; taking it as an argument
 * keeps this module free of that dependency and lets a test state plainly
 * what the rule said. The one real caller always passes the real function.
 *
 * Note it is checked against EVERY employer that asked the question, not just
 * one. `worthStoring`'s company rule is "does the question name this
 * employer" — "Have you previously been employed by Coinbase?" is single-use
 * at Coinbase and would look perfectly reusable if checked against Stripe.
 * One employer objecting is enough, because the answer would be stored under
 * one flat key shared by all of them.
 */
export function noReuseReason(
  question: string,
  askers: Asker[],
  isWorthStoring: (question: string, companyName: string) => boolean,
): string | null {
  // The two specific, explainable cases first, so the line the person reads
  // names the real problem instead of a generic "not reusable".
  if (looksLikeFieldId(question)) {
    return "the form never gave this box a readable label, so what you see above is the form's own internal name for it — that name changes on every form, so a saved answer could never be matched to it again";
  }
  const ambiguous = ambiguousLabelReason(question);
  if (ambiguous !== null) return ambiguous;

  for (const asker of askers) {
    if (!isWorthStoring(question, asker.companyName)) {
      const company = asker.companyName.toLowerCase().trim();
      if (company.length > 2 && question.toLowerCase().includes(company)) {
        return `this question is about ${asker.companyName} specifically, so the answer would be wrong on the next company's form`;
      }
      return "this question is about one particular job posting, so the answer would be wrong on the next one";
    }
  }

  return null;
}

/**
 * Turn the recorded runs into the list of questions to put on the sheet.
 *
 * ORDER IS THE POINT. Questions that appear in some run's `blockingGaps` come
 * first: those are required fields left empty, which is the whole difference
 * between an application that could have been submitted and one that could
 * not. Within each group, most-asked first — answering a question that seven
 * forms ask is worth seven times what answering a one-off is. Alphabetical as
 * the final tie-break, purely so that running the export twice produces the
 * same file and a diff between them means something.
 *
 * NOTHING IS FILTERED OUT. Document uploads ("Resume", "Cover letter") end up
 * on the sheet even though there is nothing to type, and so do the fields the
 * codebase already refuses to reuse. That is deliberate: this file is the
 * person's view of everything standing between them and a submitted
 * application, and a tool that quietly drops rows it judged uninteresting is a
 * tool whose totals you cannot trust. Each one carries its reason — "Document
 * uploads are not built yet — attach this yourself" reads clearly as "leave
 * this blank" — and a blank answer is skipped on import.
 */
export function buildSheet(
  runs: SheetRun[],
  isWorthStoring: (question: string, companyName: string) => boolean,
): SheetEntry[] {
  /** Accumulator per distinct question text. */
  interface Draft {
    question: string;
    runCount: number;
    askers: Asker[];
    askerKeys: Set<string>;
    blocking: boolean;
    options: RecordedOptions;
    reason: string;
  }

  const drafts = new Map<string, Draft>();

  for (const run of runs) {
    const blockingHere = new Set(run.blockingGaps);

    // One run can list the same label twice (two education rows, say). The
    // question is counted once per run, so "7 runs" means seven forms rather
    // than seven boxes.
    const seenInThisRun = new Set<string>();

    for (const outcome of run.outcomes) {
      if (wasAnswered(outcome)) continue;

      const question = outcome.label;
      let draft = drafts.get(question);
      if (draft === undefined) {
        draft = {
          question,
          runCount: 0,
          askers: [],
          askerKeys: new Set(),
          blocking: false,
          options: NO_OPTIONS,
          reason: outcome.detail,
        };
        drafts.set(question, draft);
      }

      if (!seenInThisRun.has(question)) {
        seenInThisRun.add(question);
        draft.runCount += 1;

        const askerKey = `${run.companyName}|${run.atsType}`;
        if (!draft.askerKeys.has(askerKey)) {
          draft.askerKeys.add(askerKey);
          draft.askers.push({ companyName: run.companyName, atsType: run.atsType });
        }
      }

      if (blockingHere.has(question)) draft.blocking = true;

      // Prefer the reason that actually tells the person something. A failure
      // message naming the options beats "No stored answer matches this
      // question closely enough", which names nothing — so once a detail
      // carrying options is found it is kept, even if a later run recorded a
      // vaguer one for the same question.
      const options = optionsFromDetail(outcome.detail);
      if (options.options.length > draft.options.options.length) {
        draft.options = options;
        draft.reason = outcome.detail;
      }
    }
  }

  const entries: SheetEntry[] = [];
  for (const draft of drafts.values()) {
    const refusal = noReuseReason(draft.question, draft.askers, isWorthStoring);
    entries.push({
      question: draft.question,
      id: questionId(draft.question),
      runCount: draft.runCount,
      askers: draft.askers,
      blocking: draft.blocking,
      options: draft.options,
      reason: draft.reason,
      reuse: refusal === null,
      noReuseReason: refusal,
    });
  }

  entries.sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    if (a.runCount !== b.runCount) return b.runCount - a.runCount;
    return a.question.localeCompare(b.question);
  });

  return entries;
}

// ============================================================================
// WRITING THE FILE
// ============================================================================

/** How many employers to name before collapsing the rest into a count. */
const MAX_ASKERS_SHOWN = 3;

/** "Coinbase (greenhouse), Datadog (greenhouse) and 3 more". */
function describeAskers(askers: Asker[]): string {
  const shown = askers
    .slice(0, MAX_ASKERS_SHOWN)
    .map((asker) => `${asker.companyName} (${asker.atsType.toLowerCase()})`)
    .join(", ");
  const hidden = askers.length - MAX_ASKERS_SHOWN;
  return hidden > 0 ? `${shown} and ${hidden} more` : shown;
}

/** The options line, or null when the form's choices were never recorded. */
function describeOptions(options: RecordedOptions): string | null {
  if (options.options.length === 0) return null;

  const list = options.options.join(" | ");
  if (options.complete) return list;

  // Saying "the first 6 of 73" is the honest version. Printing six options
  // with no warning would read as the complete list and send someone looking
  // for their real answer among six choices out of seventy-three.
  return `${list}  (the first ${options.options.length} of ${options.total ?? "many"} — this form has more)`;
}

/**
 * The instructions at the top of the file.
 *
 * Written for the person who has to fill it in, not for a programmer. It says
 * what to type, what happens to blanks, and — the part that matters most —
 * that what they type is stored exactly as they typed it. That promise is not
 * decoration: it is the reason a legal or eligibility answer can be trusted
 * to this file at all.
 */
function header(entryCount: number, runCount: number, blockingCount: number): string {
  return [
    "# Answers the robot could not fill in",
    "",
    `These are the ${entryCount} questions that came up across ${runCount} practice runs and that`,
    "nothing on file could answer. Fill in the ones you can. You do not have to do them",
    "all, and you do not have to do them in one sitting.",
    "",
    "**How to fill this in**",
    "",
    "- Type your answer on the `ANSWER:` line, after the colon. Leave it empty to skip",
    "  that question — blank answers are ignored completely and nothing is written for them.",
    "- An answer can run over several lines. Everything between `ANSWER:` and the",
    "  `REUSE:` line below it counts as your answer.",
    "- If a question lists **options**, your answer has to be one of them, spelled the way",
    "  the form spells it. The form will not accept anything else.",
    "- `REUSE: yes` means the answer gets saved and used on future applications. Change it",
    "  to `REUSE: no` for an answer that is only true for this one job. Some questions are",
    "  already set to `no` — the line just above them says why.",
    "- Do not edit the `### Q:` headings or the `<!-- id: ... -->` lines. They are how your",
    "  answers get matched back to the right questions.",
    "- Some entries are things you cannot type an answer to at all, such as a resume",
    "  upload. They are listed anyway so the count is honest. Leave those blank.",
    "",
    "**What happens to what you type**",
    "",
    "Your answer is stored exactly as you typed it, character for character, with only",
    "blank space at the very start and end removed. Nothing rewords it, corrects its",
    "spelling, or fills in a blank on your behalf. These are facts about you, and this",
    "program is not allowed to make one up.",
    "",
    "**When you are done**",
    "",
    "```",
    "npm run answer-sheet -- --import answer-sheet.md           # shows what it would save",
    "npm run answer-sheet -- --import answer-sheet.md --commit  # actually saves it",
    "```",
    "",
    `${blockingCount} of the questions below say **blocks submission: yes**. Those are required`,
    "fields that were left empty, which means those applications could not have been sent",
    "at all. They are listed first for that reason.",
    "",
    "---",
    "",
  ].join("\n");
}

/** Render the whole sheet, ready to be written to disk. */
export function renderSheet(entries: SheetEntry[], runCount: number): string {
  const blockingCount = entries.filter((entry) => entry.blocking).length;
  const parts = [header(entries.length, runCount, blockingCount)];

  for (const entry of entries) {
    const lines = [
      `### Q: ${entry.question}`,
      `<!-- id: ${entry.id} -->`,
      `- asked by: ${describeAskers(entry.askers)} — ${entry.runCount} run${entry.runCount === 1 ? "" : "s"}`,
      `- blocks submission: ${entry.blocking ? "yes" : "no"}`,
    ];

    const options = describeOptions(entry.options);
    if (options !== null) lines.push(`- options: ${options}`);

    lines.push(`- why it failed: ${entry.reason}`);

    if (entry.noReuseReason !== null) {
      lines.push(`- not saved for reuse: ${entry.noReuseReason}`);
    }

    lines.push("ANSWER:");
    lines.push(`REUSE: ${entry.reuse ? "yes" : "no"}`);
    lines.push("");

    parts.push(lines.join("\n"));
  }

  return `${parts.join("\n")}\n`;
}

// ============================================================================
// READING THE FILE BACK
// ============================================================================

/** One filled-in block, exactly as it was read. Nothing interpreted yet. */
export interface ParsedAnswer {
  id: string;
  /** The heading text found above the id, kept for error messages. */
  question: string;
  /** What was typed, trimmed of surrounding whitespace and nothing else. */
  answer: string;
  /** What the REUSE line said. Null when the line was missing or unreadable. */
  reuse: boolean | null;
  /** Line number of the `### Q:` heading, 1-based, for error messages. */
  line: number;
}

/**
 * Read the filled-in file back into blocks.
 *
 * Deliberately forgiving about everything except the two things that carry
 * meaning. It does not care about blank lines, about the order of the `- ...`
 * detail lines, about extra prose someone pasted in, or about the header. It
 * cares about the id comment and the `ANSWER:` line, because those are what
 * say "this answer belongs to that question".
 *
 * MULTI-LINE ANSWERS. Everything after `ANSWER:` — on that line and on every
 * line after it — belongs to the answer, up to the `REUSE:` marker, the next
 * `### Q:` heading, or the end of the file. So a paragraph works with no
 * escaping and no quoting, which matters because "why are you interested in
 * this role?" does not fit on one line.
 *
 * A COLON IN THE ANSWER is a non-issue by construction: everything after the
 * first colon on the `ANSWER:` line is taken whole, so "9:30am: whenever you
 * need me" survives intact.
 *
 * A block with no `ANSWER:` line at all comes back with an empty answer and is
 * dropped later like any other blank — someone deleting a line they did not
 * want to answer should not produce an error message.
 */
export function parseSheet(markdown: string): ParsedAnswer[] {
  const lines = markdown.split(/\r?\n/);
  const answers: ParsedAnswer[] = [];

  let index = 0;
  while (index < lines.length) {
    const heading = /^###\s+Q:\s*(.*)$/.exec(lines[index] ?? "");
    if (heading === null) {
      index += 1;
      continue;
    }

    const question = (heading[1] ?? "").trim();
    const headingLine = index + 1;
    index += 1;

    let id: string | null = null;
    let reuse: boolean | null = null;
    const answerLines: string[] = [];
    let collecting = false;

    // Walk forward to the next heading, gathering the pieces.
    while (index < lines.length && !/^###\s+Q:/.test(lines[index] ?? "")) {
      const line = lines[index] ?? "";

      if (collecting) {
        const marker = /^REUSE:\s*(.*)$/.exec(line);
        if (marker !== null) {
          const word = (marker[1] ?? "").trim().toLowerCase();
          // Anything other than a clear yes or no leaves this null and the
          // caller decides. Guessing at a half-typed marker is exactly the
          // kind of invention this file is not allowed to do.
          reuse = word === "yes" ? true : word === "no" ? false : null;
          collecting = false;
          index += 1;
          continue;
        }
        answerLines.push(line);
        index += 1;
        continue;
      }

      const idLine = /^<!--\s*id:\s*([0-9a-f]+)\s*-->/.exec(line.trim());
      if (idLine !== null && idLine[1] !== undefined) {
        id = idLine[1];
        index += 1;
        continue;
      }

      const answerLine = /^ANSWER:(.*)$/.exec(line);
      if (answerLine !== null) {
        answerLines.push(answerLine[1] ?? "");
        collecting = true;
        index += 1;
        continue;
      }

      index += 1;
    }

    // No id comment means this heading is not one of ours — someone's own
    // notes, or a block whose anchor was deleted. There is nothing to attach
    // an answer to, so it is passed over rather than guessed at.
    if (id === null) continue;

    answers.push({ id, question, answer: answerLines.join("\n").trim(), reuse, line: headingLine });
  }

  return answers;
}

// ============================================================================
// DECIDING WHAT TO DO WITH EACH ANSWER
// ============================================================================

/** What already sits in the answer bank, for the create-or-update decision. */
export interface ExistingAnswer {
  id: string;
  question: string;
  answer: string;
}

/** One decided action. Exactly one of these per filled-in block. */
export interface ImportDecision {
  /** The question as the sheet knows it, or the heading text if unmatched. */
  question: string;
  answer: string;
  /**
   * - `create` — no row for this question yet, one will be written
   * - `update` — a row exists with a different answer, it will be replaced
   * - `unchanged` — a row exists with exactly this answer, nothing to do
   * - `skip` — nothing will be written; `reason` says why
   */
  action: "create" | "update" | "unchanged" | "skip";
  /** Always set for `skip`, `update` and `unchanged`. Null for `create`. */
  reason: string | null;
  /** What is in the bank right now, for `update` and `unchanged`. */
  previousAnswer: string | null;
  /** The existing row's database id, for `update`. */
  existingId: string | null;
  /** Whether this would be flagged as a legal/eligibility answer. */
  isLegal: boolean;
}

/**
 * Is this a legal or eligibility question?
 *
 * DUPLICATED ON PURPOSE, and this is the note saying so. The original is
 * `isLegalQuestion` in `../apply/run-application.ts`, which is where the live
 * apply run sets this same flag when it saves an answer mid-application. It is
 * not exported, and that file could not be imported from here in any case: it
 * pulls in the whole Playwright browser stack, which would drag a browser into
 * this module's unit tests and into a script whose entire job is reading a
 * text file. The rule itself lives in `./concepts`, so what is copied here is
 * a list of five concept names rather than any real logic.
 *
 * If that list ever changes, change it in both places. The flag has to agree:
 * it is what stops the AI rewording an answer about work authorization, and a
 * row written from this sheet must be protected exactly as well as a row
 * written by the apply run.
 */
export function isLegalQuestion(question: string): boolean {
  const concept = conceptOf(question);
  return (
    concept === "work-authorization" ||
    concept === "sponsorship" ||
    concept === "age-18" ||
    concept === "security-clearance" ||
    concept === "criminal-record"
  );
}

/**
 * Work out what would happen for every filled-in block, writing nothing.
 *
 * The caller prints this and stops (a dry run) or prints it and performs it
 * (`--commit`). Both use the same list, so what a dry run shows is exactly
 * what a commit does — there is no second code path that could disagree.
 *
 * Every rejection produces a `skip` carrying a sentence explaining it.
 * Nothing is dropped quietly. The person filled in a box; if their answer is
 * not going to be stored they are entitled to know that, and why.
 */
export function planImport(
  parsed: ParsedAnswer[],
  entries: SheetEntry[],
  existing: ExistingAnswer[],
  isWorthStoring: (question: string, companyName: string) => boolean,
): ImportDecision[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const byQuestion = new Map(existing.map((row) => [row.question, row]));

  // Two blocks carrying the same id. Usually a copy-paste while filling the
  // file in; the question is which answer was meant. If they agree there is
  // nothing to decide, and if they disagree neither is written — picking the
  // first would be choosing one of the person's answers on their behalf, and
  // that is not a choice this program gets to make.
  const conflicting = new Set<string>();
  const firstAnswerById = new Map<string, string>();
  for (const block of parsed) {
    if (block.answer.length === 0) continue;
    const seen = firstAnswerById.get(block.id);
    if (seen === undefined) firstAnswerById.set(block.id, block.answer);
    else if (seen !== block.answer) conflicting.add(block.id);
  }

  const decisions: ImportDecision[] = [];
  const handled = new Set<string>();

  for (const block of parsed) {
    // A blank answer is a question the person chose not to answer. That is a
    // normal, expected thing to do and is not reported as a problem.
    if (block.answer.length === 0) continue;

    const entry = byId.get(block.id);

    if (entry === undefined) {
      decisions.push({
        question: block.question,
        answer: block.answer,
        action: "skip",
        reason: `no question in the review queue has the id "${block.id}" (line ${block.line}) — the heading or the id line may have been edited, or those runs have since been reviewed`,
        previousAnswer: null,
        existingId: null,
        isLegal: false,
      });
      continue;
    }

    if (conflicting.has(block.id)) {
      // Reported once, against the first copy, rather than once per copy.
      if (handled.has(block.id)) continue;
      handled.add(block.id);
      decisions.push({
        question: entry.question,
        answer: block.answer,
        action: "skip",
        reason: `this question appears more than once in the file with different answers (first at line ${block.line}) — nothing was written, because there is no way to tell which one you meant. Delete the copy you do not want and run it again`,
        previousAnswer: null,
        existingId: null,
        isLegal: isLegalQuestion(entry.question),
      });
      continue;
    }

    // A duplicate that agrees with itself is simply the same answer twice.
    if (handled.has(block.id)) continue;
    handled.add(block.id);

    // A missing or unreadable REUSE line falls back to the default the export
    // wrote for that question, which is what the file told the person it was.
    const reuse = block.reuse ?? entry.reuse;

    if (!reuse) {
      decisions.push({
        question: entry.question,
        answer: block.answer,
        action: "skip",
        reason:
          entry.reuse
            ? "marked REUSE: no — kept out of the answer bank as you asked, so it will not be reused on another application"
            : `not reusable: ${entry.noReuseReason ?? "this answer is specific to one application"}`,
        previousAnswer: null,
        existingId: null,
        isLegal: isLegalQuestion(entry.question),
      });
      continue;
    }

    // The same gate the live apply run puts every answer through before it
    // writes one. Checked again here rather than trusting what the export
    // decided, because the file may have been generated days ago.
    const refusal = noReuseReason(entry.question, entry.askers, isWorthStoring);
    if (refusal !== null) {
      decisions.push({
        question: entry.question,
        answer: block.answer,
        action: "skip",
        reason: `not reusable: ${refusal}`,
        previousAnswer: null,
        existingId: null,
        isLegal: isLegalQuestion(entry.question),
      });
      continue;
    }

    const isLegal = isLegalQuestion(entry.question);
    const row = byQuestion.get(entry.question);

    if (row === undefined) {
      decisions.push({
        question: entry.question,
        answer: block.answer,
        action: "create",
        reason: null,
        previousAnswer: null,
        existingId: null,
        isLegal,
      });
      continue;
    }

    if (row.answer === block.answer) {
      decisions.push({
        question: entry.question,
        answer: block.answer,
        action: "unchanged",
        reason: "already stored with exactly this answer",
        previousAnswer: row.answer,
        existingId: row.id,
        isLegal,
      });
      continue;
    }

    decisions.push({
      question: entry.question,
      answer: block.answer,
      action: "update",
      reason: "replaces the answer already stored for this question",
      previousAnswer: row.answer,
      existingId: row.id,
      isLegal,
    });
  }

  return decisions;
}

/** Counts for the closing summary. Truthful by construction: one list, one tally. */
export interface ImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export function summarize(decisions: ImportDecision[]): ImportSummary {
  return {
    created: decisions.filter((decision) => decision.action === "create").length,
    updated: decisions.filter((decision) => decision.action === "update").length,
    unchanged: decisions.filter((decision) => decision.action === "unchanged").length,
    skipped: decisions.filter((decision) => decision.action === "skip").length,
  };
}
