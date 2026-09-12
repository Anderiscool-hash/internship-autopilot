# Answer bank label collisions

## The concrete failure

A previous agent was told to update the candidate's employment record after
the user said "the employment is wrong i started in july 2025 and it is my
current role." It correctly updated the `WorkExperience` row (company "La
gran Familia Grocery corp.", title "Security Manager", start 2025-07-01,
`isCurrent: true`) — that part was right and is user-confirmed.

But it also found an `AnswerBankEntry` row with `question: "Start date
month"` and changed its `answer` from `"08"` to `"07"`, on the theory that
this must be the same start date. It wasn't. The row that got overwritten
sits next to:

```
Start date month  => "08"  (the user's own typed answer, overwritten)
Start date year   => "2027"
End date month     => "09"
End date year      => "2029"
"When is your graduation date (actual or expected)?"                          => "2029"
"If you are currently enrolled ... expected graduation date?"                  => "Spring 2029"
```

A span from August 2027 to September 2029, next to a 2029 graduation date,
is a degree program, not a job that started in July 2025. The agent matched
on question text alone ("Start date month" == "Start date month") and had no
way to know it was looking at the wrong section's answer. This has been
reverted (see below); the point of this document is that the same class of
bug will recur, quietly, with generic labels.

## Why this is a design flaw, not a one-off mistake

`AnswerBankEntry` (`prisma/schema.prisma`) is:

```
model AnswerBankEntry {
  id          String
  candidateId String
  question    String   // the ONLY thing matching keys on
  answer      String
  confidence  Int?
  isLegal     Boolean
  isStandard  Boolean
  ...
}
```

There is no `section`, `context`, `sourceJobId`, or anything else that
records *where* an answer came from. Matching (`src/lib/answers/match.ts`)
confirms this is not an oversight elsewhere in the pipeline — it's the whole
design:

