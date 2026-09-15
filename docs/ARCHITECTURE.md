# Architecture

A map from the spec (`internship_autopilot_plan.md`, 45 sections) to the code
that implements it, and the handful of rules that shape how any of it is
written.

## The three rules everything follows

1. **Never fabricate candidate facts** (spec §3). Anything the app claims about
   the candidate comes from the profile or the Truth Ledger. Nothing else.
2. **Never fabricate scraped facts either.** A field the posting did not state
   stays null — no defaulted currency, no guessed board slug, no invented
   requirement. Review has already caught both of those.
3. **Silence is never a yes.** Unknown is its own answer everywhere: an
   unstated requirement does not fail eligibility, an unparsed form never
   auto-applies, a missing profile field makes a fit component skipped rather
   than zero, and a rate over three applications is not shown as a percentage.

Each of those exists because the opposite failure is invisible to the user. A
job wrongly hidden is one they never learn about; a wrong answer submitted on
their behalf is one they cannot take back.

## Shape

One Next.js app. Server components render every page, forms are plain
`method="get"` / server actions, and **no screen needs client-side
JavaScript**. Background work is a separate long-running Node process
(`npm run scan`) against the same database.

```
src/lib/          pure logic + database access, no React
src/app/          pages and server actions
scripts/          one-shot and long-running processes
prisma/           schema, migrations, seed
```

Pure logic is kept in `src/lib/**` with the database at the edges, which is why
the test suite needs no database and CI does not run one.

## Spec section → module

| Spec | What | Where |
| --- | --- | --- |
| §2 Unified profile | Candidate record, form parsing | `src/lib/candidate/`, `src/app/profile/` |
| §3 Truth Ledger | Facts the AI may draw on | `src/app/profile/truth-ledger.tsx` |
| §4 Company registry | Boards to scan, verified before saving | `src/lib/companies/`, `src/app/companies/` |
| §5 Continuous discovery | Adaptive polling, backoff, removals | `src/lib/scan/`, `scripts/scan.ts` |
| §6–7 Sources, normalization | Greenhouse/Lever/Ashby clients | `src/lib/ats/` |
| §8 Deduplication | Fingerprint + unique constraint | `src/lib/jobs/fingerprint.ts` |
| §9 Student role classifier | Cheap keyword pass over titles | `src/lib/jobs/classify.ts` |
| §10 Requirement extraction | Rule-based, from description text | `src/lib/eligibility/extract.ts` |
| §11 Hard eligibility | pass / fail / unknown per check | `src/lib/eligibility/engine.ts` |
| §12 Job fit | Seven weighted components | `src/lib/fit/score.ts` |
| §16 Answer bank | Reusable answers, conservative matching | `src/lib/answers/`, `src/app/answers/` |
| §17 Application confidence | Weighted, hard-zero on CAPTCHA | `src/lib/apply/confidence.ts` |
| §18 Auto-apply rules | auto / review / blocked decision | `src/lib/autoapply/rules.ts`, `src/lib/autoapply/load-rules.ts`, `src/app/settings/` |
| §19 Preflight | Reads the real form, never submits | `scripts/preflight.ts`, `src/lib/apply/` |
| §20 Shadow Mode | Fills a real form, blocked from submitting | `src/lib/apply/shadow.ts`, `scripts/shadow-apply.ts` |
| §21 Adapter trust ladder | Levels computed from verified evidence, never stored | `src/lib/apply/trust.ts` |
| §22 ATS adapters | Submit button, success page, error page — nothing else | `src/lib/apply/adapters/` |
| §21–22 Submit guard | A bounded same-host window, opened only after filling | `src/lib/apply/shadow.ts`, `src/lib/apply/submit.ts` |
| §23 Workflow state machine | Legal transitions, resumability | `src/lib/applications/machine.ts` |
| §23 Apply worker | Walks `QUEUED → APPLYING → …`, stops for approval | `src/lib/apply/worker.ts`, `scripts/apply-daemon.ts` |
| §23 Submission records | Every attempt, gate by gate, refused or sent | `prisma/schema.prisma` (`SubmissionAttempt`) |
| §23 Level-3 review | Approve or reject a filled form in "Needs you" | `src/app/applications/review-panel.tsx` |
| §24 Application tracker | Board, outcomes, notes | `src/app/applications/` |
| §28 Internship alerts | Batched, deduped via EventLog | `src/lib/alerts/` |
| §29 Analytics | Rates that refuse small samples | `src/lib/analytics/` |
| §30 Provider gateway | One interface, local or Claude | `src/lib/ai/`, `src/app/settings/ai/` |
| §2 Resume autofill | Patterns first, model second, review always | `src/lib/resume/`, `src/app/profile/` |
| §40 Job dashboard | List, filters, screening | `src/app/jobs/`, `src/lib/jobs/query.ts` |

