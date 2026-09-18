/**
 * Labels that must never be answered from the answer bank, because the same
 * label text is reused by real application forms to mean different things in
 * different sections.
 *
 * See docs/findings/answer-bank-label-collisions.md for the full
 * investigation. Short version: `AnswerBankEntry` is keyed on question TEXT
 * alone (`candidateId + question`, `prisma/schema.prisma`), with no column
 * recording which section of a form the answer came from. Word-overlap
 * matching (`../answers/match.ts`) gives two fields with identical label text
 * a guaranteed 1.0 score regardless of what section either one lives in — so
 * a label reused verbatim by two different sections shares one stored answer
 * between them, whether that is correct or not.
 *
 * THE EVIDENCE (from `ShadowRun.outcomes`, 33 real Greenhouse form runs, and
 * one live measurement run against the real Coinbase form):
 *
 *   Coinbase — Accelerations Programs Intern (field order, ~14 shadow runs):
 *     [9]  Company name
 *     [10] Title
 *     [11] Start date month   <- EMPLOYMENT block (sits between Title and
 *     [12] Start date year       Current role — no education field anywhere
 *     [13] End date month        near it)
 *     [14] End date year
 *     [15] Current role
 *     [16] School
 *     [17] Degree
 *
 *   Datadog — Software Engineering Intern (Winter):
 *     [7]  School
 *     [8]  Degree
 *     [9]  Start date month   <- EDUCATION block (this form has no
 *     [10] Start date year       employment fields at all)
 *     [11] End date month
 *     [12] End date year
 *
 *   Stripe — Software Engineer, Intern:
 *     [8]  School
 *     [9]  Degree
 *     [10] Discipline
 *     [11] Start date year    <- EDUCATION again, and note: no "month" field
 *                                 at all on this particular form
 *
 * Given that, the AnswerBankEntry rows actually observed in this candidate's
 * database (`Start date month => "08"`, `Start date year => "2027"`,
 * `End date month => "09"`, `End date year => "2029"`) are the candidate's
 * DEGREE dates (August 2027 - September 2029, next to a 2029 graduation
 * date). A live measurement run against the real Coinbase form on
 * 2026-09-12 confirmed the failure is not hypothetical: `buildFillPlan`
 * pulled those same four rows out of the answer bank and used them to fill
 * Coinbase's EMPLOYMENT date fields, which would have told a real employer
 * the candidate's job at "La gran Familia Grocery corp." ran August 2027 to
 * September 2029 — a job that actually started July 2025 and has not ended.
 * This is the same class of bug that already corrupted this candidate's data
 * once (see the findings doc's "concrete failure" section): an agent
 * overwrote a stored "Start date month" believing it was updating the job's
 * start date, when the row actually held the education one.
 *
 * WHY A DENYLIST AND NOT A GUESS: there is no reliable way to tell, from the
 * label text alone, which section a *future* form's copy of one of these
 * labels belongs to — Coinbase, Datadog and Stripe each put them in a
 * different place. Refusing to reuse a stored answer here is the same
 * tradeoff `../answers/match.ts` already makes for a low-similarity match:
 * "pausing for a person is cheap; a confidently wrong answer on a real
 * application is not." This list exists to apply that same rule to labels we
 * are now SURE are ambiguous, rather than merely unsure are a match.
 *
 * SCOPE: this list is deliberately short and evidence-backed rather than
 * exhaustive. `Company name`, `Title`, `School`, `Degree` and `Discipline`
 * are flagged in the findings doc as generic enough to collide on some future
 * form, but were not observed colliding in the data available when this was
 * written — see the findings doc's "Labels at risk" section. Add to this list
 * only when a real form provides the evidence, the same way these four were
 * added.
 */

/** One denylisted label, with the evidence for why it is here. */
interface AmbiguousLabel {
  /** Matches the label after trimming, case-insensitively, as a whole string
   * — not a substring — so this never swallows a differently-worded
   * question that happens to contain these words (e.g. Stripe's "What is
   * your current or previous job title?", which is answerable from the
   * profile and must stay that way). */
  pattern: RegExp;
  /** Shown to the person in place of the field, so they know WHY nothing
   * was filled rather than just that nothing was. */
  reason: string;
}

const AMBIGUOUS_LABELS: AmbiguousLabel[] = [
  {
    pattern: /^start date month$/i,
    reason:
      'This form calls it "Start date month," but that exact label means different things on different employers’ forms — Coinbase asks it for your employment start date, Datadog and Stripe ask the identical label for your education start date. A saved answer for one would be wrong for the other, so this needs your own input.',
  },
  {
    pattern: /^start date year$/i,
    reason:
      'This form calls it "Start date year," but that exact label means different things on different employers’ forms — Coinbase asks it for your employment start date, Datadog and Stripe ask the identical label for your education start date. A saved answer for one would be wrong for the other, so this needs your own input.',
  },
  {
    pattern: /^end date month$/i,
    reason:
      'This form calls it "End date month," but that exact label means different things on different employers’ forms — Coinbase asks it for your employment end date, Datadog asks the identical label for your education end date. A saved answer for one would be wrong for the other, so this needs your own input.',
  },
  {
    pattern: /^end date year$/i,
    reason:
      'This form calls it "End date year," but that exact label means different things on different employers’ forms — Coinbase asks it for your employment end date, Datadog asks the identical label for your education end date. A saved answer for one would be wrong for the other, so this needs your own input.',
  },
];