- `findAnswer()` first tries `sameQuestion()` (from `src/lib/answers/
  concepts.ts`), which recognizes a fixed list of ~18 *legal/EEO* concepts
  (sponsorship, work authorization, veteran status, etc.) by regex, with
  optional scope-checking (e.g. "authorized to work in the US" vs "...in
  this country" are treated as different questions). This is careful and
  deliberately narrow — it exists specifically to avoid the "same words,
  different question" failure. But generic profile-shape labels like "Start
  date month," "Company name," "Title," "School," "Degree" are not concepts
  at all — `conceptOf()` returns `null` for all of them.
- When no concept matches, `findAnswer()` falls back to plain Jaccard
  word-overlap similarity (`questionSimilarity`) against a 0.8 threshold. Two
  fields with the *literally identical* label text score 1.0 — a guaranteed
  match — regardless of what section either one lives in. For a label like
  "Start date month," which is short, generic, and reused verbatim by
  different ATS form sections, this is the whole matching story: identical
  text in, same stored answer out, every time.

So the concept layer — the one piece of this system built specifically to
prevent "same words, different meaning" — was deliberately scoped to legal
questions and never extended to structural/profile-shape fields, because
those weren't expected to collide. They do.

## What the DOM actually offers, and what gets thrown away

`src/lib/apply/read-form.ts` (`readFields()`) reads each field's label the
way a screen reader would: `<label for>`, `aria-label`, the nearest
`fieldset > legend` (for radio/checkbox groups), `aria-describedby`, or — as
a last resort — a 5-level walk up the DOM looking for the nearest `label` or
`legend` text (`ancestorLabel`).

Concretely, per field the parser captures: `rawLabel` → `label`, `elementId`,
`groupName` (radio-group / `name` attribute), `inputType`, `options`,
`required`. That's it. Once `cleanLabel()` and `classifyFieldLabel()` run,
everything is flattened into a single `ParsedField { label, kind, required,
answered }` — a flat list, order preserved, with no parent/section
reference at all.

What is *not* captured, even though it is sitting right there in the DOM
during the same read:
- Section headings (`<h2>Education</h2>`, `<h3>Employment</h3>`, or
  Greenhouse's own section wrapper divs) — the ancestor walk only looks for
  `legend, label`, never `h1`–`h6` or a section container's own heading.
- Which repeated block a field belongs to, when a form has multiple entries
  of the same kind (a second job, a second degree) — `groupName` is only
  used for radio-button collapsing, not for tagging a whole block.
- Any stable identifier tying "Company name" in block A to "Company name" in
  block B as different instances.

Practically, this means the disambiguating context *is available at read
time* — the page has visible "Education" and "Employment" headings, and the
fields sit inside clearly distinct DOM containers — but `read-form.ts`
throws it away before the field ever reaches the matcher. By the time
`findAnswer()` runs, all it has is the string `"Start date month"` twice,
with nothing left to tell them apart.

## Real evidence from `ShadowRun.outcomes`

I queried all 32 `ShadowRun` rows (all real Greenhouse forms opened by the
shadow-apply worker) and printed each run's field list in page order. The
label collision is not hypothetical — it's already happening across
different real employers' forms:

**Coinbase — Accelerations Programs Intern** (and this exact sequence
repeats across ~14 separate Coinbase shadow runs):
```
[9]  Company name
[10] Title
[11] Start date month   <- EMPLOYMENT block
[12] Start date year
[13] End date month
[14] End date year
[15] Current role
[16] School
[17] Degree
[18] Discipline
```
Here "Start date month" / "Start date year" / "End date month" / "End date
year" sit between "Title" and "Current role" — unambiguously the employment
entry's dates.

**Datadog — Software Engineering Intern (Winter)**:
```
[7]  School
[8]  Degree
[9]  Start date month   <- EDUCATION block (no employment fields on this form at all)
[10] Start date year
[11] End date month
[12] End date year
[13] When is your graduation date (actual or expected)?
```
Same four labels, verbatim — "Start date month," "Start date year," "End
date month," "End date year" — but here they immediately follow School/
Degree with no Company name/Title fields anywhere on the form. These are the
degree program's dates.

**Stripe — Software Engineer, Intern**:
```
[8]  School
[9]  Degree
[10] Discipline
[11] Start date year    <- EDUCATION again, and note: no "month" field at all here
```
A third shape again: same "Start date year" label, education meaning, but
this particular form only asks for the year, not the month — so even the
*set* of colliding labels varies per form, not just their meaning.

**Stripe — People Partner, Technology** (for contrast — a form that avoids
the collision entirely by using different wording):
```
[8]  School
[9]  Degree
[10] Have you ever been employed by Stripe or a Stripe affiliate?
[11] Who is your current or previous employer?
[12] What is your current or previous job title?
```
This form's employment questions don't collide with anything, because they
happen to be phrased distinctly. That's the only thing currently preventing
a collision on any given form — luck in the employer's own wording.

Given `AnswerBankEntry` is keyed by `candidateId + question` text with no
section key, one stored `"Start date month"` answer is shared across *every*
form the candidate applies to, Coinbase's employment-dates form and
Datadog's education-dates form alike. The exact scenario that corrupted the
user's data — an education answer overwritten in the belief it was an
employment answer, or vice versa — is not a one-time fluke; it's the modal
outcome any time an employer's form asks the same generic question in two
different sections, which real Greenhouse forms in this candidate's own
history already do.

### Labels at risk (from real forms observed)

- `Start date month`, `Start date year`, `End date month`, `End date year` —
  confirmed colliding (education vs. employment) across real Coinbase vs.
  Datadog/Stripe forms above.
- `Company name`, `Title` — used by Coinbase's employment block; not
  observed colliding on another form in this data set, but nothing prevents
  a different employer's *education* block (e.g., "institution/employer"
  wording, or a training/research entry) from reusing them.
- `School`, `Degree`, `Discipline` — currently only seen in education
  contexts here, but generic enough (e.g., a "training program" or
  "certification" block) that they are one form redesign away from
  colliding too.
- Any field the auto-detected `AnswerBankEntry.isStandard = true` treats as
  reusable "across companies" is, by construction, exactly the kind of label
  this bug hits — the whole point of marking it standard is to reuse the
  stored value on the next form, without regard to which section that next
  form's copy of the label sits in.

## Design options

**1. Store a section/context key alongside the question, and match on
`(question, context)` instead of `question` alone.**

`read-form.ts` would need to capture and pass along the nearest section
heading (an `h1`–`h6`, or a known ATS section wrapper like Greenhouse's own
"Education"/"Employment" containers) as part of the field, and
`AnswerBankEntry` would gain a `context` (or `section`) column. Matching
would then require the stored context to be compatible with the asked
field's context, not just the question text.

- Pro: this is the structurally correct fix — it attacks the actual root
  cause (no section key exists at all) rather than working around it.
- Con: real work, and it touches the schema plus both files the other
  agents currently own (`match.ts`, `concepts.ts`) plus `read-form.ts`.
  Section headings are also not perfectly reliable across every ATS —
  Greenhouse consistently uses them for Education/Employment, but a
  custom-built ATS might not, so this reduces but does not eliminate the
  risk; a form with no discoverable heading falls back to the current
  behavior.

**2. Refuse to reuse a stored answer for any label on a known-ambiguous
list, and always ask.**

Maintain a small denylist of labels known to be reused across sections —
starting with the four confirmed above — and have `findAnswer()` return
`null` for them unconditionally, exactly as it already does for anything
under the 0.8 threshold. The existing behavior ("unknown answers pause
automation rather than being invented," per `match.ts`'s own stated design
principle) already treats "I'm not sure" as a hard stop; this just adds
"I'm sure this label is ambiguous" as another reason to stop.

- Pro: small, safe, matches the codebase's existing conservative philosophy
  almost exactly — no new schema, no new context-capture plumbing. Ships
  fast and forecloses the exact failure that already happened.
- Con: doesn't fix the underlying problem, just contains it to a hand-
  maintained list that has to be extended by hand as new collisions are
  discovered (as this document did for `Start/End date month/year`); a
  fifth colliding label on some future employer's form will silently reuse
  the wrong answer until someone notices, same as this one did.

**3. Ask the person every time for labels on a known-ambiguous list, but
remember the answer per-section rather than not at all.**

A middle path between 1 and 2: keep a denylist like option 2, but instead of
refusing forever, store the answer keyed by `(question, nearest section
heading)` only for labels on that list — leaving every other label's
existing single-key behavior untouched. This gets most of option 1's
precision for the handful of labels that actually collide, without a
blanket schema change or rewriting the matcher for every question.

- Pro: scoped risk — only the labels known to be dangerous get the extra
  machinery; everything else in `match.ts`/`concepts.ts` is unaffected, so
  it doesn't step on the section-key change other agents may eventually want
  more broadly. Reuses work from both other options (the denylist from #2,
  a narrow slice of the context-capture from #1).
- Con: two different matching behaviors for two different label
  categories is more to reason about than either option alone. Still
  depends on `read-form.ts` being able to find a section heading — the same
  imperfect signal as option 1, just used for fewer labels.

## Recommendation

Ship **option 2 first, option 3 next**, not option 1 as a first step.

Option 2 is the fix that directly answers "how do we make sure this never
submits a wrong answer to a real employer again," and it can ship without
touching `read-form.ts`, the schema, or the two files other agents currently
own beyond adding a constant list. Given `match.ts`'s own stated design
principle — pausing for a human is cheap, a confidently wrong answer on a
real application is not — refusing to guess on a label already proven
ambiguous is the same tradeoff the file already makes everywhere else, just
applied to one more case. It should ship with the four confirmed labels
(`Start date month`, `Start date year`, `End date month`, `End date year`)
denylisted immediately, since those are proven, not hypothetical.

Option 3 is worth doing as a near-term follow-up once the denylist exists,
because option 2 alone means the person gets asked the same question on
every single application forever, which will get old fast for a label that
comes up on nearly every form. Option 3 turns that repeated interruption
into a one-time-per-section cost.

Option 1 (the general section-aware schema) is the right eventual shape of
this system, but it's a bigger change with a real gap (unreliable section
headings on some ATS platforms) that doesn't fully close the risk anyway —
so it shouldn't gate shipping the narrow, provably-correct fix first. This
is a call for the user to make, not something to implement here.