## How an application gets sent

### Why filling and submitting are separate

`runShadowApply` blocks every non-GET request for the whole time it is filling.
That is what makes "a bug in the filling logic cannot send an application" a
guarantee rather than a hope — it does not depend on nobody having written a
stray click.

Submission needs a POST, so it needs an exception. The exception is
`openSubmitWindow`: a closure created inside `shadow.ts`, handed to the submit
phase only after filling has completely finished, scoped to the form's own
host, bounded by a wall-clock deadline, and closed in a `finally` so a throw
cannot leave it open. `submit.ts` decides whether to call it and works out what
happened; it cannot open the guard itself, and no other file may call
`context.route` or `context.unroute`.

It is modelled on the `uploadWindow` exception directly above it, not on
handoff mode's `context.unroute` — a one-way lift never re-arms, which is
exactly the failure this design has to avoid.

If you are changing any of this, the tests that will tell you whether you broke
it are in `src/lib/apply/submit-window.test.ts`. Every negative there asserts
`blockedSubmissions` is non-empty rather than merely that no POST arrived: the
fixture forms have required inputs, so "nothing arrived" is also what an
unfilled form looks like, and a test that accepted it would pass with the guard
deleted.

### Where it ships: trust level 3, and a person

The worker fills the form, evaluates the gates against the page as it stands at
that instant, and stops at `WAITING_FOR_USER`. The filled screenshot and every
gate's result land in the tracker's **"Needs you"** column, and a human presses
approve or reject there. That approval *is* the authorization record written to
the `SubmissionAttempt` row — it names who allowed it and when, never a boolean
that defaults to true.

Level 4 (submit without asking) exists in `trust.ts` and is unreachable by
accumulating good runs. It needs the evidence bar **and** the per-ATS `AUTO`
mode set by hand at `/settings`. Nothing in the code can set that mode for
itself: evidence makes an ATS eligible, a person promotes it.

An ATS nobody has written an adapter for gets the generic adapter, which is
capped at trust level 2 and can never submit. That is not caution for its own
sake — on an unknown ATS we cannot recognise the confirmation page, so after
clicking we could not say whether an application went out, and "we think we
applied" is worse than not applying.

The apply daemon has to be running for the approve button to do anything:

```
npm run daemon
```

The button posts to the daemon's `/apply-run` and polls `GET /run?id=`. With no
daemon listening the action reports that and leaves the application where it
was, rather than reporting a success that never happened.

## Two decisions that differ from the spec, and why

**No Redis or BullMQ** (spec §30 suggests both). This machine has no Docker
engine and no Redis. But the `Company` table already carries `lastScan`,
`pollInterval`, `scanPriority`, `failureCount` and `lastChange`, with an
`[active, lastScan]` index — so "which boards are due?" is one cheap query and
the schedule survives the process dying. BullMQ can wrap this later for
multi-process concurrency; nothing here is in its way.

**Extraction at ingest, not at render.** `Job.requirements` is written when a
posting is discovered. Rendering it per request was fine for one job page but
could not support screening thousands of jobs on eligibility. Null in that
column means "not extracted yet", never "requires nothing" — the two are kept
apart everywhere they are read.

## AI, and where it is not used

Most of this app is rule-based and calls no model at all: discovery, dedupe,
the student-role classifier, requirement extraction, hard eligibility, fit
scoring, the state machine, analytics. That is a deliberate split — those
answers have to be explainable and reproducible, and a rule can show its
working.

A model is used for two things only, both behind `src/lib/ai`:

- **the half of resume parsing patterns cannot do** — which line is a name,
  which words are skills
- **document drafting** (Phase 4, not built) — where prose quality is the point

The provider is chosen at `/settings/ai` and defaults to none. Local models
suit the high-volume work and keep the candidate's resume on the machine;
Claude suits the low-volume documents that carry their name. Nothing falls
back to a provider the user did not choose.

## What is not built

- Resume builder, resume coverage, cover letters (§13–15) — need an AI
  provider, and no key is set.
- Adapters for Workday, SmartRecruiters and iCIMS (§22). They fall through to
  the generic adapter, so they can be read and filled and can never be
  submitted. Workday's multi-page wizard with mandatory account creation is its
  own project.
- Auto-submit (§21 level 4). The ladder computes it, the worker would walk it,
  and no ATS has either the evidence or the manual opt-in.
- Gmail status tracking, contact finder, recruiter outreach (§25–27) — need
  Google and enrichment API credentials.
- AWS deployment (§31–38).

Preflight (§19) still only reads, and Shadow Mode (§20) still cannot submit —
`runShadowApply` with no `onFilled` seam is exactly the guarded run it always
was.
