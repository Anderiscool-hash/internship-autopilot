# Internship Autopilot

An internship operating system: it continuously watches company career boards,
finds student/internship roles, checks whether *you* are actually eligible,
scores how well each job fits you, tailors a resume and cover letter, and
(once trusted) submits the application for you — then tracks the outcome from
your inbox.

Full specification: [`docs/internship_autopilot_plan.md`](docs/internship_autopilot_plan.md)

## The pipeline in one line

```
discover → normalize → filter → eligibility → fit score → tailor docs
        → preflight → apply (shadow or auto) → verify → track → learn
```

## Planned stack (from the spec, §30)

| Layer              | Choice                        |
| ------------------ | ----------------------------- |
| Frontend           | Next.js + TypeScript          |
| Backend            | Next.js API routes / Node     |
| Database           | PostgreSQL                    |
| Queue              | Redis + BullMQ                |
| Browser automation | Playwright                    |
| AI                 | LLM via a provider gateway    |
| Files              | Local in dev, S3 in prod      |
| Deployment         | AWS (EC2 → RDS/S3 → ECS)      |

## Running the database locally

Two options. **This machine uses option B.**

**A. Docker** (what `docker-compose.yml` is for — closest to the AWS target,
and gives you Redis in the same command):

```bash
npm run db:up          # starts Postgres 16 + Redis 7
```

**B. Native PostgreSQL** (used here, because only the Docker CLI was
installed — no engine). Installed with
`winget install PostgreSQL.PostgreSQL.17`, then:

```sql
CREATE ROLE autopilot WITH LOGIN PASSWORD 'autopilot_local_dev' CREATEDB;
CREATE DATABASE autopilot OWNER autopilot;
```

Those credentials deliberately match the ones in `docker-compose.yml`, so the
same `DATABASE_URL` works either way and switching to Docker later needs no
config change. Redis is not installed and is not currently needed: the
continuous scanner schedules itself from the `Company` table rather than from
a queue (see "Running the scanner" below).

Then, for either option:

```bash
cp .env.example .env   # then fill in values
npm run db:migrate     # apply migrations
npm run db:seed        # load the company registry
npm run db:studio      # browse the data in a GUI
```

## Running the app

```bash
npm run dev            # dashboard at http://localhost:3000
npm test               # unit tests (no database needed)
npm run typecheck      # tsc --noEmit
npm run build          # production build (also type-checks)
```

CI runs those same three checks on every push and pull request
(`.github/workflows/ci.yml`). None of them needs a database — every test here
is over pure logic, and the pages render on request rather than at build time.

`/applications` is the tracker (spec §24): jobs you have saved, grouped into
Saved / Preparing / Needs you / Applied / Closed, with outcomes and notes. The
workflow states behind those columns are spec §23's, and the state machine
refuses illegal moves — though you can always report what actually happened,
since "I applied to this myself" is a fact, not a step in the bot's plan.

`/answers` is the application answer bank (spec §16): the handful of questions
every form asks, answered once. A question with no answer here is what makes an
apply run stop and ask you rather than invent something.

`/analytics` answers "how is this going?" from the tracker (spec §29) —
response, interview and offer rates, broken down by company and ATS. A rate
computed from fewer than five applications is shown as a raw count instead,
because a percentage from three applications reads as a fact and is not one.

`/settings` holds the auto-apply rules (spec §18) — fit and confidence floors,
posting-age and per-day limits, and per-ATS authority. Nothing is enabled by
default and no apply worker exists yet, so nothing is ever submitted.

`/profile` is where you enter who you are and what is true about you — the
Truth Ledger (spec §3) is the only source of claims the AI is ever allowed to
make on your behalf, so nothing downstream works until it has something in it.

The dashboard lives at `/jobs`: every discovered posting, newest first,
filterable by title, company, ATS, remote type, how recently it was first seen,
and the student-role classifier's verdict. Once your profile exists it also
screens every job against spec §11's hard requirements, so you can filter down
to the ones you are actually eligible for, and scores the fit of the ones you
are (spec §12). Fit is computed for the rows on the page you are looking at,
so there is no sort-by-fit yet — that needs the score precomputed per job,
which it cannot be while it depends on a profile that changes. Closed postings are hidden unless
you tick "Include closed".

## Running the scanner

```bash
npm run scan           # continuous, 24/7 (spec §5)
npm run eligibility:report  # how often postings state a checkable requirement
npm run extract:backfill    # extract requirements for older rows (--all to redo)
npm run scan -- --once # a single cycle, then exit
npm run discover       # scan every active board now, ignoring the schedule
```

Each cycle asks the database which boards are due, scans those, upserts what
they list, and marks anything that has vanished from a board as CLOSED. The
next-due time lives on the company row (`lastScan` + `pollInterval`), not in a
queue — so stopping the process loses nothing, and starting it again resumes
exactly where it left off. Polling adapts per spec §5: priority boards every
5 minutes, recently-active every 12, normal every 30, dormant every 60, with
exponential backoff (capped at 6 hours) on a board that keeps failing.

After each cycle it alerts on newly-discovered student-role postings (spec
§28) — one message per cycle, never the same job twice, with the "sent" record
kept in the EventLog so a restart cannot re-send it. Set `ALERT_WEBHOOK_URL`
to a Discord-compatible webhook to receive them; with no URL set they print to
the scanner's console. Alerts deliberately carry no match percentage: the fit
engine that would compute one is Phase 3.

Environment variables: `SCAN_CYCLE_SECONDS` (default 60), `SCAN_LIMIT`
(default 25 boards per cycle), and `ALERT_WEBHOOK_URL` (optional).

## Status

**Phase 1 complete; Phase 2 nearly.** Built: the schema and migrations, the
company registry, Greenhouse/Lever/Ashby clients, dedupe, the student-role
classifier, the continuous scanner with adaptive polling and removal tracking,
the job dashboard, internship alerts, the profile + Truth Ledger screen, and
the rule-based half of Phase 3 — requirement extraction, the hard eligibility
engine, and the fit engine, all shown on each job's detail page; and the
application tracker with its §23 state machine, the answer bank (§16), the auto-apply
rules engine (§18), and analytics (§29). Not built: resume coverage
(§13), the document builders (Phase 4), and the Playwright apply flow
(Phase 5) — eligibility, fit scoring, resumes, and applying.
See §40 of the plan for the roadmap and §41 for what counts as a usable V1.

## Working agreement for this repo

- **Commit after every step**, with a message body explaining *what* changed
  and *why* — never a bare "update".
- **Comment the code** so every non-obvious block states what it is supposed
  to do, in plain language.
- **Secrets live in `.env`** (git-ignored). Required variable *names* are
  documented in `.env.example`, which is committed.
- **Never fabricate candidate facts.** The Truth Ledger (spec §3) is the only
  source of qualifications the AI is allowed to use.

## Relationship to the older Python app

An earlier prototype lives at `C:\Users\ayala\internship-autopilot` (Flask +
Python, kanban tracker with semi-automatic apply). This repo is a fresh build
on the stack the spec calls for, not a continuation of that codebase.