/**
 * Why a label must not be answered from the answer bank, or null when it is
 * not one of the labels proven to collide.
 *
 * Matched on the label text alone — the same thing `findAnswer` matches on —
 * because that is genuinely all either has to go on; see the file comment for
 * why a whole-string match rather than a fuzzy one.
 */
export function ambiguousLabelReason(label: string): string | null {
  const trimmed = label.trim();
  for (const entry of AMBIGUOUS_LABELS) {
    if (entry.pattern.test(trimmed)) return entry.reason;
  }
  return null;
}

/* ============================================================================
   Labels that are not questions at all
   ============================================================================

   The denylist above is about labels a human *did* write that mean two
   different things. This next one is a different problem with the same
   remedy: a "label" no human wrote at all.

   Where it comes from: the form reader takes an input's visible label when it
   can find one, and falls back to the input's `name` attribute when it
   cannot. That fallback is right for filling — `name` is how the field gets
   submitted — but it is wrong for *remembering*, because `../apply/ask-plan.ts`
   stores `field.label` as the question. When the fallback fires, the machine
   id becomes the stored "question", and four such rows are sitting in this
   candidate's answer bank right now:

     cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]  =>  "2029"
     cards[7736d0ea-6916-4d17-8895-c31776dbef15][field0]  =>  "Forward Deployed…"
     cards[841c3f3c-3e6e-4665-9391-e360210fb5ee][field0]  =>  "September 2026"
     cards[877379a1-2abf-4eab-9c51-81e7b5828b3e][field0]  =>  "Yes"

   Why such a row is worse than useless. Matching is on question TEXT
   (`./match.ts`), and those uuids are generated per form, per session — the
   next form's version of the same field carries a different uuid, so the
   stored row can never match anything again as long as it exists. It is dead
   weight that cannot pay off. And because `/answers` renders the stored
   question as the field's label, it leaks straight through to the person,
   who is asked `cards[026d7ce7-…][field0]` as though it were a question.

   Refusing to store one is the same judgement `worthStoring` already makes
   three times over: a row that can only ever be wrong, or can never be right,
   is not worth having.

   SCOPE, same doctrine as the list above: match only shapes that are
   unmistakably machine-generated, and let anything doubtful through. A false
   positive here silently drops a real answer a person typed, which is far
   worse than keeping one junk row — so nothing containing a space is ever
   caught, and no heuristic about "looks technical" is applied. Real stored
   questions this must keep its hands off include "Are you legally authorized
   to work in the United States?", "Will you now or in the future require
   sponsorship for employment visa status?", "Start date month" and "How did
   you hear about us?". */

/** Words an ATS uses to number an unlabelled input: `field0`, `input_2`. */
const FIELD_ID_WORDS = "field|input|question|answer|entry|item|element|q";

/**
 * Does this "question" look like a form's internal field id rather than
 * something a person wrote?
 *
 * Shared deliberately: `../apply/ask-plan.ts` uses it to refuse to store new
 * ones, and `/answers` uses it to pull the existing ones out of the list of
 * real questions. One definition, so the page and the apply path cannot come
 * to different conclusions about the same row.
 */
export function looksLikeFieldId(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length === 0) return false;

  // Bracket subscript syntax, the shape every one of the four real examples
  // takes: a name followed by one or more `[...]` groups, with no spaces
  // anywhere — `cards[026d7ce7-…][field0]`, `job_application[answers][3]`.
  // A written question does not look like this; nothing in the 69 stored
  // rows that a person actually worded contains a bracket at all.
  if (/^[A-Za-z_][A-Za-z0-9_.-]*(?:\[[^\]\s]*\])+$/.test(trimmed)) return true;

  // Past this point, anything with whitespace in it is prose — a real
  // question, however oddly worded — and is left alone unconditionally.
  if (/\s/.test(trimmed)) return false;

  // A bare numbered input: `field0`, `input_2`, `question-7`, `answer.3`.
  // Anchored whole-string, so a genuine one-word label is untouched and a
  // question merely *containing* the word "question" is not a candidate.
  if (new RegExp(`^(?:${FIELD_ID_WORDS})[-_.]?\\d+$`, "i").test(trimmed)) return true;

  // A bare uuid, or a long run of hex — an id pasted in with no name at all.
  // Sixteen hex characters is the floor on purpose: eight would catch a real
  // (if unlikely) word, and no English label is sixteen unbroken hex digits.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return true;

  return false;
}
