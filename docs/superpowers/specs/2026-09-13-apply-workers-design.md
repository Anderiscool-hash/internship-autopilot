# Apply Workers — Design (spec §20–23)

**Date:** 2026-09-13
**Status:** Approved in brainstorming; not yet implemented.
**Covers:** spec §21 (adapter trust levels), §22 (Playwright application workers),
and the unreached tail of §23 (the state machine's `APPLYING` onward).

---

## The problem

Shadow mode (§20) is complete. It opens a job's application form, fills it from
the candidate profile, answer bank and documents, records a `ShadowRun` row with
a screenshot, and collects a human `correct`/`wrong` verdict against it.

What it cannot do is apply. Submission is blocked at the network layer: while
`runShadowApply` drives the page, every request that is not a GET is aborted.
That is not an oversight, it is the design — `src/lib/apply/shadow.ts` argues at
length that "we simply never wrote a click" is an absence rather than a
guarantee, because a stray Enter keypress submits most forms.

So `ApplicationStatus.APPLYING` and everything after it is unreachable. Nothing
in the repository can send an application.

## The constraint everything else follows from

An application cannot be submitted without a POST. The submit guard aborts every
POST. Therefore **there is no way to add submission that does not touch the
guard.** The only open question is how, and the answer determines whether the
existing safety property survives.

The property worth keeping is precise: *a defect anywhere in the ~1,100 lines of
filling logic cannot cause an application to be sent.* Today that holds because
the fill path runs with the guard armed unconditionally.

## Decision: submit as a separate authorized phase

Rejected alternatives, for the record:

- **An `allowSubmit` flag threaded into `runShadowApply`.** One code path, fewer
  moving parts — but the routine that fills becomes the routine that can submit,
  and the property above is gone. Any mis-ordered await or stray keypress during
  filling becomes a live application. This is the exact failure the guard was
  written to prevent.
- **A second process that reopens the form from saved state and submits.**
  Maximum isolation, but it must re-fill from a restored session, doubling the
  fragile surface for no safety gain over the chosen approach.

**Chosen:** filling and submitting are separate phases. `runShadowApply` keeps
its guard unconditionally and its semantics unchanged. Submission is a distinct,
separately authorized act that runs only after filling has fully completed.

This mirrors the existing `handoff` mode, which already lifts the guard only
after every field is filled — an established pattern here, not a new one.

---

## 1. The submit phase

New module: `src/lib/apply/submit.ts`.

The guard-lift itself stays **inside `shadow.ts`** as a narrow internal
function. `submit.ts` decides *whether* to submit and detects the outcome; it
cannot perform a lift on its own. The guard never leaves the file that
documents it.

### Gates

All are re-evaluated immediately before the lift — not earlier in the run. The
form may have changed under us, and a gate checked thirty seconds ago is a
statement about a page that no longer exists.

1. `blockingGaps.length === 0`
2. No CAPTCHA detected
3. No login wall detected
4. Zero field outcomes with status `failed`
5. Confidence ≥ `rules.minimumApplicationConfidence` (§17, §18)
6. The adapter resolves **exactly one** submit button — zero or several means
   the page is not what the adapter thinks it is
7. An explicit authorization record supplied by the caller

Gate 7 is a value, never a boolean defaulting to true. It carries who or what
authorized this submission and when, and it is written to the attempt row.

### The lift

Scoped as narrowly as is honest:

- **Host:** the form's own host only. Everything else stays blocked.
- **Duration:** a bounded window (default 30s), not a single request. A real
  submit fires an XHR plus a redirect and sometimes several more; claiming
  "exactly one request" would be a guarantee the implementation could not keep.
- **Recording:** every request that passes through the window is captured
  verbatim on the attempt row.

The guard is re-armed as soon as the window closes, whether or not the
submission succeeded.

### After submitting

Poll the adapter's `detectSubmitted` until it returns true or the window
expires; screenshot either way; write the row.

### Storage

New Prisma model `SubmissionAttempt`. Deliberately **not** an extension of
`ShadowRun` — a shadow run is by definition a run that did not submit, and
overloading it would make "how many applications did we actually send" an
unanswerable question.

Fields: job, candidate, atsType, adapter id, authorization record, gate results,
the lifted-window request log, `detectSubmitted` outcome, any adapter-detected
error, screenshot path, timestamps.

---

## 2. Thin adapters (§22)

`src/lib/apply/adapters/{greenhouse,lever,ashby,generic}.ts`

```ts
interface AtsAdapter {
  id: string;
  submitButton(page: Page): Locator | null;
  detectSubmitted(page: Page): Promise<boolean>;
  detectError(page: Page): Promise<string | null>;
  maxTrustLevel: TrustLevel;
}
```

### Deliberate departure from §22

§22 lists a directory per ATS, each knowing how to detect fields, fill text,
select dropdowns, upload documents, answer questions, validate, and detect
errors. Most of that already exists and already works generically across
Greenhouse, Lever and Ashby — `read-form.ts`, `classify-field.ts`, `fill-plan.ts`
and the filling code in `shadow.ts` are not ATS-specific and do not need to be.

Rewriting working generic code into three near-identical adapters to satisfy a
directory layout would be churn with a real regression risk and no behavioural
gain. What is genuinely ATS-specific is narrower: **finding the submit button,
recognising a successful submission, and recognising an error page.** Those are
the three the adapters own.

The `generic` adapter caps at trust level 2: it can detect and fill an unknown
ATS, and is never eligible to submit.

---

## 3. Trust ladder (§21)

`src/lib/apply/trust.ts`. Levels are computed per `atsType` from the
`ShadowRun` verdict data already being collected (the `@@index([atsType, verdict])`
exists for exactly this) plus `SubmissionAttempt` outcomes.

| Level | Meaning | Requires |
|---|---|---|
| 0 | Unsupported | no adapter |
| 1 | Detect + parse | adapter exists, <5 verified runs |
| 2 | Autofill → review | ≥5 verified runs, ≥80% correct |
| 3 | Review + submit | ≥10 verified runs, ≥90% correct |
| 4 | Auto-submit | ≥25 verified runs, ≥95% correct, ≥10 confirmed submissions with zero `wrong` verdicts, **and** an explicit manual opt-in |

> **ASSUMPTION — not yet confirmed by the user.** These thresholds are a
> proposal. They are the one number set in this document chosen by the author
> rather than by the person whose applications are at stake, and they should be
> reviewed before implementation.

Two properties matter more than the specific numbers:

- **Evidence makes an ATS eligible; it never promotes it.** Level 4 requires a
  human opt-in on top of the data. Accumulating good runs can never, by itself,
  turn on auto-submit.
- **Unverified runs count for nothing.** A `ShadowRun` with a null verdict is
  not evidence; only runs a human actually checked advance a level.

This also replaces the hardcoded `SUBMISSION_RELIABILITY` map in
`confidence.ts`, whose own comment marks it a placeholder "until an apply worker
exists and has actually submitted anything."

---

## 4. Queue worker and state machine (§23)

`src/lib/apply/worker.ts`, driven by a new endpoint on the existing apply
daemon. The daemon already serialises runs, keeps a warm browser, and persists
the browser session — all of which the worker needs and none of which it should
reimplement.

The worker reads `decideAutoApply` (§18), walks `QUEUED → APPLYING → …`, and
branches on the ATS's trust level:

- **Level 3 — where this ships.** Fills, evaluates the gates, then stops at
  `WAITING_FOR_USER` with a review showing the filled screenshot and each gate's
  result. The human's approval *is* the gate-7 authorization record, and it is
  what triggers the submit phase → `SUBMITTED_PENDING_CONFIRMATION`.
- **Level 4 — closed until earned.** The same path without the stop.

Exception mapping:

| Condition | State |
|---|---|
| CAPTCHA detected | `CAPTCHA` |
| Login wall detected | `LOGIN_REQUIRED` |
| Required fields unfilled | `AMBIGUOUS_QUESTION` |
| Thrown error | `FAILED` |
| Job no longer open at preflight | `JOB_CLOSED` |

All of these are already resumable through the existing `resumeTarget` map; no
state machine changes are needed beyond driving it.

### Review surface

The Level 3 review reuses the `/applications` tracker's existing **"Needs you"**
column, which already groups `WAITING_FOR_USER`, `CAPTCHA`, `LOGIN_REQUIRED`,
`AMBIGUOUS_QUESTION` and `FAILED`. A separate queue page would be a second
inbox for the same concept.

> **ASSUMPTION — not yet confirmed by the user.** A dedicated queue page was the
> alternative considered.

---

## Testing

Trust-level arithmetic, gate evaluation and adapter selection are pure functions
over data and get ordinary unit tests.

The submit path is tested against a **local fixture server** serving replica
Greenhouse, Lever and Ashby forms, so a submission can be driven end to end and
the test can assert that the fixture actually received the POST.

Two rules, both load-bearing:

- **No test ever submits to a real employer's form.** Not once, not "carefully",
  not to check a selector.
- **The negative is tested explicitly.** A test asserts that when a gate fails,
  the guard refuses the submission and the attempt is recorded as refused.
  Proving that submission *doesn't* happen when it shouldn't is the whole point
  of the design, and a suite that only tests the happy path would not notice the
  guard being removed.

---

## Out of scope

- Workday, SmartRecruiters, iCIMS (§22 lists them; no jobs from them in the
  database today, and Workday's multi-page wizard with mandatory account
  creation is its own project).
- Resume and cover-letter builders (§14, §15) — the worker consumes whatever
  documents exist; it does not generate them.
- Gmail status tracking (§25) and the contact finder (§26).
