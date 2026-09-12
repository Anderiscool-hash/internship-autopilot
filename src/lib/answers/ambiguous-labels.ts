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
