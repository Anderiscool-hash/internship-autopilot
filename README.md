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

## Status

**Phase 0 — repo scaffold.** Nothing is built yet. The spec defines 9 phases;
see §40 of the plan for the roadmap and §41 for what counts as a usable V1.

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
