# Contact Finder and Recruiter Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the candidate find a real person at a company, work out their email address, and put a written introduction in his Drafts folder for him to send.

**Architecture:** A four-step discovery pipeline (MX lookup → permutation → scoring → pattern learning) produces ranked candidate addresses, of which the pure parts carry the entire logical weight and are unit-tested exhaustively. Drafts are delivered by IMAP `APPEND` into the candidate's own Drafts folder using credentials the app already holds, with an in-app copy button as an unconditional fallback. Verification comes back through the candidate's inbox — a hard bounce is ground truth that the address was wrong, and a reply is ground truth that it was right — so the app gets a feedback loop without ever sending mail itself.

**Tech Stack:** TypeScript, Next.js 15 (App Router, server components + server actions), Prisma + Postgres, vitest, `imapflow` (IMAP read + `APPEND`), `zod`, Node `dns.promises` and `node:crypto`. Optional: Hunter API.

**Spec:** `docs/superpowers/specs/2026-09-19-contact-outreach-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

**Product invariants — violating any of these is a defect, not a style choice:**

- **The app never sends mail.** No SMTP dependency may be introduced, in production code or in a test. There is no send path, by design.
- **The free path is the default and the fallback**, never a degraded mode that must be opted into. A missing `HUNTER_API_KEY` is an ordinary state, not an error.
- **The application never contacts LinkedIn**, authenticated or otherwise. Names are typed or pasted by a human.
- **Gravatar is positive-only.** A hit proves the address is real; a miss proves nothing. `false` means unknown and must never be scored as a negative. There is deliberately no `GRAVATAR_MISS` state.
- **Only a parsed `5.x.x` is a hard bounce**, and `5.2.2` is excluded from the hard set. A `4.x.x` is never evidence an address is wrong. A `MAILER-DAEMON` sender heuristic may surface a probable bounce for display but must never set `ContactEmail.status = BOUNCED` on its own.
- **The AI writes prose; rules supply every fact.** Experience claims come from `TruthFact` rows exclusively, never from `WorkExperience` free text. Nothing the model returns is parsed back into a fact.
- **The feature works fully with no AI provider configured** — the draft builder falls back to a filled template.
- **Secrets live in gitignored `.env`** via `writeEnvVars`, never in Postgres, and are never returned to the browser. Status accessors return `{ configured: boolean }`, never the key.

**Codebase conventions:**

- Every server action opens with `await requireAccess()`. Next dispatches server actions by action ID, not by route, so middleware cannot be the boundary (`src/app/companies/actions.ts:20-23`).
- Tests are co-located as `foo.test.ts` beside `foo.ts` and open with a block comment explaining why the file matters.
- **In `src/lib`, import values by relative path. Use `@/` only for `import type`.** There is no `vitest.config.*` in this repo, so the `@/*` alias from `tsconfig.json:24` does not resolve at test runtime. It survives today only because all five `@/` imports under `src/lib` are `import type` and are erased before vitest sees them, and because no test file imports through `@/` at all. A value import through `@/` in a module that has a co-located test will fail to resolve when that test runs. Verified 2026-09-19.
- **`noUncheckedIndexedAccess` is on** (`tsconfig.json`), alongside `strict`. Every array index and every regex capture group is `T | undefined` and needs an explicit guard. This bites the DSN parser and the permuter hardest — their tests will pass and `npm run typecheck` will then fail, so run typecheck before committing, not after.
- External HTTP responses are Zod-validated. Clients carry a typed error with `readonly retryable: boolean`, use `AbortSignal.timeout(15_000)`, and send the shared user agent `InternshipAutopilot/1.0 (+job-discovery; contact: internship-autopilot)`. There is no shared fetch wrapper in this repo and this plan does not introduce one — follow the existing duplicate-per-client convention.
- Colour in this design system is reserved for meaning.
- Commit subjects are prose imperative sentences, not conventional-commit prefixes. Match `git log --oneline -10`.

**Commands:**

- `npm test` — vitest run (all). Single file: `npx vitest run <path>`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run db:push` — apply schema. **This repo has no migration files**; do not create a migrations directory.
- `npm run dev` — dashboard on http://localhost:3000.

**Windows and environment hazards:**

- `prisma generate` fails with EPERM while any repo node process holds the query-engine DLL. Stop the dev server, scanner, and apply daemon — *and their `tsx` child processes* — before `npm run db:push`.
- Never run `npm run build` while `npm run dev` is up.
- Do not write files containing escape sequences (`\r\n`, `\b`) through a bash heredoc — this repo has already lost time to a heredoc corrupting `\b` into a literal 0x08 byte. Use an editor/Write tool for the MIME and DSN fixture files.

**Concurrency:**

- Codex works concurrently in `src/app/**`. `src/app/site-nav.tsx` and `src/app/ui-icon.tsx` are **shared files**: they must be edited by the coordinator after parallel agents finish, never by a parallel implementation agent.
- Work happens on branch `contact-outreach`, not `main`.

## File Structure

```
prisma/schema.prisma                  MODIFY  4 enums, 4 models, 2 back-relations

src/lib/contacts/
  pattern.ts        pure   owns PatternId + NameParts; infer and apply a pattern
  permute.ts        pure   name + domain -> ranked AddressCandidate[]
  score.ts          pure   AddressSignals -> 0-100 confidence
  mx.ts             I/O    dns.resolveMx, provider identification
  gravatar.ts       I/O    avatar probe (positive-only)
  hunter.ts         I/O    Hunter client: typed error, Zod, 15s timeout
  store.ts          I/O    Contact / ContactEmail / EmailPattern persistence
  discover.ts       orch   runs the pipeline over one contact

src/lib/outreach/
  compose.ts        pure   RFC 5322 MIME construction
  bounce.ts         pure   DSN parsing, hard vs soft classification
  __fixtures__/     data   raw DSN samples
  draft.ts          orch   fact block + AI prose (or template) -> subject/body
  deliver.ts        I/O    IMAP APPEND to Drafts, special-use folder discovery
  watch.ts          I/O    IMAP poll for bounces and replies
  store.ts          I/O    OutreachMessage persistence

src/app/contacts/
  page.tsx          async server component
  actions.ts        server actions, requireAccess() first in each
  format.ts         pure   confidence -> label, status -> badge class
  loading.tsx

src/app/settings/outreach/ key entry screen, mirrors settings/mailbox
src/app/site-nav.tsx       MODIFY  SHARED — coordinator only
src/app/ui-icon.tsx        MODIFY  SHARED — coordinator only

scripts/watch-outreach.ts  one pass of the bounce/reply watcher
scripts/check-drafts.ts    live IMAP APPEND check, never in CI
package.json               MODIFY  outreach:watch, drafts:check
.env.example               MODIFY  HUNTER_API_KEY comment
```

The settings route is `/settings/outreach` labelled "Contact finder", not
`/settings/hunter`: the free path is the default and the fallback, and naming the
screen after the paid vendor would say the opposite.

## Task Order and Dependencies

Tasks are numbered by subsystem, not by build order. Build in these phases:

| Phase | Tasks | Notes |
|---|---|---|
| 1 | **1** | Schema. Blocks every task that persists. Run `db:push` before anything else. |
| 2 | **2 → 3 → 4**, **5, 6**, **7, 8, 9** | Three independent parallel tracks, no database needed. **Within the first track the order is strict.** Task 2 creates `pattern.ts` holding *only* `PatternId`, `PATTERN_IDS` and `NameParts`; Task 3 adds `inferPattern`/`applyPattern` to that same file. The edge `permute.ts → pattern.ts` is `import type` and erased at emit, so the only runtime edge is `pattern.ts → permute.ts` and the graph is acyclic. Note this deviates from spec §3 step 2, which shows `NameParts` declared in `permute.ts` — `permute.ts` re-exports it so spec-following imports still compile. |
| 3 | **10, 11** | Persistence. Needs Task 1. |
| 4 | **12, 13, 14, 15** | Orchestration. Needs phases 2 and 3. |
| 5 | **16, 17** | UI. Needs phase 4. Touches shared files — coordinator merges. |
| 6 | **18** | Wires the watcher to the real stores and adds its runner. Needs Tasks 10, 11 and 15. Without it the watcher is fully tested and can never run. |

Phase 2's three tracks touch disjoint files and are the natural split for parallel agents. Phase 4's four tasks also touch disjoint files, but all four consume phase 2 interfaces, so they cannot start early.

---

## Phase 1 — Schema

### Task 1: Prisma models for contacts and outreach

**Files:**
- Modify: `prisma/schema.prisma:992` (append the new CONTACTS + OUTREACH block at end of file — the file is currently 991 lines)
- Modify: `prisma/schema.prisma:758` (insert `outreach OutreachMessage[]` into `Application`, immediately after `submissionAttempts SubmissionAttempt[]`)
- Modify: `prisma/schema.prisma:559` (insert `contacts Contact[]` into `Company`, immediately after `jobs Job[]`)
- Modify: `prisma/schema.prisma:728-731` (`Application.recruiterContact` doc comment — name its successor)
- Test: none. This is a schema change; there is no unit to test. Verification is `npm run db:push` succeeding, `npm run typecheck` passing, and a round-trip write proving a row can be created and read back (Steps 6–8).

**Interfaces:**
- Consumes: nothing. This is the first task in the feature.
- Produces (all generated into `@prisma/client` by `prisma generate`, imported by every later task):
  - enums `ContactSource`, `ContactEmailStatus`, `EmailPatternSource`, `OutreachStatus`
  - model types `Contact`, `ContactEmail`, `EmailPattern`, `OutreachMessage`
  - delegates `db.contact`, `db.contactEmail`, `db.emailPattern`, `db.outreachMessage`
  - compound unique input `contactId_address: { contactId: string; address: string }` on `db.contactEmail`
  - `db.emailPattern.findUnique({ where: { domain } })` (domain is `@unique`)
  - relation includes `Company.contacts`, `Application.outreach`, `Contact.emails`, `Contact.outreach`, `ContactEmail.outreach`

**Edit order matters.** Do the append first, then line 758, then line 559 — bottom-up, so no earlier edit renumbers a later one. Doing it top-down shifts every number below the insertion point by 2.

- [ ] **Step 1: Stop every node process in this repo before touching the schema.**
  Nothing is edited yet; this is the precondition for Steps 4 and 5 and it is cheaper to
  do now than to debug an EPERM later.
  ```powershell
  Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, Path
  ```
  Kill anything whose `Path` is under `C:\Users\ayala\dev\internship-autopilot`
  (`Stop-Process -Id <id> -Force`). Re-run the command and confirm the list is empty of
  repo-rooted processes.

- [ ] **Step 2: Append the CONTACTS + OUTREACH block to the end of `prisma/schema.prisma`.**
  The file ends at line 991 with the closing `}` of `model EventLog`. Append the
  following verbatim (it is copied verbatim from the design doc, section 8), starting at
  line 992:
  ```prisma

  // ----------------------------------------------------------------------------
  // CONTACTS + OUTREACH (spec §26-27)
  // ----------------------------------------------------------------------------

  /// Where a contact came from. An enum rather than a boolean because a licensed
  /// people-data API may be added later, and because "how did we learn about this
  /// person" is the first question asked when an address turns out to be wrong.
  enum ContactSource {
    MANUAL
    HUNTER
    IMPORTED
  }

  /// How much is known about one candidate address. There is deliberately no
  /// GRAVATAR_MISS: a missing avatar is absence of evidence, not evidence of
  /// absence, and giving it a state would invite treating it as one.
  enum ContactEmailStatus {
    GUESSED
    GRAVATAR_HIT
    API_VERIFIED
    BOUNCED
    CONFIRMED
  }

  enum EmailPatternSource {
    INFERRED
    HUNTER
    MANUAL
  }

  /// Lifecycle of one outreach message. There is no SENDING state because this
  /// app never sends: SENT is set by the person telling us he sent it.
  enum OutreachStatus {
    DRAFT
    SENT
    BOUNCED
    REPLIED
  }

  /// A person at a company worth introducing yourself to (spec §26).
  model Contact {
    id String @id @default(cuid())

    firstName String
    lastName  String

    /// Job title as the candidate read it. Free text on purpose — "University
    /// Recruiter", "Engineering Manager" and "Campus Talent" are the same job at
    /// three companies, and an enum would force a wrong choice at entry.
    title String?

    /// Null when the person was found before the employer was tracked as a
    /// Company, which is normal: outreach runs ahead of the board registry.
    companyId String?
    company   Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)

    /// The mail domain to guess against. Held here rather than read from
    /// Company.domain because Company has NO unique constraint on domain and the
    /// join may be wrong or absent — see the note below this block.
    domain String

    /// Recorded for the candidate's reference only. The application never fetches
    /// it; see section 2.
    linkedinUrl String?

    source ContactSource @default(MANUAL)

    notes String? @db.Text

    emails   ContactEmail[]
    outreach OutreachMessage[]

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    @@index([companyId])
    @@index([domain])
  }

  /// One candidate address for a contact, with what is known about it. Several
  /// rows per contact is the normal state: the pipeline generates ten and narrows
  /// them as evidence arrives.
  model ContactEmail {
    id        String  @id @default(cuid())
    contactId String
    contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

    address String

    /// Which pattern generated it, so a confirmation can teach EmailPattern. Null
    /// when the address came from Hunter or was typed in directly and no pattern
    /// explains it unambiguously.
    pattern String?

    /// 0-100 from scoreAddress(). Stored rather than computed on read so the
    /// ordering the person saw is the ordering that was recorded.
    confidence Int @default(0)

    status ContactEmailStatus @default(GUESSED)

    /// When a verification signal was last gathered. Null means never checked,
    /// which is distinct from checked-and-found-nothing.
    checkedAt DateTime?

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    outreach OutreachMessage[]

    // One row per address per contact; the pipeline re-runs and must not
    // duplicate what it already knows.
    @@unique([contactId, address])
    @@index([status])
  }

  /// The learned address pattern for one mail domain. This is the table that
  /// makes the free path work: the first confirmed address at a domain turns
  /// every later contact there from ten guesses into one.
  model EmailPattern {
    id String @id @default(cuid())

    /// Unique here, unlike Company.domain, because this table's entire purpose is
    /// to answer "what is the pattern at this domain" with exactly one row.
    domain String @unique

    /// A PatternId string, e.g. "first.last". Kept as a String rather than an
    /// enum so adding a pattern to the permuter needs no migration.
    pattern String

    source EmailPatternSource @default(INFERRED)

    /// 0-100. Rises with confirmedCount; a Hunter-sourced pattern starts high.
    confidence Int @default(0)

    /// How many unambiguous confirmations back this pattern. Ambiguous evidence
    /// does not increment it — see inferPattern().
    confirmedCount Int @default(0)

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
  }

  /// One outreach message and its fate (spec §27's tracking fields).
  model OutreachMessage {
    id String @id @default(cuid())

    contactId String
    contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

    /// Which address it was written to. Restrict rather than Cascade: the message
    /// is the record that this address was tried, and deleting the address must
    /// not erase the evidence.
    emailId String
    email   ContactEmail @relation(fields: [emailId], references: [id], onDelete: Restrict)

    /// spec §27 "Application association". Optional because introducing yourself
    /// before applying is a legitimate and common order.
    applicationId String?
    application   Application? @relation(fields: [applicationId], references: [id], onDelete: SetNull)

    subject String
    body    String @db.Text

    status OutreachStatus @default(DRAFT)

    /// Where the draft ended up, so the person can go find it. Null when the copy
    /// fallback was used instead of an IMAP append.
    draftFolder String?

    draftedAt DateTime  @default(now())
    /// Set when the person says he sent it. The bounce watcher reads only mail
    /// after this instant, so an unmarked message is never correlated.
    sentAt    DateTime?
    bouncedAt DateTime?
    repliedAt DateTime?

    /// spec §27 "Follow-up date". A date the UI surfaces; nothing acts on it.
    followUpAt DateTime?

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    @@index([status])
    @@index([contactId])
    @@index([followUpAt])
  }
  ```
  (The block above is indented two spaces only by this markdown list; paste it flush left.)

- [ ] **Step 3: Add the two back-relations on the two existing models, bottom-up.**
  Prisma requires both sides of every relation, so `db:push` will refuse the schema until
  these exist. Edit `Application` first (line 758), then `Company` (line 559).

  In `model Application`, `prisma/schema.prisma:758` currently reads
  `  submissionAttempts SubmissionAttempt[]`. Insert immediately after it:
  ```prisma
    /// Outreach written to a person about this application (spec §26-27). The
    /// successor to `recruiterContact` above, which stays as it is.
    outreach OutreachMessage[]
  ```

  In `model Company`, `prisma/schema.prisma:559` currently reads `  jobs Job[]`.
  Insert immediately after it:
  ```prisma
    contacts Contact[]
  ```

- [ ] **Step 4: Point `Application.recruiterContact`'s doc comment at its successor.**
  Design section 8 says to leave the column alone but stop writing to it and name the
  replacement. `prisma/schema.prisma:728-731` currently reads:
  ```prisma
    /// spec §24 "Recruiter". JUDGMENT CALL: a plain string for now (e.g. a
    /// name/email) rather than a full Contact model, since the recruiter
    /// finder/CRM (spec §26-27) is a later phase.
    recruiterContact String?
  ```
  Replace those four lines with:
  ```prisma
    /// spec §24 "Recruiter". Superseded by `outreach` below: Contact /
    /// OutreachMessage are now the real record (spec §26-27). Kept because it may
    /// already hold hand-typed data, and parsing free text into a first and last
    /// name would write a fabricated person into the contact list. Nothing writes
    /// to it any more.
    recruiterContact String?
  ```

- [ ] **Step 5: Apply the schema and regenerate the client.**
  Re-check Step 1's process list first — if `npm run dev` was restarted in the meantime,
  this fails with EPERM.
  ```powershell
  npm run db:push
  ```
  Expect `Your database is now in sync with your Prisma schema.` followed by
  `Generated Prisma Client`. There are **no migration files in this repo** — do not create
  a `prisma/migrations` directory and do not run `prisma migrate`.
  If it fails with `EPERM ... query_engine-windows.dll.node`: a node process is still
  holding the DLL. Kill it (Step 1) and re-run; do not retry blindly.

- [ ] **Step 6: Type-check the whole app against the new client.**
  ```powershell
  npm run typecheck
  ```
  Expect no output and exit 0. This is the real proof the generated client picked up all
  four models and both back-relations; a missing back-relation shows up here as an error
  in an unrelated file that does `include: { ... }`.

- [ ] **Step 7: Prove a row round-trips.**
  Write the throwaway script **outside the repo** so it can never be committed, then run
  it. Using the Bash tool:
  ```bash
  cat > /tmp/contact-smoke.ts <<'EOF'
  import { PrismaClient } from "@prisma/client";

  const db = new PrismaClient();

  async function main() {
    const contact = await db.contact.create({
      data: { firstName: "Plan", lastName: "Check", domain: "example.test" },
    });
    const email = await db.contactEmail.create({
      data: { contactId: contact.id, address: "plan.check@example.test" },
    });
    const back = await db.contact.findUnique({
      where: { id: contact.id },
      include: { emails: true, outreach: true },
    });
    console.log(back?.domain, back?.source, back?.emails.length, email.status);
    // Cascade also removes the ContactEmail, leaving the database as it was.
    await db.contact.delete({ where: { id: contact.id } });
  }

  main().finally(() => db.$disconnect());
  EOF
  npx tsx /tmp/contact-smoke.ts
  ```
  Expected output, exactly: `example.test MANUAL 1 GUESSED`.
  That line proves the defaults (`source = MANUAL`, `status = GUESSED`) landed, the
  `Contact -> ContactEmail` relation resolves, and the `Contact.outreach` back-relation is
  includable. If Postgres is not up, start it with `npm run db:up` first.
  Alternative eyeball, if you would rather look at it: `npx prisma studio` and confirm
  Contact, ContactEmail, EmailPattern and OutreachMessage all appear in the model list —
  but stop Studio before any later `db:push`, because it holds the query engine too.

- [ ] **Step 8: Commit the schema.**
  ```powershell
  git add prisma/schema.prisma
  git commit -m "Give contacts and outreach somewhere to live"
  ```

---


---

## Phase 2 — Pure logic and clients

### Task 2: Address permutation (`src/lib/contacts/permute.ts`)

**Files:**
- Create: `src/lib/contacts/permute.ts`
- Create: `src/lib/contacts/pattern.ts` — *types only in this task* (see Interfaces below; Task 3 adds the functions)
- Test: `src/lib/contacts/permute.test.ts`

**Interfaces:**

- **Consumes:** nothing from an earlier task. Task 7 (`src/lib/contacts/mx.ts`) is independent of this one — `discover.ts` is the only module that knows both exist.

- **Type ownership (read this before writing a line — it is what keeps the two files acyclic):**
  - `src/lib/contacts/pattern.ts` **owns** `PatternId`, `PATTERN_IDS` and `NameParts`. This task creates that file containing *only* those three declarations and a doc comment. No functions. Task 3 adds `applyPattern` and `inferPattern` to the same file.
  - `src/lib/contacts/permute.ts` **owns** `PATTERN_PRIORS`, `normalizePart`, `normalizeDomain`, `buildLocalPart`, `AddressCandidate` and `permuteAddresses`.
  - The import edges are deliberately asymmetric:
    - `permute.ts` → `pattern.ts` is **type-only** (`import type { NameParts, PatternId }`). TypeScript erases it, so there is no runtime edge at all.
    - `pattern.ts` → `permute.ts` (added in Task 3) is a **value** import of `buildLocalPart` and `normalizeDomain`.
    - Runtime graph: `pattern → permute`. One direction, acyclic. The type-level back-edge is legal and vanishes on emit.
  - The split is not arbitrary: `permute.ts` is the file that knows how to turn *a name into a local part*; `pattern.ts` is the file that reads *a pattern back out of a real address*. Construction below, inference above.
  - **Deviation from the spec, stated on purpose:** design section 3 step 2 shows `NameParts` declared in `permute.ts`. It is declared in `pattern.ts` instead, because Task 3's `inferPattern`/`applyPattern` both take a `NameParts` and putting it in `permute.ts` would force a value-carrying cycle. `permute.ts` re-exports the type (`export type { NameParts } from "./pattern";`) so any module that follows the spec and imports `NameParts` from `permute.ts` still compiles.

- **Produces** (what Tasks 3, 4 and the I/O tasks rely on):
  ```ts
  // src/lib/contacts/pattern.ts
  export type PatternId =
    | "first.last" | "first" | "flast" | "firstlast" | "first_last"
    | "f.last" | "last.first" | "firstl" | "lastf" | "first-last";
  export const PATTERN_IDS: readonly PatternId[];
  export interface NameParts { first: string; last: string; middle?: string; }

  // src/lib/contacts/permute.ts
  export const PATTERN_PRIORS: Record<PatternId, number>;
  export function normalizePart(part: string): string;
  export function normalizeDomain(domain: string): string;
  export function buildLocalPart(pattern: PatternId, name: NameParts): string | null;
  export interface AddressCandidate { address: string; pattern: PatternId; prior: number; }
  export function permuteAddresses(name: NameParts, domain: string): AddressCandidate[];
  export type { NameParts } from "./pattern";
  ```

---

- [ ] **Step 1: Create `src/lib/contacts/pattern.ts` with the shared vocabulary and nothing else.**

  There is no behaviour to test here — the file declares two types and one frozen list, and the compiler is the only thing that can be wrong. Verification is `npm run typecheck`, not vitest.

  ```bash
  mkdir -p src/lib/contacts
  ```

  ```ts
  /**
   * Address patterns: the vocabulary the guessing pipeline reasons in (spec §26).
   *
   * A "pattern" is the rule a company follows when it mints a mailbox for a new
   * hire — first.last@, flast@, and so on. Naming them is what makes the free
   * path viable at all: one confirmed address at a domain identifies the rule,
   * and every later contact at that company costs one guess instead of ten.
   *
   * These identifiers live here rather than beside the permuter because two
   * modules need them and only one of them permutes. permute.ts builds every
   * pattern for a name; pattern.ts reads a pattern back out of a real address.
   * Construction below, inference above — and because only the inference half
   * needs the construction half, the dependency runs one way and the two files
   * never form a cycle.
   */

  /** Every address pattern the permuter knows how to build. */
  export type PatternId =
    | "first.last" | "first" | "flast" | "firstlast" | "first_last"
    | "f.last" | "last.first" | "firstl" | "lastf" | "first-last";

  /**
   * The same ten, as a value, so code can iterate them.
   *
   * Kept honest by PATTERN_PRIORS in permute.ts, which is typed
   * Record<PatternId, number> and therefore refuses to compile if a member is
   * added to the union and forgotten there — and by a test asserting this list
   * and that table describe exactly the same set.
   */
  export const PATTERN_IDS: readonly PatternId[] = [
    "first.last",
    "first",
    "flast",
    "firstlast",
    "first_last",
    "f.last",
    "last.first",
    "firstl",
    "lastf",
    "first-last",
  ];

  /**
   * A person's name, as the candidate typed it.
   *
   * Unnormalised on purpose — "José", "O'Brien" and "van der Berg" arrive here
   * exactly as they were pasted, and normalizePart() in permute.ts is the one
   * place that decides what they become. A second normaliser somewhere else is
   * how two modules end up guessing two different addresses for one person.
   */
  export interface NameParts {
    first: string;
    last: string;
    middle?: string;
  }
  ```

  Run `npm run typecheck`. It must pass. Commit:

  ```
  Name the ten address patterns the permuter knows
  ```

- [ ] **Step 2: Write the failing test for the priors table.**

  Create `src/lib/contacts/permute.test.ts` with the header comment and the first three assertions. The table is the ordering — proving it is well-formed comes before proving anything uses it.

  ```ts
  /**
   * Tests for address permutation.
   *
   * This is the module that decides what the app puts in front of a human as
   * "probably his address", so it has to be provable without a network. Two
   * things matter most here.
   *
   * The first is normalisation. "José Álvarez" must become "jose.alvarez",
   * because that is what his employer's mail server was almost certainly given
   * — an accented local part is legal under RFC 6531 and essentially never
   * issued. Getting this wrong does not produce a worse guess; it produces a
   * guess for a person who does not exist.
   *
   * The second is deduplication. A one-letter first name collapses `first.last`
   * and `f.last` onto the same string. Emitting it twice would waste a slot in
   * a ten-item list and, worse, make one address look like two pieces of
   * agreeing evidence.
   */

  import { describe, it, expect } from "vitest";
  import { PATTERN_IDS, type PatternId } from "./pattern";
  import { PATTERN_PRIORS } from "./permute";

  describe("PATTERN_PRIORS", () => {
    it("prices exactly the patterns pattern.ts declares", () => {
      expect(Object.keys(PATTERN_PRIORS).sort()).toEqual([...PATTERN_IDS].sort());
    });

    it("is written in descending prior order, because that order is the output order", () => {
      // permuteAddresses emits in table order rather than sorting, so this
      // table being sorted is not a style preference — it is the ranking.
      const priors = Object.values(PATTERN_PRIORS);
      for (let i = 1; i < priors.length; i += 1) {
        expect(priors[i - 1]!, `entry ${i}`).toBeGreaterThanOrEqual(priors[i]!);
      }
    });

    it("does not sum to 1, and must not be made to", () => {
      // The missing mass belongs to patterns this module does not model —
      // initials only, employee numbers, first.m.last. Normalising it away
      // would overstate confidence in the ten we do generate.
      const total = Object.values(PATTERN_PRIORS).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThan(1);
      expect(total).toBeCloseTo(0.82, 5);
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. It must fail with a resolution error: `Failed to resolve import "./permute"`.

- [ ] **Step 3: Create `permute.ts` with the header and the priors table only.**

  ```ts
  /**
   * Turning a name and a domain into addresses worth trying (spec §26, design
   * section 3 step 2).
   *
   * Pure, and deliberately so. This module decides what the app will present to
   * a human as "probably his address", and it must be possible to prove what it
   * does without a network, a key, or a database.
   *
   * Two rules govern everything here.
   *
   * Normalisation is one-way and lossy on purpose. Accents fold to ASCII,
   * apostrophes disappear, and the internal spaces of a compound surname close
   * up, because that is what a corporate mail server was almost certainly given.
   * Hyphens close up too — the separator in `first-last` is ours to choose, and
   * a surname that supplies its own would make the pattern unreadable.
   *
   * Ordering is by prior, and the table below IS the order. Candidates are
   * emitted in table order rather than sorted, so equal priors break ties by
   * declaration and the output is identical run to run. A permuter that
   * reshuffled equal-prior candidates would reorder what the person sees for no
   * reason at all.
   */

  import type { NameParts, PatternId } from "./pattern";

  /** Re-exported so callers following the design doc's layout still compile. */
  export type { NameParts } from "./pattern";

  /**
   * Population frequency of each pattern, 0-1, in descending order.
   *
   * THESE ARE ESTIMATES, NOT MEASUREMENTS. They come from commonly cited
   * industry breakdowns and are good enough to order a list on day one. Once
   * EmailPattern holds a few dozen confirmations from this app's own use,
   * replace them with numbers measured from those rows — the only honest source
   * for them. That is why they live in one exported constant.
   *
   * They do not sum to 1 and must not be made to; see the test.
   *
   * Typed Record<PatternId, number> so adding a pattern to the union without a
   * prior is a compile error rather than a candidate that silently never gets
   * generated. Every key is a non-numeric string, so JavaScript preserves this
   * insertion order on Object.entries — which permuteAddresses depends on.
   */
  export const PATTERN_PRIORS: Record<PatternId, number> = {
    "first.last": 0.34,
    first: 0.12,
    flast: 0.11,
    firstlast: 0.07,
    first_last: 0.05,
    "f.last": 0.05,
    "last.first": 0.03,
    firstl: 0.02,
    lastf: 0.02,
    "first-last": 0.01,
  };
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. All three pass. Commit:

  ```
  Write down how often each address pattern is actually used
  ```

- [ ] **Step 4: Write the failing test for `normalizePart` and `normalizeDomain`.**

  Append to `permute.test.ts`, extending the `./permute` import line to
  `import { PATTERN_PRIORS, normalizeDomain, normalizePart } from "./permute";`.

  ```ts
  describe("normalizePart", () => {
    it("lowercases", () => {
      expect(normalizePart("JANE")).toBe("jane");
      expect(normalizePart("Okafor")).toBe("okafor");
    });

    it("folds accents to the ASCII letter underneath", () => {
      expect(normalizePart("José")).toBe("jose");
      expect(normalizePart("Álvarez")).toBe("alvarez");
      expect(normalizePart("Müller")).toBe("muller");
      expect(normalizePart("Nguyễn")).toBe("nguyen");
    });

    it("transliterates the letters that have no accent to strip", () => {
      // ø and ß do not decompose under NFD — they are distinct letters, not
      // accented ones. Without an explicit mapping the ASCII filter would drop
      // them and quietly turn "Søren" into "sren".
      expect(normalizePart("Søren")).toBe("soren");
      expect(normalizePart("Weiß")).toBe("weiss");
      expect(normalizePart("Łukasz")).toBe("lukasz");
    });

    it("drops apostrophes rather than encoding them", () => {
      expect(normalizePart("O'Brien")).toBe("obrien");
      expect(normalizePart("O’Brien")).toBe("obrien"); // curly quote
      expect(normalizePart("D'Angelo")).toBe("dangelo");
    });

    it("closes up the internal spaces of a compound surname", () => {
      expect(normalizePart("van der Berg")).toBe("vanderberg");
      expect(normalizePart("De La Cruz")).toBe("delacruz");
      expect(normalizePart("  Okafor  ")).toBe("okafor");
    });

    it("closes up hyphens too, because the pattern supplies its own separator", () => {
      expect(normalizePart("Smith-Jones")).toBe("smithjones");
    });

    it("returns an empty string for a part with nothing usable in it", () => {
      expect(normalizePart("")).toBe("");
      expect(normalizePart("   ")).toBe("");
      expect(normalizePart("-'-")).toBe("");
    });
  });

  describe("normalizeDomain", () => {
    it("trims, lowercases and tolerates a pasted leading @", () => {
      expect(normalizeDomain("  ACME.com ")).toBe("acme.com");
      expect(normalizeDomain("@acme.com")).toBe("acme.com");
      expect(normalizeDomain("")).toBe("");
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. It must fail: `normalizePart is not a function` / no export named `normalizePart`.

- [ ] **Step 5: Implement `TRANSLITERATIONS`, `normalizePart` and `normalizeDomain`.**

  Append to `permute.ts`:

  ```ts
  /**
   * Letters that do not decompose into ASCII under NFD.
   *
   * Stripping combining marks handles é, ñ and å, because those really are a
   * letter plus a mark. ø, ß and ł are not — they are their own letters, and
   * the ASCII filter below would delete them outright, guessing an address for
   * a person whose name is missing a letter. Short and incomplete by design:
   * add to it when a real name needs it, not speculatively.
   */
  const TRANSLITERATIONS: Record<string, string> = {
    ø: "o",
    æ: "ae",
    œ: "oe",
    ß: "ss",
    ł: "l",
    đ: "d",
    ð: "d",
    þ: "th",
  };

  /**
   * One name part, as it would appear in a mailbox.
   *
   * Lowercased, accents folded to ASCII, and everything that is not a letter or
   * a digit removed — which is how "O'Brien" becomes "obrien" and
   * "van der Berg" becomes "vanderberg". Returns an empty string when nothing
   * usable survives; the caller decides what that means.
   */
  export function normalizePart(part: string): string {
    const decomposed = part.normalize("NFD").toLowerCase();
    const unaccented = decomposed.replace(/[\u0300-\u036f]/g, "");
    const transliterated = unaccented.replace(
      /[^\u0000-\u007f]/g,
      (ch) => TRANSLITERATIONS[ch] ?? ch,
    );
    return transliterated.replace(/[^a-z0-9]+/g, "");
  }

  /** The domain as it belongs on the right of the @: trimmed, lowercased. */
  export function normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase().replace(/^@+/, "");
  }
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. All pass. Commit:

  ```
  Fold a pasted name into what a mail server was actually given
  ```

- [ ] **Step 6: Write the failing test for `buildLocalPart`.**

  Append to `permute.test.ts`, extending the import to include `buildLocalPart`.

  ```ts
  const JANE: NameParts = { first: "Jane", last: "Okafor" };

  describe("buildLocalPart", () => {
    it("builds every pattern for an ordinary name", () => {
      const expected: Record<PatternId, string> = {
        "first.last": "jane.okafor",
        first: "jane",
        flast: "jokafor",
        firstlast: "janeokafor",
        first_last: "jane_okafor",
        "f.last": "j.okafor",
        "last.first": "okafor.jane",
        firstl: "janeo",
        lastf: "okaforj",
        "first-last": "jane-okafor",
      };
      for (const pattern of PATTERN_IDS) {
        expect(buildLocalPart(pattern, JANE), pattern).toBe(expected[pattern]);
      }
    });

    it("normalises before it builds", () => {
      expect(buildLocalPart("first.last", { first: "José", last: "Álvarez" })).toBe(
        "jose.alvarez",
      );
      expect(buildLocalPart("flast", { first: "Anna", last: "van der Berg" })).toBe(
        "avanderberg",
      );
      expect(buildLocalPart("first.last", { first: "Sean", last: "O'Brien" })).toBe(
        "sean.obrien",
      );
    });

    it("ignores a middle name entirely", () => {
      // No modelled pattern uses one. Carrying it into a guess would invent a
      // pattern this module does not claim to know.
      expect(buildLocalPart("first.last", { ...JANE, middle: "Adaeze" })).toBe(
        "jane.okafor",
      );
    });

    it("returns null rather than half a name when the surname is missing", () => {
      for (const pattern of PATTERN_IDS) {
        const built = buildLocalPart(pattern, { first: "Jane", last: "" });
        if (pattern === "first") {
          expect(built, pattern).toBe("jane");
        } else {
          expect(built, pattern).toBeNull();
        }
      }
    });

    it("returns null for every pattern when the first name is missing", () => {
      for (const pattern of PATTERN_IDS) {
        expect(buildLocalPart(pattern, { first: "", last: "Okafor" }), pattern).toBeNull();
      }
    });

    it("returns null when a name normalises away to nothing", () => {
      expect(buildLocalPart("first.last", { first: "'", last: "Okafor" })).toBeNull();
    });

    it("makes first.last and f.last identical for a one-letter first name", () => {
      // This is the collision that forces deduplication below and forces
      // inferPattern to return null in Task 3. Pinning it here means a change
      // to the builder cannot silently uncouple the two.
      const jay: NameParts = { first: "J", last: "Okafor" };
      expect(buildLocalPart("first.last", jay)).toBe("j.okafor");
      expect(buildLocalPart("f.last", jay)).toBe("j.okafor");
      expect(buildLocalPart("flast", jay)).toBe(buildLocalPart("firstlast", jay));
    });
  });
  ```

  The imports at the top of the test file are now:

  ```ts
  import { PATTERN_IDS, type NameParts, type PatternId } from "./pattern";
  import { PATTERN_PRIORS, buildLocalPart, normalizeDomain, normalizePart } from "./permute";
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. It must fail: `buildLocalPart is not a function`.

- [ ] **Step 7: Implement `buildLocalPart`.**

  Append to `permute.ts`:

  ```ts
  /**
   * The left-hand side of the address this pattern implies, or null when the
   * name does not have the parts it needs.
   *
   * Every pattern needs a first name; every pattern but `first` also needs a
   * surname. A blank part is never filled in with anything, because a guess
   * built from half a name is a guess about a different person.
   *
   * The switch is exhaustive by compiler enforcement: adding a PatternId
   * without a case here fails to build.
   */
  export function buildLocalPart(pattern: PatternId, name: NameParts): string | null {
    const first = normalizePart(name.first);
    const last = normalizePart(name.last);
    if (!first) return null;
    if (!last && pattern !== "first") return null;

    // slice rather than [0]: noUncheckedIndexedAccess makes indexing optional,
    // and these strings are already known to be non-empty.
    const f = first.slice(0, 1);
    const l = last.slice(0, 1);

    switch (pattern) {
      case "first.last":
        return `${first}.${last}`;
      case "first":
        return first;
      case "flast":
        return `${f}${last}`;
      case "firstlast":
        return `${first}${last}`;
      case "first_last":
        return `${first}_${last}`;
      case "f.last":
        return `${f}.${last}`;
      case "last.first":
        return `${last}.${first}`;
      case "firstl":
        return `${first}${l}`;
      case "lastf":
        return `${last}${f}`;
      case "first-last":
        return `${first}-${last}`;
      default: {
        const unreachable: never = pattern;
        return unreachable;
      }
    }
  }
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. All pass. Commit:

  ```
  Build the local part each address pattern implies
  ```

- [ ] **Step 8: Write the failing test for `permuteAddresses`.**

  Append to `permute.test.ts`. The `./permute` import line becomes:

  ```ts
  import {
    PATTERN_PRIORS,
    buildLocalPart,
    normalizeDomain,
    normalizePart,
    permuteAddresses,
    type AddressCandidate,
  } from "./permute";
  ```

  ```ts
  describe("permuteAddresses", () => {
    it("returns every pattern for an ordinary name, best prior first", () => {
      const result = permuteAddresses(JANE, "acme.com");
      expect(result.map((c) => c.pattern)).toEqual([
        "first.last",
        "first",
        "flast",
        "firstlast",
        "first_last",
        "f.last",
        "last.first",
        "firstl",
        "lastf",
        "first-last",
      ]);
      expect(result.map((c) => c.address)).toEqual([
        "jane.okafor@acme.com",
        "jane@acme.com",
        "jokafor@acme.com",
        "janeokafor@acme.com",
        "jane_okafor@acme.com",
        "j.okafor@acme.com",
        "okafor.jane@acme.com",
        "janeo@acme.com",
        "okaforj@acme.com",
        "jane-okafor@acme.com",
      ]);
    });

    it("carries the prior for the pattern that generated each address", () => {
      const result = permuteAddresses(JANE, "acme.com");
      for (const candidate of result) {
        expect(candidate.prior, candidate.pattern).toBe(PATTERN_PRIORS[candidate.pattern]);
      }
    });

    it("never weakens as it goes down the list", () => {
      const priors = permuteAddresses(JANE, "acme.com").map((c) => c.prior);
      for (let i = 1; i < priors.length; i += 1) {
        expect(priors[i - 1]!).toBeGreaterThanOrEqual(priors[i]!);
      }
    });

    it("normalises the name and the domain", () => {
      const result = permuteAddresses({ first: "José", last: "Álvarez" }, "  ACME.COM ");
      expect(result[0]!.address).toBe("jose.alvarez@acme.com");
    });

    it("handles an apostrophe and a compound surname", () => {
      expect(permuteAddresses({ first: "Sean", last: "O'Brien" }, "acme.com")[0]!.address).toBe(
        "sean.obrien@acme.com",
      );
      expect(
        permuteAddresses({ first: "Anna", last: "van der Berg" }, "acme.com")[0]!.address,
      ).toBe("anna.vanderberg@acme.com");
    });

    it("emits a collapsed address once, keeping the higher-prior pattern", () => {
      // A one-letter first name collapses first.last onto f.last and flast onto
      // firstlast. Eight survive, and the survivor is the likelier explanation.
      const result = permuteAddresses({ first: "J", last: "Okafor" }, "acme.com");
      expect(result).toHaveLength(8);
      expect(result.map((c) => c.pattern)).toEqual([
        "first.last",
        "first",
        "flast",
        "first_last",
        "last.first",
        "firstl",
        "lastf",
        "first-last",
      ]);
    });

    it("never returns the same address twice, for any of these names", () => {
      const names: NameParts[] = [
        JANE,
        { first: "J", last: "Okafor" },
        { first: "Jane", last: "O" },
        { first: "A", last: "B" },
        { first: "Anna", last: "van der Berg" },
      ];
      for (const name of names) {
        const addresses = permuteAddresses(name, "acme.com").map((c) => c.address);
        expect(new Set(addresses).size, JSON.stringify(name)).toBe(addresses.length);
      }
    });

    it("is stable: the same input gives the same array every time", () => {
      const a = permuteAddresses(JANE, "acme.com");
      const b = permuteAddresses(JANE, "acme.com");
      expect(a).toEqual(b);
    });

    it("returns nothing rather than inventing something to try", () => {
      expect(permuteAddresses(JANE, "")).toEqual([]);
      expect(permuteAddresses({ first: "", last: "Okafor" }, "acme.com")).toEqual([]);
      const firstOnly: AddressCandidate[] = permuteAddresses(
        { first: "Jane", last: "" },
        "acme.com",
      );
      expect(firstOnly).toEqual([
        { address: "jane@acme.com", pattern: "first", prior: 0.12 },
      ]);
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. It must fail: `permuteAddresses is not a function`.

- [ ] **Step 9: Implement `AddressCandidate` and `permuteAddresses`.**

  Append to `permute.ts`:

  ```ts
  /** One address worth trying, and why we think so. */
  export interface AddressCandidate {
    address: string;
    pattern: PatternId;
    /** Population frequency of this pattern, 0-1. See PATTERN_PRIORS. */
    prior: number;
  }

  /**
   * Every address worth trying for this person at this domain, best first.
   *
   * Emitted in PATTERN_PRIORS order, which is already descending, so there is
   * no sort and therefore nothing for a sort to make unstable.
   *
   * Deduplicated by address, keeping the first — and therefore highest-prior —
   * pattern that produces it. A one-letter first name collapses `first.last`
   * onto `f.last`; offering that address twice would waste a slot in the list
   * and make one address look like two pieces of agreeing evidence.
   *
   * Returns an empty array when the name or the domain is unusable, rather than
   * inventing something to try.
   */
  export function permuteAddresses(name: NameParts, domain: string): AddressCandidate[] {
    const host = normalizeDomain(domain);
    if (!host) return [];

    const seen = new Set<string>();
    const candidates: AddressCandidate[] = [];

    for (const [pattern, prior] of Object.entries(PATTERN_PRIORS) as [PatternId, number][]) {
      const local = buildLocalPart(pattern, name);
      if (!local) continue;

      const address = `${local}@${host}`;
      if (seen.has(address)) continue;

      seen.add(address);
      candidates.push({ address, pattern, prior });
    }

    return candidates;
  }
  ```

  Run `npx vitest run src/lib/contacts/permute.test.ts`. All pass.

- [ ] **Step 10: Type-check, run the whole suite, and commit the permuter.**

  ```bash
  npm run typecheck && npm test
  ```

  Both must be clean — `npm test` because this is the first file in a new directory and nothing else should have moved. Commit:

  ```
  Turn a name and a domain into addresses worth trying
  ```

---

### Task 3: Pattern inference (`src/lib/contacts/pattern.ts`)

**Files:**
- Modify: `src/lib/contacts/pattern.ts` (created in Task 2 with types only; this task adds the two functions)
- Test: `src/lib/contacts/pattern.test.ts`

**Interfaces:**

- **Consumes** (from Task 2):
  ```ts
  import { buildLocalPart, normalizeDomain } from "./permute";
  ```
  Both are **value** imports, and this is the only runtime edge between the two files. `permute.ts` imports from here with `import type` only, so no cycle exists at runtime. Do not add a value import from `permute.ts` back to this file — that is the one change that would create one.

- **Owns** (declared in Task 2, unchanged here): `PatternId`, `PATTERN_IDS`, `NameParts`.

- **Produces** (relied on by `discover.ts`, `store.ts`, `hunter.ts` and the `EmailPattern` learning path):
  ```ts
  export function inferPattern(address: string, name: NameParts): PatternId | null;
  export function applyPattern(pattern: PatternId, name: NameParts, domain: string): string | null;
  ```

---

- [ ] **Step 1: Write the failing test for `applyPattern`.**

  Create `src/lib/contacts/pattern.test.ts`:

  ```ts
  /**
   * Tests for pattern inference.
   *
   * This is the module that compounds. The first confirmed address at a domain
   * identifies the rule that company follows, and every contact there
   * afterwards costs one guess instead of ten — which is the entire reason the
   * free path is worth building.
   *
   * Which makes the null return the most important behaviour in the file. When
   * two patterns both explain an address — and a one-letter first name
   * guarantees they will — there is no way to tell which rule the company uses.
   * Guessing would write a coin flip into EmailPattern.pattern, where it would
   * then be applied confidently to every future contact at that domain. The
   * wrong half of that coin costs far more than the confirmation we decline to
   * record, so ambiguous evidence must teach EmailPattern nothing at all.
   */

  import { describe, it, expect } from "vitest";
  import { applyPattern, inferPattern, PATTERN_IDS, type NameParts } from "./pattern";

  const JANE: NameParts = { first: "Jane", last: "Okafor" };

  describe("applyPattern", () => {
    it("builds the whole address, normalising both halves", () => {
      expect(applyPattern("first.last", JANE, "acme.com")).toBe("jane.okafor@acme.com");
      expect(applyPattern("flast", JANE, "ACME.COM")).toBe("jokafor@acme.com");
      expect(applyPattern("first", JANE, " @acme.com ")).toBe("jane@acme.com");
      expect(applyPattern("last.first", { first: "José", last: "Álvarez" }, "acme.com")).toBe(
        "alvarez.jose@acme.com",
      );
    });

    it("returns null when the name lacks a part the pattern needs", () => {
      expect(applyPattern("first.last", { first: "Jane", last: "" }, "acme.com")).toBeNull();
      expect(applyPattern("flast", { first: "Jane", last: "" }, "acme.com")).toBeNull();
      expect(applyPattern("first", { first: "Jane", last: "" }, "acme.com")).toBe(
        "jane@acme.com",
      );
      expect(applyPattern("first", { first: "", last: "Okafor" }, "acme.com")).toBeNull();
    });

    it("returns null rather than an address with no domain", () => {
      expect(applyPattern("first.last", JANE, "")).toBeNull();
      expect(applyPattern("first.last", JANE, "   ")).toBeNull();
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/pattern.test.ts`. It must fail: no export named `applyPattern`.

- [ ] **Step 2: Implement `applyPattern`.**

  Append to `src/lib/contacts/pattern.ts`, and add the import at the top of the file directly under the header comment:

  ```ts
  import { buildLocalPart, normalizeDomain } from "./permute";
  ```

  ```ts
  /**
   * Build the address this pattern implies. Null when the name lacks a part.
   *
   * A thin composition on purpose: the string mechanics live in permute.ts so
   * that the address this function builds and the address the permuter offers
   * are the same string by construction, not by two implementations agreeing.
   */
  export function applyPattern(
    pattern: PatternId,
    name: NameParts,
    domain: string,
  ): string | null {
    const local = buildLocalPart(pattern, name);
    const host = normalizeDomain(domain);
    if (!local || !host) return null;
    return `${local}@${host}`;
  }
  ```

  Run `npx vitest run src/lib/contacts/pattern.test.ts`. All pass. Commit:

  ```
  Build the address a known pattern implies
  ```

- [ ] **Step 3: Write the failing test for `inferPattern` on unambiguous addresses.**

  Append to `pattern.test.ts`:

  ```ts
  describe("inferPattern", () => {
    it("reads the pattern out of an unambiguous address", () => {
      expect(inferPattern("jane.okafor@acme.com", JANE)).toBe("first.last");
      expect(inferPattern("jokafor@acme.com", JANE)).toBe("flast");
      expect(inferPattern("jane@acme.com", JANE)).toBe("first");
      expect(inferPattern("okafor.jane@acme.com", JANE)).toBe("last.first");
      expect(inferPattern("janeo@acme.com", JANE)).toBe("firstl");
    });

    it("does not care what the domain is", () => {
      // The caller already knows which domain it asked about. This function
      // answers one question: what shape is this local part.
      expect(inferPattern("jane.okafor@somewhere.else.co.uk", JANE)).toBe("first.last");
      expect(inferPattern("jane.okafor", JANE)).toBe("first.last");
      expect(inferPattern("  JANE.OKAFOR@ACME.COM  ", JANE)).toBe("first.last");
    });

    it("returns null when no pattern explains the address", () => {
      expect(inferPattern("recruiting@acme.com", JANE)).toBeNull();
      expect(inferPattern("j.o.okafor@acme.com", JANE)).toBeNull();
      expect(inferPattern("", JANE)).toBeNull();
      expect(inferPattern("@acme.com", JANE)).toBeNull();
    });

    it("returns null when the name is too incomplete to explain anything", () => {
      expect(inferPattern("jane.okafor@acme.com", { first: "", last: "" })).toBeNull();
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/pattern.test.ts`. It must fail: no export named `inferPattern`.

- [ ] **Step 4: Implement `inferPattern` as first-match-wins.**

  This is the minimal implementation that satisfies the test just written, and it is deliberately wrong about ambiguity — Step 5 writes the test that catches it. Append to `pattern.ts`:

  ```ts
  /** Which pattern would have produced this address for this person? */
  export function inferPattern(address: string, name: NameParts): PatternId | null {
    const local = address.trim().toLowerCase().split("@")[0] ?? "";
    if (!local) return null;

    for (const pattern of PATTERN_IDS) {
      if (buildLocalPart(pattern, name) === local) return pattern;
    }
    return null;
  }
  ```

  Run `npx vitest run src/lib/contacts/pattern.test.ts`. All pass. Commit:

  ```
  Read a pattern back out of a confirmed address
  ```

- [ ] **Step 5: Write the failing test for ambiguity.**

  Append to `pattern.test.ts`, inside the `inferPattern` describe block:

  ```ts
    it("returns null when two patterns both explain the address", () => {
      // A one-letter first name makes first.last and f.last the same string.
      // There is nothing in "j.okafor" that says which rule acme.com follows,
      // and EmailPattern.confirmedCount must not rise on a coin flip.
      const jay: NameParts = { first: "J", last: "Okafor" };
      expect(inferPattern("j.okafor@acme.com", jay)).toBeNull();
      // Same collision one row down: flast and firstlast.
      expect(inferPattern("jokafor@acme.com", jay)).toBeNull();
    });

    it("returns null for the mirror case of a one-letter surname", () => {
      // firstlast and firstl both produce "janeo" for Jane O.
      const janeO: NameParts = { first: "Jane", last: "O" };
      expect(inferPattern("janeo@acme.com", janeO)).toBeNull();
    });

    it("still answers for the patterns a collision does not touch", () => {
      // Ambiguity is per address, not per person. "j_okafor" is produced by
      // exactly one pattern even for a one-letter first name.
      const jay: NameParts = { first: "J", last: "Okafor" };
      expect(inferPattern("j_okafor@acme.com", jay)).toBe("first_last");
      expect(inferPattern("okafor.j@acme.com", jay)).toBe("last.first");
    });
  ```

  Run `npx vitest run src/lib/contacts/pattern.test.ts`. It must fail with three assertions expecting `null` and receiving `"first.last"`, `"flast"` and `"firstlast"`.

- [ ] **Step 6: Make `inferPattern` refuse to choose between two explanations.**

  Replace the loop body in `pattern.ts` and expand the doc comment:

  ```ts
  /**
   * Which pattern would have produced this address for this person?
   *
   * Null when none would have, and — the part that matters — null when more
   * than one would have. A one-letter first name makes `first.last` and
   * `f.last` the same string, and there is no way to tell from that address
   * which rule the company follows. Ambiguous evidence teaches EmailPattern
   * nothing: a coin flip written into EmailPattern.pattern gets applied
   * confidently to every later contact at that domain, so the wrong half of the
   * coin costs far more than the confirmation we decline to record.
   *
   * The domain is ignored. The caller knows which domain it asked about; this
   * function answers only "what shape is this local part".
   */
  export function inferPattern(address: string, name: NameParts): PatternId | null {
    const local = address.trim().toLowerCase().split("@")[0] ?? "";
    if (!local) return null;

    let only: PatternId | null = null;
    for (const pattern of PATTERN_IDS) {
      if (buildLocalPart(pattern, name) !== local) continue;
      if (only !== null) return null; // two explanations is no explanation
      only = pattern;
    }
    return only;
  }
  ```

  Run `npx vitest run src/lib/contacts/pattern.test.ts`. All pass. Commit:

  ```
  Refuse to name a pattern when two of them fit
  ```

- [ ] **Step 7: Write the round-trip property test across every `PatternId`.**

  Append to `pattern.test.ts`. This should pass on the first run — it is a property guard over the two functions, not a new behaviour. If it fails, the failure is real and the implementation is wrong; do not weaken the test.

  ```ts
  describe("applyPattern and inferPattern round-trip", () => {
    it("recovers every pattern it built, for a name with no collisions", () => {
      // Jane Okafor produces ten distinct local parts, so every one of them has
      // exactly one explanation. That is what makes this a fair round trip.
      for (const pattern of PATTERN_IDS) {
        const address = applyPattern(pattern, JANE, "acme.com");
        expect(address, pattern).not.toBeNull();
        expect(inferPattern(address!, JANE), pattern).toBe(pattern);
      }
    });

    it("produces ten distinct addresses for that name, which is why it round-trips", () => {
      const built = PATTERN_IDS.map((p) => applyPattern(p, JANE, "acme.com"));
      expect(new Set(built).size).toBe(PATTERN_IDS.length);
    });

    it("round-trips a name that needed normalising", () => {
      const sean: NameParts = { first: "Seán", last: "O'Brien" };
      for (const pattern of PATTERN_IDS) {
        const address = applyPattern(pattern, sean, "acme.com");
        expect(address, pattern).not.toBeNull();
        expect(inferPattern(address!, sean), pattern).toBe(pattern);
      }
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/pattern.test.ts`. All pass.

- [ ] **Step 8: Type-check, run the whole suite, and commit the round-trip guard.**

  ```bash
  npm run typecheck && npm test
  ```

  `npm run typecheck` is the step that proves the two-file import arrangement is legal — a real cycle would show up here or as a runtime `undefined` in the vitest run. Commit:

  ```
  Prove every pattern survives being built and read back
  ```

---

### Task 4: Confidence scoring (`src/lib/contacts/score.ts`)

**Files:**
- Create: `src/lib/contacts/score.ts`
- Test: `src/lib/contacts/score.test.ts`

**Interfaces:**

- **Consumes:** nothing. `score.ts` imports no other module in the feature — not even `PatternId`. It takes a flat bag of already-gathered signals, which is what lets it be total and trivially testable. `prior` arrives as a number from `AddressCandidate.prior` (Task 2); `matchesDomainPattern` arrives as a boolean the caller computed from `inferPattern` (Task 3). Neither dependency is an import.

- **Produces** (relied on by `discover.ts` and by `ContactEmail.confidence`):
  ```ts
  export interface AddressSignals {
    replied: boolean;
    hardBounced: boolean;
    hunterVerified: boolean | null;
    gravatarHit: boolean;
    daysSinceSentClean: number | null;
    matchesDomainPattern: boolean;
    prior: number;
  }
  export function scoreAddress(signals: AddressSignals): number;

  export const REPLIED_WEIGHT: number;
  export const HUNTER_VERIFIED_WEIGHT: number;
  export const HUNTER_UNKNOWN_WEIGHT: number;
  export const GRAVATAR_WEIGHT: number;
  export const DOMAIN_PATTERN_WEIGHT: number;
  export const CLEAN_SEND_WEIGHT: number;
  export const CLEAN_SEND_FULL_CREDIT_DAYS: number;
  export const PRIOR_WEIGHT: number;
  ```
  The weights are exported so the tests assert against the named constants rather than against magic numbers, and so a future measured re-weighting has one place to happen. They sum to exactly 100 at maximum, which is why no clamp is needed at the top of the range.

---

- [ ] **Step 1: Write the failing test for the hard-bounce floor.**

  Create `src/lib/contacts/score.test.ts` with the header and the floor test. The floor is the one rule that overrides every other, so it goes in first.

  ```ts
  /**
   * Tests for address confidence.
   *
   * The number this produces is written to ContactEmail.confidence and decides
   * the order a human reads ten guesses in, so two properties matter more than
   * any individual weight.
   *
   * It is total. Every possible AddressSignals — including contradictory ones,
   * including a NaN that arrived from somewhere upstream — produces an integer
   * between 0 and 100. There is no input this function may decline to answer,
   * because there is nothing sensible for the caller to do with a refusal.
   *
   * And it never punishes silence. A missing Gravatar, an unconsulted Hunter,
   * an address never written to — none of them subtract. Most corporate
   * addresses have never been near Gravatar, and letting a 404 push a correct
   * address down the list would make the free path worse than no path at all.
   * SILENCE IS NEVER A YES, and it is never a no either.
   */

  import { describe, it, expect } from "vitest";
  import { scoreAddress, type AddressSignals } from "./score";

  /** Nothing has been learned yet. Hunter was not consulted, not consulted-and-no. */
  const NOTHING_KNOWN: AddressSignals = {
    replied: false,
    hardBounced: false,
    hunterVerified: null,
    gravatarHit: false,
    daysSinceSentClean: null,
    matchesDomainPattern: false,
    prior: 0,
  };

  /** Every signal combination worth checking a property against. 480 of them. */
  function everySignalSet(hardBounced: boolean): AddressSignals[] {
    const out: AddressSignals[] = [];
    for (const replied of [false, true]) {
      for (const hunterVerified of [false, null, true] as (boolean | null)[]) {
        for (const gravatarHit of [false, true]) {
          for (const matchesDomainPattern of [false, true]) {
            for (const daysSinceSentClean of [null, 0, 3, 14, 60] as (number | null)[]) {
              for (const prior of [0, 0.01, 0.34, 1]) {
                out.push({
                  replied,
                  hardBounced,
                  hunterVerified,
                  gravatarHit,
                  daysSinceSentClean,
                  matchesDomainPattern,
                  prior,
                });
              }
            }
          }
        }
      }
    }
    return out;
  }

  describe("scoreAddress and a hard bounce", () => {
    it("floors the score at zero from every starting point", () => {
      for (const signals of everySignalSet(true)) {
        expect(scoreAddress(signals), JSON.stringify(signals)).toBe(0);
      }
    });

    it("floors a hard-bounced address that also replied", () => {
      // Contradictory on its face: a reply proves the mailbox exists and a
      // 5.x.x proves it does not. In the world it means the mailbox was closed
      // after the reply, or the DSN named the wrong recipient. The function is
      // total and cannot throw at a contradiction, so it has to resolve it, and
      // the spec resolves it one way — hardBounced overrides everything. The
      // cost of being wrong here is one address the person can re-enter by
      // hand; the cost the other way is recommending a mailbox that is gone.
      expect(
        scoreAddress({
          ...NOTHING_KNOWN,
          replied: true,
          hardBounced: true,
          hunterVerified: true,
          gravatarHit: true,
          matchesDomainPattern: true,
          daysSinceSentClean: 90,
          prior: 0.34,
        }),
      ).toBe(0);
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. It must fail: `Failed to resolve import "./score"`.

- [ ] **Step 2: Create `score.ts` with the interface and the bounce floor only.**

  ```ts
  /**
   * How much to believe one candidate address (spec §26, design section 3
   * step 3).
   *
   * Pure, synchronous and total: every possible AddressSignals produces an
   * integer between 0 and 100, and the same input always gives the same number.
   * That totality is not decoration — the result is written to
   * ContactEmail.confidence and used to order what a human reads, so there is
   * no useful way for this function to decline to answer.
   *
   * The weights below encode one ordering, and the ordering is the design:
   *
   *   replied > hunterVerified > gravatarHit > daysSinceSentClean > prior
   *   hardBounced overrides everything and floors the score at 0
   *
   * Ground truth first, inference last. A reply is proof. A prior is a guess
   * about a population this particular company may not belong to.
   *
   * The other half of the design is what is absent: no signal subtracts except
   * a hard bounce. "No Gravatar", "Hunter not asked", "never written to" all
   * score zero, because they are absence of evidence rather than evidence of
   * absence. Most corporate addresses have never been near Gravatar; letting a
   * 404 push a correct address down the list would make the free path worse
   * than no path.
   */

  /** What is known about one candidate address at the moment it is scored. */
  export interface AddressSignals {
    /** A reply arrived from this address. Ground truth. */
    replied: boolean;
    /** A hard (5.x.x) bounce named this address. Ground truth, negative. */
    hardBounced: boolean;
    /** Hunter's verdict, or null when Hunter was not consulted. */
    hunterVerified: boolean | null;
    /** A Gravatar exists for this address. Positive-only; see section 4. */
    gravatarHit: boolean;
    /** Days since a message to this address was marked sent with no bounce. */
    daysSinceSentClean: number | null;
    /** This address matches the learned pattern for its domain. */
    matchesDomainPattern: boolean;
    /** Population prior for the pattern that generated it. */
    prior: number;
  }

  /** 0–100. Monotonic in every positive signal. */
  export function scoreAddress(signals: AddressSignals): number {
    if (signals.hardBounced) return 0;
    return 0;
  }
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. Both pass. Commit:

  ```
  Let a hard bounce end the argument about an address
  ```

- [ ] **Step 3: Write the failing test for the two ends of the chain — replied and prior.**

  Append to `score.test.ts`, extending the import to `import { PRIOR_WEIGHT, REPLIED_WEIGHT, scoreAddress, type AddressSignals } from "./score";`.

  ```ts
  describe("ground truth outranks the population prior", () => {
    it("pays for a reply", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, replied: true })).toBe(
        scoreAddress(NOTHING_KNOWN) + REPLIED_WEIGHT,
      );
    });

    it("pays for the prior in proportion to it", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, prior: 1 })).toBe(
        scoreAddress(NOTHING_KNOWN) + PRIOR_WEIGHT,
      );
      expect(scoreAddress({ ...NOTHING_KNOWN, prior: 0 })).toBe(scoreAddress(NOTHING_KNOWN));
    });

    it("clamps a prior that arrived out of range instead of trusting it", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, prior: 5 })).toBe(
        scoreAddress({ ...NOTHING_KNOWN, prior: 1 }),
      );
      expect(scoreAddress({ ...NOTHING_KNOWN, prior: -3 })).toBe(
        scoreAddress({ ...NOTHING_KNOWN, prior: 0 }),
      );
    });

    it("ranks a reply far above the best prior any pattern has", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, replied: true })).toBeGreaterThan(
        scoreAddress({ ...NOTHING_KNOWN, prior: 1 }),
      );
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. It must fail: no export named `REPLIED_WEIGHT`.

- [ ] **Step 4: Implement the reply and prior weights.**

  Insert above `scoreAddress` in `score.ts`:

  ```ts
  /**
   * A reply. The single strongest thing that can be known about an address, and
   * weighted so that nothing else, in any combination, outranks it.
   */
  export const REPLIED_WEIGHT = 40;

  /**
   * The population prior for the pattern that generated the address, scaled by
   * the prior itself (0-1). Deliberately the smallest term here: it says
   * something about companies in general and nothing about this one.
   */
  export const PRIOR_WEIGHT = 4;

  /**
   * Keep a number inside a range, and treat a NaN or an Infinity as the bottom
   * of it.
   *
   * Nothing upstream should hand this function a NaN, but "should" is not a
   * guarantee and a NaN would propagate straight through Math.round into
   * ContactEmail.confidence, where it becomes a database write that fails at
   * 2am. Totality is a promise this function makes; this is where it keeps it.
   */
  function clamp(value: number, low: number, high: number): number {
    if (!Number.isFinite(value)) return low;
    return Math.min(Math.max(value, low), high);
  }
  ```

  And replace the body of `scoreAddress`:

  ```ts
  export function scoreAddress(signals: AddressSignals): number {
    if (signals.hardBounced) return 0;

    let score = 0;
    if (signals.replied) score += REPLIED_WEIGHT;
    score += PRIOR_WEIGHT * clamp(signals.prior, 0, 1);

    return Math.round(clamp(score, 0, 100));
  }
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. All pass. Commit:

  ```
  Weigh a reply against the population prior
  ```

- [ ] **Step 5: Write the failing test for Hunter's three-valued verdict.**

  Append to `score.test.ts`, adding `HUNTER_UNKNOWN_WEIGHT` and `HUNTER_VERIFIED_WEIGHT` to the import.

  ```ts
  describe("Hunter's verdict has three values, not two", () => {
    it("ranks not-consulted strictly between invalid and valid", () => {
      // "Hunter was never asked" and "Hunter said this address is invalid" are
      // different facts, and collapsing them would make an unconfigured key
      // look like a wall of rejected addresses.
      const no = scoreAddress({ ...NOTHING_KNOWN, hunterVerified: false });
      const unasked = scoreAddress({ ...NOTHING_KNOWN, hunterVerified: null });
      const yes = scoreAddress({ ...NOTHING_KNOWN, hunterVerified: true });
      expect(no).toBeLessThan(unasked);
      expect(unasked).toBeLessThan(yes);
    });

    it("holds that ordering with other signals already in the score", () => {
      const base = { ...NOTHING_KNOWN, gravatarHit: true, matchesDomainPattern: true };
      const no = scoreAddress({ ...base, hunterVerified: false });
      const unasked = scoreAddress({ ...base, hunterVerified: null });
      const yes = scoreAddress({ ...base, hunterVerified: true });
      expect(no).toBeLessThan(unasked);
      expect(unasked).toBeLessThan(yes);
    });

    it("scores an invalid verdict as zero credit, never as a penalty", () => {
      // Hunter's `invalid` is weak negative evidence, and the way that is
      // expressed here is by withholding the credit the other two verdicts get
      // — not by subtracting. Nothing in this function goes below zero except a
      // hard bounce, so no combination of weak negatives can bury a real
      // address.
      expect(scoreAddress({ ...NOTHING_KNOWN, hunterVerified: false })).toBe(0);
      expect(
        scoreAddress({ ...NOTHING_KNOWN, hunterVerified: false, replied: true }),
      ).toBe(REPLIED_WEIGHT);
    });

    it("ranks a reply above a Hunter verification", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, replied: true })).toBeGreaterThan(
        scoreAddress({ ...NOTHING_KNOWN, hunterVerified: true }),
      );
      expect(REPLIED_WEIGHT).toBeGreaterThan(HUNTER_VERIFIED_WEIGHT);
      expect(HUNTER_VERIFIED_WEIGHT).toBeGreaterThan(HUNTER_UNKNOWN_WEIGHT);
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. It must fail: no export named `HUNTER_UNKNOWN_WEIGHT`.

- [ ] **Step 6: Implement the Hunter weights.**

  Add to `score.ts` beneath `REPLIED_WEIGHT`:

  ```ts
  /** Hunter said the address is valid. Strong, but an API's opinion, not a reply. */
  export const HUNTER_VERIFIED_WEIGHT = 25;

  /**
   * Hunter was not consulted — no key, no quota, or the question was already
   * settled.
   *
   * Small, and positive on purpose. It exists so that "not asked" sits strictly
   * above "asked and told no" without anything having to go negative. An
   * unconfigured Hunter is an ordinary state, the same way an unconfigured
   * mailbox is, and the free path must not look like a wall of rejections.
   */
  export const HUNTER_UNKNOWN_WEIGHT = 5;
  ```

  And add to `scoreAddress`, after the `replied` line:

  ```ts
    if (signals.hunterVerified === true) score += HUNTER_VERIFIED_WEIGHT;
    else if (signals.hunterVerified === null) score += HUNTER_UNKNOWN_WEIGHT;
    // false adds nothing. It does not subtract; see HUNTER_UNKNOWN_WEIGHT.
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. All pass. Commit:

  ```
  Tell an unasked Hunter apart from one that said no
  ```

- [ ] **Step 7: Write the failing test for Gravatar, including the named silence test.**

  Append to `score.test.ts`, adding `GRAVATAR_WEIGHT` to the import.

  ```ts
  describe("a missing Gravatar is absence of evidence, never a negative", () => {
    // This is the spec's "silence is never a yes" rule, stated the other way
    // round. A 200 from Gravatar means a human registered that exact address,
    // so the address is real. A 404 means nothing whatsoever — most corporate
    // addresses have never been near Gravatar. Scoring the 404 as a negative
    // would demote correct addresses at exactly the companies this app is
    // for, and there is no GRAVATAR_MISS state in ContactEmailStatus precisely
    // so that nobody is tempted to record one.

    it("costs a correct address nothing when no avatar exists", () => {
      const noAvatar = { ...NOTHING_KNOWN, prior: 0.34, gravatarHit: false };
      // Exactly what the other signals earn: 5 for an unasked Hunter plus
      // 4 * 0.34 for the prior, rounded once at the end.
      expect(scoreAddress(noAvatar)).toBe(6);
    });

    it("only ever adds, from every baseline", () => {
      // The deltas are checked from baselines whose other terms are whole
      // numbers, so a rounding difference cannot be mistaken for a weighting
      // one.
      const baselines: AddressSignals[] = [
        { ...NOTHING_KNOWN },
        { ...NOTHING_KNOWN, prior: 1 },
        { ...NOTHING_KNOWN, replied: true, prior: 1 },
        { ...NOTHING_KNOWN, hunterVerified: true, matchesDomainPattern: true, prior: 1 },
        { ...NOTHING_KNOWN, hunterVerified: false, daysSinceSentClean: 14 },
      ];
      for (const base of baselines) {
        const without = scoreAddress({ ...base, gravatarHit: false });
        const with_ = scoreAddress({ ...base, gravatarHit: true });
        expect(with_ - without, JSON.stringify(base)).toBe(GRAVATAR_WEIGHT);
      }
    });

    it("ranks an avatar below a Hunter verification and above a prior", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, hunterVerified: true })).toBeGreaterThan(
        scoreAddress({ ...NOTHING_KNOWN, gravatarHit: true }),
      );
      expect(scoreAddress({ ...NOTHING_KNOWN, gravatarHit: true })).toBeGreaterThan(
        scoreAddress({ ...NOTHING_KNOWN, prior: 1 }),
      );
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. It must fail: no export named `GRAVATAR_WEIGHT`.

- [ ] **Step 8: Implement the Gravatar weight.**

  Add to `score.ts`:

  ```ts
  /**
   * A Gravatar exists for this address. Positive-only, and there is no
   * counterpart constant for its absence because there is no such signal.
   */
  export const GRAVATAR_WEIGHT = 15;
  ```

  And in `scoreAddress`, after the Hunter block:

  ```ts
    if (signals.gravatarHit) score += GRAVATAR_WEIGHT;
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. All pass. Commit:

  ```
  Let a Gravatar count for something and its absence for nothing
  ```

- [ ] **Step 9: Write the failing test for the clean-send window and the pattern match.**

  Append to `score.test.ts`, adding `CLEAN_SEND_FULL_CREDIT_DAYS`, `CLEAN_SEND_WEIGHT` and `DOMAIN_PATTERN_WEIGHT` to the import.

  ```ts
  describe("a send that did not bounce", () => {
    it("is worth nothing until a message has actually gone out", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, daysSinceSentClean: null })).toBe(
        scoreAddress(NOTHING_KNOWN),
      );
      expect(scoreAddress({ ...NOTHING_KNOWN, daysSinceSentClean: 0 })).toBe(
        scoreAddress(NOTHING_KNOWN),
      );
    });

    it("earns full credit after the waiting window and no more", () => {
      const full = scoreAddress({
        ...NOTHING_KNOWN,
        daysSinceSentClean: CLEAN_SEND_FULL_CREDIT_DAYS,
      });
      expect(full).toBe(scoreAddress(NOTHING_KNOWN) + CLEAN_SEND_WEIGHT);
      expect(scoreAddress({ ...NOTHING_KNOWN, daysSinceSentClean: 365 })).toBe(full);
    });

    it("treats a negative day count as no elapsed time rather than a penalty", () => {
      // A clock skew between the mail server and this machine must not make an
      // address look worse than one never written to.
      expect(scoreAddress({ ...NOTHING_KNOWN, daysSinceSentClean: -7 })).toBe(
        scoreAddress(NOTHING_KNOWN),
      );
    });

    it("is worth less than an avatar and more than a prior", () => {
      // Weak everywhere on purpose: a catch-all domain never bounces, so on
      // those domains a clean send is evidence of literally nothing, and there
      // is no way to detect a catch-all without sending.
      expect(GRAVATAR_WEIGHT).toBeGreaterThan(CLEAN_SEND_WEIGHT);
      expect(CLEAN_SEND_WEIGHT).toBeGreaterThan(PRIOR_WEIGHT);
    });
  });

  describe("matching the domain's learned pattern", () => {
    it("adds its weight and nothing more", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, matchesDomainPattern: true })).toBe(
        scoreAddress(NOTHING_KNOWN) + DOMAIN_PATTERN_WEIGHT,
      );
    });

    it("counts for less than a Gravatar hit", () => {
      // An avatar is a person who registered this exact address. A pattern
      // match is an inference from other people at the same company.
      expect(GRAVATAR_WEIGHT).toBeGreaterThan(DOMAIN_PATTERN_WEIGHT);
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. It must fail: no export named `CLEAN_SEND_WEIGHT`.

- [ ] **Step 10: Implement the clean-send and pattern-match weights.**

  Add to `score.ts`:

  ```ts
  /** This address matches the pattern learned for its domain. An inference. */
  export const DOMAIN_PATTERN_WEIGHT = 10;

  /**
   * A message was marked sent to this address and no bounce came back.
   *
   * Weak everywhere, deliberately. A catch-all domain accepts all mail and
   * never bounces, so on those domains this signal is evidence of nothing at
   * all — and there is no way to detect a catch-all from our side without
   * sending. Credit ramps to the full weight over CLEAN_SEND_FULL_CREDIT_DAYS
   * and stops; a bounce that has not arrived in two weeks is not going to.
   */
  export const CLEAN_SEND_WEIGHT = 6;
  export const CLEAN_SEND_FULL_CREDIT_DAYS = 14;
  ```

  And in `scoreAddress`, after the Gravatar line:

  ```ts
    if (signals.matchesDomainPattern) score += DOMAIN_PATTERN_WEIGHT;

    if (signals.daysSinceSentClean !== null) {
      const days = clamp(signals.daysSinceSentClean, 0, CLEAN_SEND_FULL_CREDIT_DAYS);
      score += (CLEAN_SEND_WEIGHT * days) / CLEAN_SEND_FULL_CREDIT_DAYS;
    }
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. All pass. Commit:

  ```
  Score a quiet mailbox and a matching pattern, both weakly
  ```

- [ ] **Step 11: Write the spec's ordering line as a single test.**

  Append to `score.test.ts`. Every weight now exists, so this should pass on the first run — it is the summary assertion that the five terms really do rank the way the design document says. If it fails, a weight is wrong; fix the weight, not the test.

  ```ts
  describe("the ordering the design document specifies", () => {
    it("holds pairwise: replied > hunterVerified > gravatarHit > daysSinceSentClean > prior", () => {
      // Each entry is the baseline plus exactly one signal, at its maximum.
      const ranked: [string, AddressSignals][] = [
        ["replied", { ...NOTHING_KNOWN, replied: true }],
        ["hunterVerified", { ...NOTHING_KNOWN, hunterVerified: true }],
        ["gravatarHit", { ...NOTHING_KNOWN, gravatarHit: true }],
        [
          "daysSinceSentClean",
          { ...NOTHING_KNOWN, daysSinceSentClean: CLEAN_SEND_FULL_CREDIT_DAYS },
        ],
        ["prior", { ...NOTHING_KNOWN, prior: 1 }],
      ];
      for (let i = 1; i < ranked.length; i += 1) {
        const [strongerName, stronger] = ranked[i - 1]!;
        const [weakerName, weaker] = ranked[i]!;
        expect(
          scoreAddress(stronger),
          `${strongerName} must outrank ${weakerName}`,
        ).toBeGreaterThan(scoreAddress(weaker));
      }
    });

    it("reaches exactly 100 when every signal is at its best", () => {
      // The weights sum to 100 by construction, so nothing is ever clipped at
      // the top and the ordering stays strict across the whole range.
      expect(
        scoreAddress({
          replied: true,
          hardBounced: false,
          hunterVerified: true,
          gravatarHit: true,
          daysSinceSentClean: 365,
          matchesDomainPattern: true,
          prior: 1,
        }),
      ).toBe(100);
    });

    it("reaches exactly 0 when nothing is known and Hunter said no", () => {
      expect(scoreAddress({ ...NOTHING_KNOWN, hunterVerified: false })).toBe(0);
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. All pass.

- [ ] **Step 12: Write the monotonicity property test over all 480 signal sets.**

  Append to `score.test.ts`. This should also pass on the first run; it is the guard that stops a future re-weighting from introducing a signal that makes an address look worse for being better known.

  ```ts
  describe("monotonicity", () => {
    it("never lowers the score when a positive signal improves", () => {
      for (const base of everySignalSet(false)) {
        const before = scoreAddress(base);
        const label = JSON.stringify(base);

        expect(scoreAddress({ ...base, replied: true }), label).toBeGreaterThanOrEqual(before);
        expect(scoreAddress({ ...base, gravatarHit: true }), label).toBeGreaterThanOrEqual(
          before,
        );
        expect(
          scoreAddress({ ...base, matchesDomainPattern: true }),
          label,
        ).toBeGreaterThanOrEqual(before);
        expect(
          scoreAddress({ ...base, prior: Math.min(base.prior + 0.1, 1) }),
          label,
        ).toBeGreaterThanOrEqual(before);

        if (base.daysSinceSentClean !== null) {
          expect(
            scoreAddress({ ...base, daysSinceSentClean: base.daysSinceSentClean + 1 }),
            label,
          ).toBeGreaterThanOrEqual(before);
        } else {
          expect(
            scoreAddress({ ...base, daysSinceSentClean: 0 }),
            label,
          ).toBeGreaterThanOrEqual(before);
        }

        // Hunter improves in two steps: invalid -> not consulted -> valid.
        if (base.hunterVerified === false) {
          expect(
            scoreAddress({ ...base, hunterVerified: null }),
            label,
          ).toBeGreaterThanOrEqual(before);
        }
        if (base.hunterVerified !== true) {
          expect(
            scoreAddress({ ...base, hunterVerified: true }),
            label,
          ).toBeGreaterThanOrEqual(before);
        }
      }
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. All pass. Commit:

  ```
  Pin the ordering and monotonicity the scorer promises
  ```

- [ ] **Step 13: Write the failing test for totality against hostile input.**

  Append to `score.test.ts`. The NaN case is a genuine red — `Math.round(NaN)` is `NaN`, and without the `Number.isFinite` guard inside `clamp` it would reach `ContactEmail.confidence`.

  ```ts
  describe("totality", () => {
    it("returns a whole number between 0 and 100 for every signal set", () => {
      for (const hardBounced of [false, true]) {
        for (const signals of everySignalSet(hardBounced)) {
          const score = scoreAddress(signals);
          expect(Number.isInteger(score), JSON.stringify(signals)).toBe(true);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }
      }
    });

    it("survives a number that should never have reached it", () => {
      // Nothing upstream should produce these. "Should" is not a guarantee, and
      // a NaN here becomes a failed database write hours later and a long way
      // from its cause.
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(Number.isInteger(scoreAddress({ ...NOTHING_KNOWN, prior: bad })), `prior ${bad}`).toBe(
          true,
        );
        expect(
          Number.isInteger(scoreAddress({ ...NOTHING_KNOWN, daysSinceSentClean: bad })),
          `days ${bad}`,
        ).toBe(true);
      }
      expect(scoreAddress({ ...NOTHING_KNOWN, prior: Number.NaN })).toBe(
        scoreAddress({ ...NOTHING_KNOWN, prior: 0 }),
      );
    });
  });
  ```

  Run `npx vitest run src/lib/contacts/score.test.ts`. If `clamp` was written exactly as specified in Step 4, the NaN cases already pass and only the range sweep is new; if `clamp` is missing its `Number.isFinite` guard, this is where it fails — add the guard, do not relax the test.

- [ ] **Step 14: Type-check, run the whole suite, and commit the scorer.**

  ```bash
  npm run typecheck && npm test
  ```

  Both clean. Commit:

  ```
  Rank a guessed address by what is actually known about it
  ```

---

> **Hazard — read before you create any file in these two tasks.**
> Every file below is dense with `\r\n`, `=2E`, `=?utf-8?B?` and raw CR/LF bytes.
> This repository's own notes record ten minutes lost to a bash heredoc turning
> a `\b` escape into a literal 0x08 byte in a committed source file. **Create
> and edit every file in Task 5 and Task 6 with the Write/Edit tools or an
> editor — never `cat <<'EOF'`, never `echo`, never `printf`.** The `.eml`
> fixtures are the worst offenders: a shell that "helpfully" interprets a
> backslash or strips a trailing space produces a fixture that passes for real
> and tests nothing.
>
> For the same reason the fixtures are stored on disk with **LF** and converted
> to CRLF by the test loader (see Task 6, Step 6). A `.eml` file stored with
> literal CRLF is at the mercy of `core.autocrlf` on a Windows checkout; a
> fixture whose line endings silently change is a fixture that stops testing the
> thing it exists to test.

---

### Task 5: RFC 5322 MIME composition (`src/lib/outreach/compose.ts`)

**Files:**
- Create: `src/lib/outreach/compose.ts`
- Test: `src/lib/outreach/compose.test.ts`

**Interfaces:**

- Consumes: nothing. No earlier task, no repository module, no npm dependency —
  Node's `Buffer` is the only thing imported. The module is pure: same input,
  same output, no clock, no randomness, no network, no database.
- Produces:

  ```ts
  export function composeMime(message: {
    from: string;
    to: string;
    subject: string;
    body: string;
    date: Date;
  }): string;

  /** "Tue, 15 Sep 2026 14:12:42 +0000". Always UTC — see Step 3. */
  export function formatRfc5322Date(date: Date): string;

  /** RFC 2047 encoded-words for a header value, or the value unchanged if ASCII. */
  export function encodeSubjectValue(subject: string): string;
  ```

  `deliver.ts` (`appendDraft`) is the only downstream consumer and it uses
  `composeMime` alone: it passes the returned string straight to
  `imapflow.append()`. `formatRfc5322Date` and `encodeSubjectValue` are exported
  so the tests can pin them directly; nothing else should import them.

**Decisions this task commits to, and why:**

- **Content-Transfer-Encoding is `quoted-printable`, not base64.** Three
  reasons, in order of weight. (1) The 998-octet hard line limit of RFC 5322 has
  to be satisfied for *any* body, and quoted-printable's soft line break (`=` at
  end of line) does that without touching the text the person wrote — base64
  does it by making the body unreadable. (2) The candidate will open this draft
  in his own mail client and may well look at the source; a draft whose body
  reads as prose is one he can sanity-check before sending, and this whole
  feature is built around a human reviewing before anything leaves. (3) Base64
  inflates the body by a third for a message that is almost entirely ASCII
  prose. The one thing base64 would buy — never having to think about a line
  starting with `.` — is bought here for two lines of code instead.
- **The `Message-ID` is derived, not random.** `crypto.randomUUID()` would make
  the function impure and its output untestable beyond a shape assertion. The id
  is instead a FNV-1a fingerprint of `from`, `to`, `subject` and `body` joined
  with the timestamp, so the same draft composed twice yields the same id and a
  test can assert the exact string. Two byte-identical messages at the same
  millisecond colliding is the correct behaviour, not a bug.
- **The `Date` header is always `+0000`.** Computed from `getUTC*`, so the test
  suite does not pass in Denver and fail in CI.

---

- [ ] **Step 1: Failing test for the overall message shape, then the skeleton.**

  Create `src/lib/outreach/compose.test.ts`:

  ```ts
  /**
   * Tests for building the raw message that goes into the Drafts folder.
   *
   * The one that matters: IMAP is strict about CRLF, and a draft containing a
   * bare LF is one that some mail clients refuse to open. The candidate would
   * discover that at the moment he sat down to send an introduction to a
   * recruiter — which is the worst possible moment — so "no lone newline
   * survives anywhere" gets its own test rather than being a property nobody
   * checks.
   */

  import { describe, expect, it } from "vitest";
  import { composeMime } from "./compose";

  const BASE = {
    from: "Alex Candidate <candidate@example.com>",
    to: "jane.okafor@acme-robotics.com",
    subject: "Software engineering internship - Summer 2027",
    body: "Hi Jane,\n\nI am a junior at State University.\n\nAlex",
    date: new Date(Date.UTC(2026, 8, 15, 14, 12, 42)),
  };

  describe("composeMime", () => {
    it("writes the headers a draft needs, then a blank line, then the body", () => {
      const mime = composeMime(BASE);
      const [headerBlock, ...rest] = mime.split("\r\n\r\n");
      const headers = (headerBlock ?? "").split("\r\n");

      expect(headers[0]).toBe("From: Alex Candidate <candidate@example.com>");
      expect(headers[1]).toBe("To: jane.okafor@acme-robotics.com");
      expect(headers[2]).toBe("Subject: Software engineering internship - Summer 2027");
      expect(headers).toContain("MIME-Version: 1.0");
      expect(headers).toContain("Content-Type: text/plain; charset=utf-8");
      expect(headers).toContain("Content-Transfer-Encoding: quoted-printable");
      expect(rest.join("\r\n\r\n")).toContain("Hi Jane,");
    });
  });
  ```

  Run `npx vitest run src/lib/outreach/compose.test.ts` — it fails to resolve
  `./compose`. Now create `src/lib/outreach/compose.ts` with the doc comment and
  just enough to pass:

  ```ts
  /**
   * Building the raw message that goes into the candidate's Drafts folder.
   *
   * This app never sends mail. What it produces is a draft a human reads before
   * it goes anywhere, written into his own mailbox over IMAP APPEND — so the
   * bytes here are handed to a mail server and to a mail client, both of which
   * are stricter than a browser. IMAP wants CRLF everywhere, RFC 5322 refuses a
   * line over 998 octets, and a Subject carrying a name like "Bjorn Sorensen"
   * spelled properly has to be RFC 2047 encoded or it arrives as mojibake to
   * the one person the candidate is trying to impress.
   *
   * Pure: a message object in, a string out. No clock, no randomness, no
   * network — every rule about what a valid draft looks like is testable
   * without a mailbox.
   */

  /** RFC 5322 §2.1.1: no line may exceed this, CRLF excluded. Not negotiable. */
  const HARD_LINE_LIMIT = 998;

  /** The same section's SHOULD. Headers fold here out of politeness. */
  const SOFT_LINE_LIMIT = 78;

  /** RFC 2045: a quoted-printable line carries at most 76 octets, "=" included. */
  const QP_LINE_LIMIT = 76;

  /**
   * Break a quoted-printable line here rather than at 75.
   *
   * The slack absorbs the two cases that would otherwise overshoot: a three-
   * character "=XX" escape landing on the boundary, and a trailing space having
   * to be re-encoded as "=20" before a soft break.
   */
  const QP_SOFT_BREAK_AT = 72;

  export function composeMime(message: {
    from: string;
    to: string;
    subject: string;
    body: string;
    date: Date;
  }): string {
    const headers = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
    ];
    return `${headers.join("\r\n")}\r\n\r\n${message.body}\r\n`;
  }
  ```

  Run the file again — green. Commit: `Start composing drafts as real RFC 5322 messages`.

- [ ] **Step 2: The named CRLF test — no lone newline survives anywhere.**

  Add to `compose.test.ts`, inside the `describe`:

  ```ts
    // Named on purpose. A bare LF produces a draft some clients refuse to open,
    // and the failure surfaces in the candidate's mail client rather than here.
    it("uses CRLF throughout and lets no lone LF or CR survive", () => {
      const mime = composeMime({
        ...BASE,
        subject: "Line\nendings",
        body: "One\nTwo\rThree\r\nFour\n",
      });

      // Strip every legitimate CRLF pair; nothing newline-shaped may remain.
      expect(mime.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
      expect(mime.endsWith("\r\n")).toBe(true);
    });
  ```

  Run it — fails: the body's `\n` and `\r` pass straight through. Replace the
  body handling in `composeMime` with a normalising splitter and add the helper:

  ```ts
  /** Every newline shape the caller might hand us becomes a single "\n". */
  function toLines(text: string): string[] {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }
  ```

  and in `composeMime` use `toLines(message.body).join("\r\n")` for the body and
  `message.subject.replace(/[\r\n]+/g, " ")` for the subject — a newline inside
  a header value is header injection, and collapsing it to a space is the only
  safe reading of a caller that put one there. Run — green. Commit:
  `Collapse every newline shape to the CRLF a draft requires`.

- [ ] **Step 3: An RFC 5322 `Date` header, always in UTC.**

  Add:

  ```ts
    it("writes an RFC 5322 Date header in UTC so the test is not timezone-bound", () => {
      const mime = composeMime(BASE);
      expect(mime).toContain("Date: Tue, 15 Sep 2026 14:12:42 +0000\r\n");
    });

    it("pads single-digit days and hours", () => {
      expect(formatRfc5322Date(new Date(Date.UTC(2027, 0, 5, 3, 4, 5)))).toBe(
        "Tue, 05 Jan 2027 03:04:05 +0000",
      );
    });
  ```

  and add `formatRfc5322Date` to the import. Run — fails. Implement:

  ```ts
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  /**
   * "Tue, 15 Sep 2026 14:12:42 +0000".
   *
   * Always UTC, never the host's zone: a draft composed on a laptop in Denver
   * and a draft composed in CI must be byte-identical, or the tests below are
   * measuring the machine rather than the code.
   */
  export function formatRfc5322Date(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, "0");
    const day = DAY_NAMES[date.getUTCDay()] ?? "Mon";
    const month = MONTH_NAMES[date.getUTCMonth()] ?? "Jan";
    return (
      `${day}, ${pad(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ` +
      `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
    );
  }
  ```

  Note the `?? "Mon"` fallbacks: `noUncheckedIndexedAccess` is on in this repo's
  `tsconfig.json`, so an array index is `string | undefined` and the compiler
  will reject the template literal without them. Insert
  `` `Date: ${formatRfc5322Date(message.date)}` `` into the header list after
  `Subject`. Run — green. Commit: `Stamp drafts with a UTC date header`.

- [ ] **Step 4: A derived `Message-ID`.**

  Add:

  ```ts
    it("generates a Message-ID scoped to the sender's domain", () => {
      const mime = composeMime(BASE);
      const line = mime.split("\r\n").find((l) => l.startsWith("Message-ID: "));
      expect(line).toMatch(/^Message-ID: <[0-9a-z]+\.[0-9a-z]+@example\.com>$/);
    });

    // Derived rather than random, so the same draft composed twice is the same
    // bytes and a test can assert more than a shape.
    it("gives the same draft the same id and different drafts different ids", () => {
      expect(composeMime(BASE)).toBe(composeMime(BASE));
      const other = composeMime({ ...BASE, body: "Hi Jane," });
      expect(other).not.toBe(composeMime(BASE));
    });
  ```

  Run — fails. Implement:

  ```ts
  /**
   * FNV-1a over the message, so a Message-ID is a function of its message.
   *
   * Not a cryptographic hash and not trying to be: this only has to make two
   * different drafts get two different ids, and collisions between byte-
   * identical drafts sent in the same millisecond are the right answer anyway.
   */
  function fingerprint(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }

  /** The domain to hang a Message-ID off: whatever follows the last "@" in From. */
  function senderDomain(from: string): string {
    const at = from.lastIndexOf("@");
    if (at === -1) return "localhost";
    return from.slice(at + 1).replace(/[>\s]/g, "") || "localhost";
  }

  function messageId(message: {
    from: string;
    to: string;
    subject: string;
    body: string;
    date: Date;
  }): string {
    const stamp = message.date.getTime().toString(36);
    const digest = fingerprint(
      [message.from, message.to, message.subject, message.body].join("\0"),
    );
    return `<${stamp}.${digest}@${senderDomain(message.from)}>`;
  }
  ```

  Add `` `Message-ID: ${messageId(message)}` `` after the `Date` header. Run —
  green. Commit: `Give every draft a stable Message-ID`.

- [ ] **Step 5: RFC 2047 encoded-words for an accented subject.**

  Add:

  ```ts
  describe("encodeSubjectValue", () => {
    it("leaves an ordinary ASCII subject exactly as written", () => {
      expect(encodeSubjectValue("Summer 2027 internship")).toBe("Summer 2027 internship");
    });

    // The recruiter's own name, spelled correctly. Sending it as mojibake to
    // the person you are asking for a job is a bad first impression.
    it("encodes an accented name as an RFC 2047 encoded-word", () => {
      const encoded = encodeSubjectValue("Hola Begona Munoz-Perez");
      expect(encoded).toMatch(/^=\?utf-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(decodeWords(encoded)).toBe("Hola Begona Munoz-Perez");
    });
  });
  ```

  Use a real accented string in the source file — write
  `"Hola Begoña Muñoz-Pérez"` with the actual characters (again: editor, not
  heredoc). Add the test-local decoder above the `describe` blocks:

  ```ts
  /** Reverse the encoding, so a test asserts a round trip rather than a regex. */
  function decodeWords(header: string): string {
    return header
      .split(/\s+/)
      .map((word) => {
        const match = /^=\?utf-8\?B\?([A-Za-z0-9+/=]*)\?=$/i.exec(word);
        if (match?.[1] === undefined) return word;
        return Buffer.from(match[1], "base64").toString("utf8");
      })
      .join("");
  }
  ```

  Note the `.join("")`, not `.join(" ")`: RFC 2047 says the whitespace between
  two adjacent encoded-words is not part of the text and is dropped on decoding.
  That is precisely what makes Step 6's chunking safe. Run — fails. Implement:

  ```ts
  /**
   * Bytes of raw text per encoded-word.
   *
   * RFC 2047 caps an encoded-word at 75 characters. "=?utf-8?B?" and "?=" spend
   * 12 of them, leaving 63 for base64; rounding down to the nearest multiple of
   * 4 gives 60 base64 characters, which is 45 bytes of input.
   */
  const ENCODED_WORD_BYTES = 45;

  function isAscii(text: string): boolean {
    // eslint-disable-next-line no-control-regex
    return !/[^\x00-\x7F]/.test(text);
  }

  function encodeWord(text: string): string {
    return `=?utf-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
  }

  /**
   * RFC 2047 encoded-words for a header value, or the value unchanged.
   *
   * Chunking iterates code points rather than UTF-16 units, so a surrogate pair
   * is never split across two encoded-words — the failure mode there is a
   * replacement character in the middle of somebody's name.
   */
  export function encodeSubjectValue(subject: string): string {
    if (isAscii(subject)) return subject;

    const words: string[] = [];
    let chunk = "";
    for (const character of subject) {
      const next = chunk + character;
      if (Buffer.byteLength(next, "utf8") > ENCODED_WORD_BYTES) {
        words.push(encodeWord(chunk));
        chunk = character;
      } else {
        chunk = next;
      }
    }
    if (chunk !== "") words.push(encodeWord(chunk));
    return words.join(" ");
  }
  ```

  Wire it in: the `Subject` header becomes
  `` `Subject: ${encodeSubjectValue(message.subject.replace(/[\r\n]+/g, " "))}` ``.
  Run — green. Commit: `Encode non-ASCII subjects as RFC 2047 words`.

- [ ] **Step 6: An emoji subject, which is where naive chunking breaks.**

  Add:

  ```ts
    // An emoji is a surrogate pair in JavaScript and four bytes in UTF-8.
    // Chunking by string index rather than by code point splits it and the
    // recruiter sees a replacement character.
    it("never splits a surrogate pair across two encoded-words", () => {
      const subject = "Thanks for the chat " + "\u{1F680}".repeat(30);
      const encoded = encodeSubjectValue(subject);

      for (const word of encoded.split(" ")) {
        expect(word.length).toBeLessThanOrEqual(75);
      }
      expect(decodeWords(encoded)).toBe(subject);
      expect(encoded).not.toContain("�");
    });
  ```

  Run — this should already pass if Step 5's `for (const character of subject)`
  was written as written (`for...of` over a string iterates code points). If you
  reached for `subject[i]` or `split("")`, it fails here; fix it to the iterator
  form. Then also assert the whole-message path:

  ```ts
    it("folds an encoded subject without exceeding the line limits", () => {
      const mime = composeMime({ ...BASE, subject: "Thanks " + "\u{1F680}".repeat(40) });
      for (const line of mime.split("\r\n")) {
        expect(line.length).toBeLessThanOrEqual(HARD_LINE_LIMIT_FOR_TEST);
      }
    });
  ```

  with `const HARD_LINE_LIMIT_FOR_TEST = 998;` near the top of the test file —
  the constant is not exported from the module and duplicating the number in the
  test is correct, because the test is asserting the RFC's limit and not the
  module's opinion of it. Run — fails until Step 7. Commit after Step 7.

- [ ] **Step 7: Header folding for a long subject.**

  Add:

  ```ts
    it("folds a long subject at whitespace with a continuation line", () => {
      const subject =
        "Following up on the summer 2027 software engineering internship posting " +
        "and the conversation we had at the autumn careers fair last Thursday";
      const mime = composeMime({ ...BASE, subject });
      const lines = mime.split("\r\n");

      const start = lines.findIndex((line) => line.startsWith("Subject: "));
      expect(start).toBeGreaterThanOrEqual(0);
      expect(lines[start]?.length).toBeLessThanOrEqual(78);

      // The continuation begins with a space, which is what makes it a fold and
      // not a new header.
      expect(lines[start + 1]).toMatch(/^ \S/);

      // Unfolding reconstructs exactly what the caller asked for.
      const unfolded = lines
        .slice(start)
        .reduce<string[]>((acc, line) => {
          if (/^[ \t]/.test(line) && acc.length > 0) {
            acc[acc.length - 1] = `${acc[acc.length - 1] ?? ""}${line.slice(1)}`;
          } else {
            acc.push(line);
          }
          return acc;
        }, [])[0];
      expect(unfolded).toBe(`Subject: ${subject}`);
    });
  ```

  Note the reducer joins with `line.slice(1)` and no added space: this composer
  folds *at* an existing space, replacing it with `CRLF + " "`, so unfolding puts
  the space back exactly once. Run — fails. Implement:

  ```ts
  /**
   * Lay out one header, folding at whitespace when it runs long.
   *
   * Folding replaces a space with CRLF and a leading space, so the receiver
   * unfolds it back to the original character for character. A token with no
   * space in it that is longer than the limit cannot be folded politely; see
   * hardWrap.
   */
  function headerLine(name: string, value: string): string {
    const full = `${name}: ${value}`;
    if (full.length <= SOFT_LINE_LIMIT) return hardWrap(full).join("\r\n");

    const lines: string[] = [];
    let current = `${name}:`;
    for (const token of value.split(" ")) {
      if (token === "") continue;
      const candidate = `${current} ${token}`;
      if (candidate.length > SOFT_LINE_LIMIT && current !== `${name}:`) {
        lines.push(current);
        current = ` ${token}`;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
    return lines.flatMap(hardWrap).join("\r\n");
  }
  ```

  Run — the fold test passes; the 998 test from Step 6 may still fail if
  `hardWrap` is not yet written. Move straight to Step 8, then commit both:
  `Fold long headers instead of writing an illegal line`.

- [ ] **Step 8: The 998-octet guarantee, including an unfoldable token.**

  Add:

  ```ts
    // A subject can contain a single unbreakable token — a tracking URL pasted
    // by mistake is the realistic case. There is nowhere polite to fold it, and
    // 998 is still a hard limit, so it gets chopped.
    it("never emits a line over 998 octets even for an unfoldable subject", () => {
      const mime = composeMime({ ...BASE, subject: `https://x.test/${"a".repeat(3000)}` });
      for (const line of mime.split("\r\n")) {
        expect(line.length).toBeLessThanOrEqual(998);
      }
    });
  ```

  Run — fails. Implement:

  ```ts
  /**
   * Last resort for a line with no fold point.
   *
   * The inserted leading space becomes part of the value when the receiver
   * unfolds, which corrupts the token — but the alternative is an illegal
   * message, and a 998-character unbroken subject is already pathological.
   */
  function hardWrap(line: string): string[] {
    if (line.length <= HARD_LINE_LIMIT) return [line];

    const out: string[] = [];
    let rest = line;
    while (rest.length > HARD_LINE_LIMIT) {
      out.push(rest.slice(0, HARD_LINE_LIMIT - 1));
      rest = ` ${rest.slice(HARD_LINE_LIMIT - 1)}`;
    }
    out.push(rest);
    return out;
  }
  ```

  Route every header through `headerLine`:

  ```ts
    const headers = [
      headerLine("From", message.from),
      headerLine("To", message.to),
      headerLine("Subject", encodeSubjectValue(message.subject.replace(/[\r\n]+/g, " "))),
      headerLine("Date", formatRfc5322Date(message.date)),
      headerLine("Message-ID", messageId(message)),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
    ];
  ```

  Run the whole file — Step 6's and Step 8's limit tests both pass. Commit:
  `Fold long headers instead of writing an illegal line`.

- [ ] **Step 9: Quoted-printable for a non-ASCII body.**

  Add:

  ```ts
  describe("composeMime body encoding", () => {
    it("encodes a non-ASCII body as quoted-printable and round-trips it", () => {
      const body = "Hola Begona,\n\nGracias por su tiempo. -- Alex\n";
      const mime = composeMime({ ...BASE, body });
      const encoded = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");

      expect(encoded).toContain("=C3=B1"); // the n-with-tilde, as two octets
      expect(decodeQuotedPrintable(encoded).trimEnd()).toBe(body.trimEnd());
    });
  });
  ```

  Write `"Hola Begoña,"` and `"Gracias por su tiempo."` with the real accented
  characters. Add the test-local decoder:

  ```ts
  /** Reverse quoted-printable, so the tests assert a round trip. */
  function decodeQuotedPrintable(encoded: string): string {
    const joined = encoded.replace(/=\r\n/g, "");
    const bytes: number[] = [];
    for (let index = 0; index < joined.length; index += 1) {
      const char = joined[index] ?? "";
      if (char === "=" && /^[0-9A-F]{2}$/i.test(joined.slice(index + 1, index + 3))) {
        bytes.push(parseInt(joined.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        for (const byte of Buffer.from(char, "utf8")) bytes.push(byte);
      }
    }
    return Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
  }
  ```

  Run — fails. Implement the encoder:

  ```ts
  /** One line of body text as quoted-printable, not yet wrapped. */
  function encodeQpPieces(line: string): string[] {
    const bytes = Buffer.from(line, "utf8");
    const pieces: string[] = [];
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index] ?? 0;
      const isLast = index === bytes.length - 1;
      const isSpace = byte === 0x20 || byte === 0x09;
      if (isSpace && !isLast) {
        pieces.push(String.fromCharCode(byte));
      } else if (!isSpace && byte >= 0x21 && byte <= 0x7e && byte !== 0x3d) {
        pieces.push(String.fromCharCode(byte));
      } else {
        pieces.push(`=${byte.toString(16).toUpperCase().padStart(2, "0")}`);
      }
    }
    return pieces;
  }

  function encodeQuotedPrintable(body: string): string {
    return toLines(body).map((line) => wrapQp(encodeQpPieces(line))).join("\r\n");
  }
  ```

  with `wrapQp` for now as `(pieces) => pieces.join("")`. Use
  `encodeQuotedPrintable(message.body)` for the body in `composeMime`. Run —
  green. Commit: `Encode draft bodies as quoted-printable`.

- [ ] **Step 10: Soft line breaks for a body line longer than 998 octets.**

  Add:

  ```ts
    // A pasted job description is one line as far as a mail server is
    // concerned, and RFC 5322 refuses a line over 998 octets outright.
    it("soft-wraps a body line far longer than the hard limit", () => {
      const long = "The role covers distributed systems work. ".repeat(60);
      const mime = composeMime({ ...BASE, body: `Hi Jane,\n\n${long}\n\nAlex` });

      for (const line of mime.split("\r\n")) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
      const encoded = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      expect(decodeQuotedPrintable(encoded)).toContain(long);
    });

    it("never splits an =XX escape across a soft line break", () => {
      const mime = composeMime({ ...BASE, body: "é".repeat(200) });
      for (const line of mime.split("\r\n")) {
        expect(line).not.toMatch(/=[0-9A-F]?$/);
        // ... except the soft break itself, which is a bare "=".
      }
    });
  ```

  The second assertion as written rejects a bare `=` too, which is the soft
  break. Write it as `expect(line).not.toMatch(/=[0-9A-F]$/)` — a line ending in
  `=` plus exactly one hex digit is a severed escape; a line ending in a bare `=`
  is correct. Run — fails. Implement:

  ```ts
  /**
   * Join encoded pieces into lines no longer than QP_LINE_LIMIT.
   *
   * An "=XX" escape is one piece and is never cut in half. A space landing at
   * the end of a line is re-encoded first: RFC 2045 forbids trailing whitespace
   * before a soft break, and mail servers strip it, which would silently delete
   * a character from the candidate's message.
   */
  function wrapQp(pieces: string[]): string[] {
    const lines: string[] = [];
    let current = "";

    for (const piece of pieces) {
      if (current.length + piece.length > QP_SOFT_BREAK_AT) {
        const tail = current.slice(-1);
        const head =
          tail === " "
            ? `${current.slice(0, -1)}=20`
            : tail === "\t"
              ? `${current.slice(0, -1)}=09`
              : current;
        lines.push(`${head}=`);
        current = "";
      }
      current += piece;
    }
    lines.push(current);

    // The arithmetic above holds this, but it is the guarantee the whole
    // function exists for, so it is worth being unable to violate silently.
    for (const line of lines) {
      if (line.length > QP_LINE_LIMIT) {
        throw new Error(`quoted-printable line of ${line.length} octets`);
      }
    }
    return lines;
  }
  ```

  Change `encodeQuotedPrintable` to `.flatMap((line) => wrapQp(...))`:

  ```ts
  function encodeQuotedPrintable(body: string): string {
    return toLines(body)
      .flatMap((line) => wrapQp(encodeQpPieces(line)))
      .join("\r\n");
  }
  ```

  Run — green. Commit: `Soft-wrap body lines the RFC would reject`.

- [ ] **Step 11: A line consisting only of a single `.`.**

  Add:

  ```ts
    // A lone "." on its own line terminates an SMTP DATA block. IMAP APPEND
    // sends a counted literal so it is safe there, but this draft is going on
    // to be sent by a mail client over SMTP, and encoding the dot costs three
    // characters and removes the question.
    it("encodes a line that is nothing but a dot", () => {
      const mime = composeMime({ ...BASE, body: "Hi Jane,\n.\nAlex" });
      const encoded = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");

      expect(encoded.split("\r\n")).toContain("=2E");
      expect(encoded.split("\r\n")).not.toContain(".");
      expect(decodeQuotedPrintable(encoded).split("\n")).toContain(".");
    });

    it("also escapes a leading dot on an ordinary line", () => {
      const mime = composeMime({ ...BASE, body: ".NET experience: two internships" });
      const encoded = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      expect(encoded).toContain("=2ENET experience");
    });
  ```

  Run — fails. At the end of `encodeQpPieces`, before returning:

  ```ts
    if (pieces[0] === ".") pieces[0] = "=2E";
    return pieces;
  ```

  Run — green. Commit: `Escape a leading dot so SMTP cannot swallow a line`.

- [ ] **Step 12: A body that already carries CRLF is not double-converted.**

  Add:

  ```ts
    // draft.ts may hand over a body assembled from text that already came off
    // the wire. Normalising CRLF to LF before splitting is what stops a second
    // pass turning every line ending into "\r\r\n".
    it("does not double-convert a body that already uses CRLF", () => {
      const viaLf = composeMime({ ...BASE, body: "One\nTwo\nThree" });
      const viaCrlf = composeMime({ ...BASE, body: "One\r\nTwo\r\nThree" });

      // Identical but for the Message-ID, which fingerprints the raw body.
      const strip = (mime: string): string =>
        mime.split("\r\n").filter((line) => !line.startsWith("Message-ID: ")).join("\r\n");
      expect(strip(viaCrlf)).toBe(strip(viaLf));
      expect(viaCrlf).not.toContain("\r\r");
    });
  ```

  Run — this passes given `toLines` from Step 2. If it fails, `toLines` is
  splitting on `\n` before collapsing `\r\n`; fix the order. Commit:
  `Prove a CRLF body is not converted twice`.

- [ ] **Step 13: Trailing whitespace survives as `=20`.**

  Add:

  ```ts
    // Mail servers strip trailing whitespace from a line. Encoding it keeps
    // the candidate's text intact, which matters for a signature block.
    it("encodes trailing whitespace rather than letting a server eat it", () => {
      const mime = composeMime({ ...BASE, body: "Alex  \nSecond line" });
      const encoded = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      expect(encoded).toContain("Alex =20");
      expect(decodeQuotedPrintable(encoded)).toContain("Alex  \n");
    });
  ```

  Run — passes given Step 9's `isSpace && !isLast` rule (the final space of the
  line is encoded, the one before it is not, giving `Alex =20`). If it fails,
  the `isLast` branch is inverted. Commit: `Keep trailing spaces out of a
  server's reach`.

- [ ] **Step 14: Full verification and a final commit.**

  Run, in order:

  ```
  npx vitest run src/lib/outreach/compose.test.ts
  npm run typecheck
  npm test
  ```

  `npm run typecheck` is the one that catches the `noUncheckedIndexedAccess`
  traps in this module — `DAY_NAMES[...]`, `bytes[index]`, `pieces[0]` and the
  regex capture groups all need the `?? …` guards written above. Fix anything it
  reports, re-run all three, then commit: `Compose drafts as RFC 5322 messages`.

---

### Task 6: DSN bounce parsing (`src/lib/outreach/bounce.ts`)

**Files:**
- Create: `src/lib/outreach/bounce.ts`
- Test: `src/lib/outreach/bounce.test.ts`
- Create (fixtures): `src/lib/outreach/__fixtures__/gmail-hard-5.1.1.eml`
- Create (fixtures): `src/lib/outreach/__fixtures__/m365-hard-5.1.10.eml`
- Create (fixtures): `src/lib/outreach/__fixtures__/postfix-soft-4.4.7.eml`
- Create (fixtures): `src/lib/outreach/__fixtures__/mailbox-full-5.2.2.eml`
- Create (fixtures): `src/lib/outreach/__fixtures__/out-of-office.eml`
- Create (fixtures): `src/lib/outreach/__fixtures__/human-reply.eml`
- Create (fixtures): `src/lib/outreach/__fixtures__/mailer-daemon-plaintext.eml`

**Interfaces:**

- Consumes: nothing. Pure text parsing — no IMAP client, no database, no clock.
  It does not import from Task 5.
- Produces:

  ```ts
  export interface BounceReport {
    failedRecipient: string;
    status: string;      // RFC 3463, e.g. "5.1.1"
    hard: boolean;       // true only for 5.x.x
    diagnostic?: string;
  }
  export function parseDsn(raw: string): BounceReport | null;
  export function isHardStatus(status: string): boolean;
  ```

- **The boundary this module refuses to cross.** Section 5 of the design lists
  two recognition paths: the RFC 3464 machine-readable `message/delivery-status`
  part, and a fallback heuristic of "the sender is `MAILER-DAEMON@…` or
  `postmaster@…` and the body mentions the recipient". The heuristic is
  explicitly allowed to mark an `OutreachMessage` `BOUNCED` **for display**, and
  explicitly forbidden from setting `ContactEmail.status = BOUNCED` without a
  parsed `5.x.x` — because misreading an out-of-office as a bounce discards a
  correct address, and a correct address is the scarcest thing this feature
  produces.

  Therefore **the heuristic does not live here.** `parseDsn` implements path 1
  only and returns `null` for everything else, including a `MAILER-DAEMON`
  message it cannot machine-read. The heuristic belongs in `watch.ts`, where the
  display-only consequence is available; a caller that only has a `BounceReport`
  has no way to express "probably a bounce, but do not condemn the address", and
  giving `BounceReport` a `confidence` field to carry that would make the
  forbidden call the easy one. A `BounceReport` returned from here is always
  backed by a parsed `Status`, and `hard === true` is always sufficient grounds
  to mark a `ContactEmail` `BOUNCED`.

- Downstream: `watch.ts` calls `parseDsn` on each message arriving after
  `OutreachMessage.sentAt`; `src/lib/contacts/store.ts` uses `hard` to decide
  between `ContactEmailStatus.BOUNCED` and leaving the address alone.

---

- [ ] **Step 1: `isHardStatus` for the ordinary cases.**

  Create `src/lib/outreach/bounce.test.ts`:

  ```ts
  /**
   * Tests for reading a delivery status notification.
   *
   * This app never sends mail, so the only ground truth it can get about a
   * guessed address arrives as a bounce in the candidate's own inbox. That
   * makes this parser the single negative signal in the whole contact
   * pipeline — and it is a destructive one: a 5.x.x marks the address BOUNCED
   * and the pipeline stops trying it.
   *
   * So the bias is the same as extract-code.ts: return null rather than guess.
   * An out-of-office misread as a bounce throws away a correct address at a
   * company the candidate wanted to work for, and nothing later recovers it.
   */

  import { describe, expect, it } from "vitest";
  import { isHardStatus, parseDsn } from "./bounce";

  describe("isHardStatus", () => {
    it("calls a 5.x.x permanent", () => {
      for (const status of ["5.1.1", "5.1.10", "5.7.1", "5.4.1", "5.0.0"]) {
        expect(isHardStatus(status), status).toBe(true);
      }
    });

    it("does not call a 4.x.x permanent", () => {
      // A full queue, greylisting, or a server having a bad hour. It says
      // nothing about whether the address is right, and the companies whose
      // mail servers are busiest are the ones worth writing to.
      for (const status of ["4.4.7", "4.2.2", "4.7.0", "4.0.0"]) {
        expect(isHardStatus(status), status).toBe(false);
      }
    });

    it("refuses anything that is not an RFC 3463 status", () => {
      for (const status of ["", "5", "5.1", "550", "5.1.1.1", "x.y.z", "9.1.1"]) {
        expect(isHardStatus(status), JSON.stringify(status)).toBe(false);
      }
    });

    it("tolerates the whitespace a header leaves behind", () => {
      expect(isHardStatus("  5.1.1  ")).toBe(true);
    });
  });
  ```

  Run `npx vitest run src/lib/outreach/bounce.test.ts` — fails to resolve.
  Create `src/lib/outreach/bounce.ts`:

  ```ts
  /**
   * Reading a delivery status notification out of a raw message.
   *
   * The app never sends, yet it still gets ground truth about a guessed
   * address, because a bounce is delivered to the sender's inbox and the app
   * already reads that inbox over IMAP.
   *
   * Pure: raw text in, a report or null out. No IMAP client, no database — the
   * whole fixture set runs without a network.
   *
   * This module implements only the machine-readable RFC 3464 path. The
   * "sender looks like MAILER-DAEMON" heuristic deliberately lives in watch.ts
   * instead: that heuristic may mark a message BOUNCED for display, but it may
   * not condemn a ContactEmail, and a BounceReport has no way to say so.
   * Everything returned from here is backed by a parsed Status.
   */

  /** RFC 3463: class.subject.detail, each 1-3 digits, class 2, 4 or 5. */
  const STATUS_PATTERN = /^([245])\.(\d{1,3})\.(\d{1,3})$/;

  /**
   * 5.x.x statuses that are not evidence the address is wrong.
   *
   * 5.2.2 is "mailbox full". Providers issue it as a permanent failure, but a
   * full mailbox is a temporary condition of the *person*, not a statement
   * about the address — which is unarguably real, since a server had to look
   * it up to know its mailbox was full. Treating it as hard would delete the
   * one confirmed-existing address the pipeline had found.
   */
  const NOT_REALLY_PERMANENT = new Set(["5.2.2"]);

  export function isHardStatus(status: string): boolean {
    const trimmed = status.trim();
    const match = STATUS_PATTERN.exec(trimmed);
    if (match === null) return false;
    if (match[1] !== "5") return false;
    return !NOT_REALLY_PERMANENT.has(trimmed);
  }

  export interface BounceReport {
    /** The address that failed, from the DSN's Final-Recipient field. */
    failedRecipient: string;
    /** RFC 3463 status, e.g. "5.1.1". */
    status: string;
    /** True for 5.x.x. Only a hard bounce is evidence the address is wrong. */
    hard: boolean;
    diagnostic?: string;
  }

  export function parseDsn(_raw: string): BounceReport | null {
    return null;
  }
  ```

  Run — green (the `parseDsn` import resolves; no test uses it yet). Commit:
  `Tell a permanent bounce from a server having a bad hour`.

- [ ] **Step 2: The `5.2.2` exclusion, with the reason in the test.**

  Add:

  ```ts
    // Named and separate because it is the one status whose classification is a
    // judgement call rather than a reading of the RFC. 5.2.2 is "mailbox full":
    // some providers issue it as permanent, but a server can only know a
    // mailbox is full by finding it, so the address is real. Marking it BOUNCED
    // would delete a confirmed-existing address over a temporary condition.
    it("does not call 5.2.2 permanent, because a full mailbox is a real one", () => {
      expect(isHardStatus("5.2.2")).toBe(false);

      // Its neighbours are unaffected — this is one status, not a subclass.
      expect(isHardStatus("5.2.0")).toBe(true);
      expect(isHardStatus("5.2.1")).toBe(true);
      expect(isHardStatus("5.2.3")).toBe(true);
    });
  ```

  Run — passes given Step 1's `NOT_REALLY_PERMANENT`. If it fails, the set was
  written as a prefix check rather than an exact-match set; fix it to exact
  match. Commit: `Spare a full mailbox from being treated as a wrong address`.

- [ ] **Step 3: The two hard-bounce fixtures.**

  Create `src/lib/outreach/__fixtures__/gmail-hard-5.1.1.eml` — verbatim, with
  an editor, LF line endings, and the folded `Diagnostic-Code` continuation
  lines kept exactly as they are (each begins with one space):

  ```text
  Delivered-To: candidate@example.com
  Received: by 2002:a05:6512:3f0a:b0:52f:2a1c:9d44 with SMTP id d10csp1184927lfv;
          Tue, 15 Sep 2026 07:12:44 -0700 (PDT)
  Return-Path: <>
  Received: from mail-sor-f69.google.com (mail-sor-f69.google.com. [209.85.220.69])
          by mx.google.com with SMTPS id r7sor3928112pls.9.2026.09.15.07.12.43
          for <candidate@example.com>;
          Tue, 15 Sep 2026 07:12:44 -0700 (PDT)
  From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
  To: candidate@example.com
  Subject: Delivery Status Notification (Failure)
  Message-ID: <68c86ecc.050a0220.1f4e2.0000@gmr-mx.google.com>
  Date: Tue, 15 Sep 2026 07:12:44 -0700 (PDT)
  Content-Type: multipart/report; boundary="00000000000091c7a6063f2a1b0c"; report-type=delivery-status
  MIME-Version: 1.0

  --00000000000091c7a6063f2a1b0c
  Content-Type: text/plain; charset="UTF-8"
  Content-Transfer-Encoding: quoted-printable

  ** Address not found **

  Your message wasn't delivered to jane.okafor@acme-robotics.com because the
  address couldn't be found, or is unable to receive mail.

  The response from the remote server was:
  550 5.1.1 The email account that you tried to reach does not exist.

  --00000000000091c7a6063f2a1b0c
  Content-Type: message/delivery-status

  Reporting-MTA: dns; googlemail.com
  Received-From-MTA: dns; mx.google.com
  Arrival-Date: Tue, 15 Sep 2026 07:12:42 -0700 (PDT)
  X-Original-Message-ID: <k8f2a1.3n9q4z@example.com>

  Final-Recipient: rfc822; jane.okafor@acme-robotics.com
  Action: failed
  Status: 5.1.1
  Remote-MTA: dns; aspmx.l.google.com. (142.250.115.27, the server for the domain acme-robotics.com.)
  Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.
   Please try double-checking the recipient's email address for typos or
   unnecessary spaces. For more information, go to
   https://support.google.com/mail/?p=NoSuchUser
  Last-Attempt-Date: Tue, 15 Sep 2026 07:12:44 -0700 (PDT)

  --00000000000091c7a6063f2a1b0c
  Content-Type: message/rfc822
  Content-Description: Undelivered Message Headers

  Return-Path: <candidate@example.com>
  MIME-Version: 1.0
  From: Alex Candidate <candidate@example.com>
  To: jane.okafor@acme-robotics.com
  Subject: Software engineering internship - Summer 2027
  Message-ID: <k8f2a1.3n9q4z@example.com>
  Date: Tue, 15 Sep 2026 14:12:42 +0000
  Content-Type: text/plain; charset=utf-8

  --00000000000091c7a6063f2a1b0c--
  ```

  Create `src/lib/outreach/__fixtures__/m365-hard-5.1.10.eml`. Three things
  differ from Gmail on purpose and each is a test in Step 8: the outer
  `Content-Type` is folded across two lines, the boundary contains an `=`, and
  `Final-Recipient: rfc822;p.nakamura@…` has **no space** after the semicolon:

  ```text
  Received: from BN8PR12MB3287.namprd12.prod.outlook.com (2603:10b6:408:63::21)
   by CY4PR12MB1234.namprd12.prod.outlook.com with HTTPS; Tue, 15 Sep 2026
   16:48:11 +0000
  From: postmaster@northwind-industries.com
  To: candidate@example.com
  Date: Tue, 15 Sep 2026 16:48:10 +0000
  Subject: Undeliverable: Software engineering internship - Summer 2027
  Auto-Submitted: auto-replied
  Content-Type: multipart/report; report-type=delivery-status;
   boundary="9B095B5ADSN=_01DC26F1BN8PR12MB3287.namprd12.prod.outlook.COM"
  MIME-Version: 1.0
  Message-ID: <9B095B5ADSN=_01DC26F1BN8PR12MB3287@namprd12.prod.outlook.com>
  Return-Path: <>

  --9B095B5ADSN=_01DC26F1BN8PR12MB3287.namprd12.prod.outlook.COM
  Content-Type: text/plain; charset=us-ascii
  Content-Transfer-Encoding: quoted-printable

  Your message to p.nakamura@northwind-industries.com couldn't be delivered.

  p.nakamura wasn't found at northwind-industries.com.

  --9B095B5ADSN=_01DC26F1BN8PR12MB3287.namprd12.prod.outlook.COM
  Content-Type: message/delivery-status

  Reporting-MTA: dns;BN8PR12MB3287.namprd12.prod.outlook.com
  Received-From-MTA: dns;NAM12-BN8-obe.outbound.protection.outlook.com
  Arrival-Date: Tue, 15 Sep 2026 16:48:09 +0000

  Final-Recipient: rfc822;p.nakamura@northwind-industries.com
  Action: failed
  Status: 5.1.10
  Diagnostic-Code: smtp;550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup

  --9B095B5ADSN=_01DC26F1BN8PR12MB3287.namprd12.prod.outlook.COM
  Content-Type: message/rfc822

  From: Alex Candidate <candidate@example.com>
  To: p.nakamura@northwind-industries.com
  Subject: Software engineering internship - Summer 2027
  Date: Tue, 15 Sep 2026 16:48:05 +0000

  --9B095B5ADSN=_01DC26F1BN8PR12MB3287.namprd12.prod.outlook.COM--
  ```

  No test runs yet. Commit: `Record two real hard bounces to parse against`.

- [ ] **Step 4: The soft and mailbox-full fixtures.**

  Create `src/lib/outreach/__fixtures__/postfix-soft-4.4.7.eml`. This is the
  *final* Postfix notice after the queue lifetime expires, not the "warning
  only" delay notice — it carries `Action: failed` with a 4.x.x status, which is
  exactly the combination the hard/soft split exists to get right:

  ```text
  Return-Path: <>
  Received: by mail.example-relay.net (Postfix)
          id F1C0A4A2B7; Wed, 16 Sep 2026 09:02:11 +0000 (UTC)
  From: MAILER-DAEMON@mail.example-relay.net (Mail Delivery System)
  To: candidate@example.com
  Subject: Undelivered Mail Returned to Sender
  Date: Wed, 16 Sep 2026 09:02:11 +0000 (UTC)
  MIME-Version: 1.0
  Content-Type: multipart/report; report-type=delivery-status;
          boundary="F1C0A4A2B7.1758013331/mail.example-relay.net"
  Message-Id: <20260916090211.F1C0A4A2B7@mail.example-relay.net>

  This is a MIME-encapsulated message.

  --F1C0A4A2B7.1758013331/mail.example-relay.net
  Content-Description: Notification
  Content-Type: text/plain; charset=us-ascii

  This is the mail system at host mail.example-relay.net.

  I'm sorry to have to inform you that your message could not
  be delivered to one or more recipients. It's attached below.

                     The mail system

  <t.abiodun@harborlight-analytics.com>: delivery temporarily suspended:
      connect to mx1.harborlight-analytics.com[198.51.100.24]:25: Connection
      timed out

  --F1C0A4A2B7.1758013331/mail.example-relay.net
  Content-Description: Delivery report
  Content-Type: message/delivery-status

  Reporting-MTA: dns; mail.example-relay.net
  X-Postfix-Queue-ID: F1C0A4A2B7
  X-Postfix-Sender: rfc822; candidate@example.com
  Arrival-Date: Sat, 12 Sep 2026 09:01:44 +0000 (UTC)

  Final-Recipient: rfc822; t.abiodun@harborlight-analytics.com
  Original-Recipient: rfc822;t.abiodun@harborlight-analytics.com
  Action: failed
  Status: 4.4.7
  Diagnostic-Code: X-Postfix; delivery time expired

  --F1C0A4A2B7.1758013331/mail.example-relay.net
  Content-Description: Undelivered Message Headers
  Content-Type: text/rfc822-headers

  From: Alex Candidate <candidate@example.com>
  To: t.abiodun@harborlight-analytics.com
  Subject: Software engineering internship - Summer 2027

  --F1C0A4A2B7.1758013331/mail.example-relay.net--
  ```

  Create `src/lib/outreach/__fixtures__/mailbox-full-5.2.2.eml`. Note the header
  names here use lowercase `final-recipient:` and `status:` — some MTAs do, the
  RFC says field names are case-insensitive, and Step 10 asserts it:

  ```text
  Return-Path: <>
  From: Mail Delivery System <MAILER-DAEMON@mx.stonebridge-capital.com>
  To: <candidate@example.com>
  Subject: Undeliverable mail: quota exceeded
  Date: Thu, 17 Sep 2026 11:30:02 +0000
  MIME-Version: 1.0
  Content-Type: multipart/report; report-type=delivery-status; boundary=zimbra-7f2c9a1b
  Message-ID: <20260917113002.7f2c9a1b@mx.stonebridge-capital.com>

  --zimbra-7f2c9a1b
  Content-Type: text/plain; charset=utf-8

  Sorry, we were unable to deliver your message to the following address.

  <r.delacroix@stonebridge-capital.com>:
  Mailbox is full and cannot accept further messages.

  --zimbra-7f2c9a1b
  Content-Type: message/delivery-status

  Reporting-MTA: dns; mx.stonebridge-capital.com
  Arrival-Date: Thu, 17 Sep 2026 11:29:58 +0000

  final-recipient: RFC822;   r.delacroix@stonebridge-capital.com
  action: failed
  status: 5.2.2
  diagnostic-code: smtp; 552 5.2.2 Requested mail action aborted: exceeded storage allocation

  --zimbra-7f2c9a1b
  Content-Type: text/rfc822-headers

  From: Alex Candidate <candidate@example.com>
  To: r.delacroix@stonebridge-capital.com
  Subject: Following up on the summer analyst posting

  --zimbra-7f2c9a1b--
  ```

  Commit: `Record a soft bounce and a full mailbox`.

- [ ] **Step 5: The three fixtures that must parse as nothing.**

  These are the point of the module. Create
  `src/lib/outreach/__fixtures__/out-of-office.eml`:

  ```text
  Return-Path: <jane.okafor@acme-robotics.com>
  Received: from mx.acme-robotics.com (mx.acme-robotics.com [203.0.113.44])
          by mx.example.com with ESMTPS; Tue, 15 Sep 2026 14:13:05 +0000
  From: Jane Okafor <jane.okafor@acme-robotics.com>
  To: Alex Candidate <candidate@example.com>
  Subject: Automatic reply: Software engineering internship - Summer 2027
  Date: Tue, 15 Sep 2026 14:13:04 +0000
  Message-ID: <AM0PR04MB55921@acme-robotics.com>
  Auto-Submitted: auto-replied
  X-Auto-Response-Suppress: All
  MIME-Version: 1.0
  Content-Type: text/plain; charset=utf-8
  Content-Transfer-Encoding: quoted-printable

  Thank you for your message.

  I am out of the office until 29 September with limited access to email and
  will not be able to respond before then. Your message has not been
  forwarded.

  For anything urgent relating to university recruiting, please contact
  campus@acme-robotics.com.

  Kind regards,
  Jane Okafor
  University Recruiting, Acme Robotics
  ```

  Create `src/lib/outreach/__fixtures__/human-reply.eml`. Deliberately
  `multipart/alternative`, so a parser that keys off "multipart" rather than
  "multipart/report" fails this test:

  ```text
  Return-Path: <p.nakamura@northwind-industries.com>
  From: Priya Nakamura <p.nakamura@northwind-industries.com>
  To: Alex Candidate <candidate@example.com>
  Subject: RE: Software engineering internship - Summer 2027
  Date: Wed, 16 Sep 2026 15:22:41 +0000
  Message-ID: <CAF9xQ2m8kR@mail.northwind-industries.com>
  In-Reply-To: <k8f2a1.3n9q4z@example.com>
  MIME-Version: 1.0
  Content-Type: multipart/alternative; boundary="000000000000a1b2c3"

  --000000000000a1b2c3
  Content-Type: text/plain; charset="UTF-8"

  Hi Alex,

  Thanks for reaching out, and apologies for the slow reply. We do open the
  summer internship requisition in early October - the posting will go up on
  our careers page and I would encourage you to apply through it so your
  application lands with the team directly.

  Happy to flag your name internally once it is live. Status 5.1.1 of your
  application will be visible in the portal. (Yes, our portal really does
  print that - ignore it.)

  Best,
  Priya

  --000000000000a1b2c3
  Content-Type: text/html; charset="UTF-8"

  <div dir="ltr">Hi Alex,<br><br>Thanks for reaching out...</div>

  --000000000000a1b2c3--
  ```

  The "Status 5.1.1" sentence is there on purpose: a parser that greps the whole
  message for a status code instead of reading a delivery-status part would
  condemn a real recruiter's address on the strength of a joke about a portal.

  Create `src/lib/outreach/__fixtures__/mailer-daemon-plaintext.eml`. A genuine
  bounce with no machine-readable part — `parseDsn` must still return `null`:

  ```text
  Return-Path: <>
  From: Mail Delivery Subsystem <MAILER-DAEMON@legacy-mta.example.net>
  To: candidate@example.com
  Subject: Returned mail: see transcript for details
  Date: Thu, 17 Sep 2026 08:11:19 +0000
  Message-Id: <202609170811.q8H8BJdA004411@legacy-mta.example.net>
  MIME-Version: 1.0
  Content-Type: text/plain; charset=us-ascii

  The original message was received at Thu, 17 Sep 2026 08:11:17 +0000
  from candidate@example.com [192.0.2.17]

     ----- The following addresses had permanent fatal errors -----
  <m.oyelaran@fairweather-logistics.com>
      (reason: 550 5.1.1 <m.oyelaran@fairweather-logistics.com>... User unknown)

     ----- Transcript of session follows -----
  ... while talking to mail.fairweather-logistics.com.:
  >>> RCPT To:<m.oyelaran@fairweather-logistics.com>
  <<< 550 5.1.1 <m.oyelaran@fairweather-logistics.com>... User unknown
  550 5.1.1 <m.oyelaran@fairweather-logistics.com>... User unknown
  <<< 503 5.0.0 Need RCPT (recipient)
  ```

  Commit: `Record the three messages that must not parse as bounces`.

- [ ] **Step 6: The fixture loader and the first real parse.**

  Add to the top of `bounce.test.ts`, after the existing imports:

  ```ts
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";

  /**
   * Load a raw message fixture.
   *
   * Fixtures are stored with LF so a Windows checkout cannot quietly rewrite
   * them, and converted to CRLF here because that is how a DSN actually
   * arrives. Normalising in the loader keeps the assertion honest without
   * making the files hostage to core.autocrlf.
   */
  function fixture(name: string): string {
    const path = fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
    return readFileSync(path, "utf8").replace(/\r?\n/g, "\r\n");
  }
  ```

  Add:

  ```ts
  describe("parseDsn", () => {
    it("reads a Gmail hard bounce for an address that does not exist", () => {
      const report = parseDsn(fixture("gmail-hard-5.1.1.eml"));

      expect(report).not.toBeNull();
      expect(report?.failedRecipient).toBe("jane.okafor@acme-robotics.com");
      expect(report?.status).toBe("5.1.1");
      expect(report?.hard).toBe(true);
      // The folded continuation lines are joined back into one value.
      expect(report?.diagnostic).toContain("550-5.1.1 The email account");
      expect(report?.diagnostic).toContain("support.google.com");
    });
  });
  ```

  Run — fails (`parseDsn` returns null). Implement the whole path:

  ```ts
  /** Every newline shape becomes "\n" so the splitting below has one case. */
  function normalizeNewlines(raw: string): string {
    return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  /** Join RFC 5322 continuation lines, so one logical header is one string. */
  function unfold(block: string): string[] {
    const lines: string[] = [];
    for (const line of block.split("\n")) {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""} ${line.trim()}`;
      } else {
        lines.push(line);
      }
    }
    return lines;
  }

  interface MessagePart {
    headers: string[];
    body: string;
  }

  function splitMessage(text: string): MessagePart {
    const separator = text.indexOf("\n\n");
    if (separator === -1) return { headers: unfold(text), body: "" };
    return { headers: unfold(text.slice(0, separator)), body: text.slice(separator + 2) };
  }

  /** The value of one header or DSN field, matched without regard to case. */
  function fieldValue(lines: string[], name: string): string | null {
    const wanted = `${name.toLowerCase()}:`;
    for (const line of lines) {
      if (line.toLowerCase().startsWith(wanted)) return line.slice(wanted.length).trim();
    }
    return null;
  }

  function readBoundary(contentType: string): string | null {
    const quoted = /boundary\s*=\s*"([^"]*)"/i.exec(contentType);
    if (quoted?.[1] !== undefined && quoted[1] !== "") return quoted[1];
    const bare = /boundary\s*=\s*([^;\s]+)/i.exec(contentType);
    return bare?.[1] ?? null;
  }

  function splitParts(body: string, boundary: string): MessagePart[] {
    const parts: MessagePart[] = [];
    // The first chunk is the preamble; a chunk beginning "--" is the close.
    for (const chunk of body.split(`--${boundary}`).slice(1)) {
      if (chunk.startsWith("--")) break;
      parts.push(splitMessage(chunk.replace(/^\n/, "")));
    }
    return parts;
  }

  /** Strip the "rfc822;" address-type prefix and any angle brackets. */
  function cleanRecipient(value: string | null): string | null {
    if (value === null) return null;
    const semicolon = value.indexOf(";");
    const withoutType = (semicolon === -1 ? value : value.slice(semicolon + 1)).trim();
    const angled = /<([^>]+)>/.exec(withoutType);
    const address = (angled?.[1] ?? withoutType).trim();
    // No "@" means we did not understand the field. Guessing here would
    // condemn an address that was never named.
    return address.includes("@") ? address : null;
  }

  /**
   * Read the per-recipient field groups of a message/delivery-status part.
   *
   * RFC 3464: a per-message group, a blank line, then one group per recipient.
   * Only a group whose Action is "failed" is a bounce — "delayed" and
   * "delivered" groups appear in the same part and mean the opposite thing.
   */
  function readDeliveryStatus(body: string): BounceReport | null {
    for (const block of body.split(/\n[ \t]*\n/)) {
      const group = unfold(block);

      const action = fieldValue(group, "action");
      if (action === null || action.trim().toLowerCase() !== "failed") continue;

      const recipient =
        cleanRecipient(fieldValue(group, "final-recipient")) ??
        cleanRecipient(fieldValue(group, "original-recipient"));
      const status = fieldValue(group, "status")?.trim() ?? null;
      if (recipient === null || status === null) continue;
      if (!STATUS_PATTERN.test(status)) continue;

      const report: BounceReport = {
        failedRecipient: recipient,
        status,
        hard: isHardStatus(status),
      };
      const diagnostic = fieldValue(group, "diagnostic-code");
      if (diagnostic !== null && diagnostic !== "") report.diagnostic = diagnostic;
      return report;
    }
    return null;
  }

  export function parseDsn(raw: string): BounceReport | null {
    const outer = splitMessage(normalizeNewlines(raw));

    const contentType = fieldValue(outer.headers, "content-type");
    if (contentType === null) return null;
    if (!/multipart\/report/i.test(contentType)) return null;
    if (!/report-type\s*=\s*"?delivery-status"?/i.test(contentType)) return null;

    const boundary = readBoundary(contentType);
    if (boundary === null) return null;

    for (const part of splitParts(outer.body, boundary)) {
      const partType = fieldValue(part.headers, "content-type");
      if (partType === null || !/message\/delivery-status/i.test(partType)) continue;
      const report = readDeliveryStatus(part.body);
      if (report !== null) return report;
    }
    return null;
  }
  ```

  Delete the placeholder `parseDsn` stub from Step 1. Run — green. Commit:
  `Parse the machine-readable part of a delivery status notification`.

- [ ] **Step 7: The Microsoft 365 bounce — folded header, `=` in the boundary, no space after `rfc822;`.**

  Add:

  ```ts
    it("reads a Microsoft 365 bounce despite a folded Content-Type and an = in the boundary", () => {
      const report = parseDsn(fixture("m365-hard-5.1.10.eml"));

      expect(report?.failedRecipient).toBe("p.nakamura@northwind-industries.com");
      expect(report?.status).toBe("5.1.10");
      expect(report?.hard).toBe(true);
      expect(report?.diagnostic).toContain("RESOLVER.ADR.RecipientNotFound");
    });
  ```

  Run — green if `unfold` runs before `fieldValue` on the outer headers and
  `readBoundary` prefers the quoted form. If it fails, the likely cause is
  `readBoundary`'s bare-token regex winning and stopping at the `=`; make sure
  the quoted branch is tried first. Commit: `Read a Microsoft 365 bounce`.

- [ ] **Step 8: The soft bounce stays soft.**

  Add:

  ```ts
    // Action: failed with a 4.x.x is the combination the split exists for:
    // Postfix issues it when the queue lifetime expires, and it says nothing
    // about whether the address is right.
    it("parses a 4.4.7 timeout as a bounce that is not evidence against the address", () => {
      const report = parseDsn(fixture("postfix-soft-4.4.7.eml"));

      expect(report?.failedRecipient).toBe("t.abiodun@harborlight-analytics.com");
      expect(report?.status).toBe("4.4.7");
      expect(report?.hard).toBe(false);
      expect(report?.diagnostic).toBe("X-Postfix; delivery time expired");
    });
  ```

  Run — green. Commit: `Keep a timeout from condemning an address`.

- [ ] **Step 9: `5.2.2` parses, and is still not hard.**

  Add:

  ```ts
    // The exclusion end to end: the report is produced, the address is named,
    // and hard is false, so the caller has something to show the candidate
    // without ContactEmail.status ever reaching BOUNCED.
    it("reports a 5.2.2 mailbox-full bounce without marking the address wrong", () => {
      const report = parseDsn(fixture("mailbox-full-5.2.2.eml"));

      expect(report?.failedRecipient).toBe("r.delacroix@stonebridge-capital.com");
      expect(report?.status).toBe("5.2.2");
      expect(report?.hard).toBe(false);
    });

    // The same fixture, for the reason it uses lowercase field names: RFC 5322
    // field names are case-insensitive and real MTAs take them at their word.
    it("matches DSN field names regardless of letter case", () => {
      expect(parseDsn(fixture("mailbox-full-5.2.2.eml"))?.status).toBe("5.2.2");
    });
  ```

  Run — green given `fieldValue`'s `toLowerCase`. If the recipient comes back
  with leading spaces, `cleanRecipient` is not trimming after the semicolon —
  the fixture has `RFC822;   r.delacroix@…` with three spaces for exactly this.
  Commit: `Report a full mailbox without condemning the address`.

- [ ] **Step 10: The three that must return null.**

  Add:

  ```ts
    // The point of the module. Each of these is a message the watcher will see
    // and none of them is evidence against an address.
    it("returns null for an out-of-office auto-reply", () => {
      expect(parseDsn(fixture("out-of-office.eml"))).toBeNull();
    });

    it("returns null for an ordinary human reply", () => {
      // multipart/alternative, not multipart/report - and its body contains the
      // literal text "Status 5.1.1", which a parser that greps the whole
      // message would read as a bounce for the recruiter's own address.
      expect(parseDsn(fixture("human-reply.eml"))).toBeNull();
    });

    it("returns null for a MAILER-DAEMON bounce with no machine-readable part", () => {
      // This one really is a bounce, and parseDsn still refuses it. The sender
      // heuristic belongs in watch.ts, where a message can be shown as bounced
      // without setting ContactEmail.status = BOUNCED. Section 5 of the design
      // forbids condemning an address without a parsed 5.x.x, and a
      // BounceReport has no way to carry "probably".
      expect(parseDsn(fixture("mailer-daemon-plaintext.eml"))).toBeNull();
    });
  ```

  Run — green. Commit: `Refuse to read a bounce out of a message that is not one`.

- [ ] **Step 11: `Final-Recipient` shapes, and `Action: delayed`.**

  Add:

  ```ts
    /** Wrap a delivery-status field group in the smallest legal DSN. */
    function dsnAround(group: string): string {
      return [
        "From: MAILER-DAEMON@mx.example.net",
        "To: candidate@example.com",
        "MIME-Version: 1.0",
        'Content-Type: multipart/report; report-type=delivery-status; boundary="bnd"',
        "",
        "--bnd",
        "Content-Type: message/delivery-status",
        "",
        "Reporting-MTA: dns; mx.example.net",
        "",
        group,
        "",
        "--bnd--",
        "",
      ].join("\r\n");
    }

    it("strips the rfc822 prefix however the MTA spaced or cased it", () => {
      const shapes = [
        "Final-Recipient: rfc822; sam.ito@example.org",
        "Final-Recipient: rfc822;sam.ito@example.org",
        "Final-Recipient: RFC822;    sam.ito@example.org   ",
        "FINAL-RECIPIENT: Rfc822; <sam.ito@example.org>",
        "final-recipient: rfc822; sam.ito@example.org",
      ];

      for (const line of shapes) {
        const report = parseDsn(dsnAround([line, "Action: failed", "Status: 5.1.1"].join("\r\n")));
        expect(report?.failedRecipient, line).toBe("sam.ito@example.org");
      }
    });

    // A delay notice is not a failure, and Postfix sends plenty of them.
    it("returns null for a delivery-status part reporting a delay", () => {
      const raw = dsnAround(
        [
          "Final-Recipient: rfc822; sam.ito@example.org",
          "Action: delayed",
          "Status: 4.4.7",
        ].join("\r\n"),
      );
      expect(parseDsn(raw)).toBeNull();
    });

    it("returns null when a failed group names no parseable address", () => {
      const raw = dsnAround(["Final-Recipient: rfc822; unknown", "Action: failed", "Status: 5.1.1"].join("\r\n"));
      expect(parseDsn(raw)).toBeNull();
    });

    it("returns null when a failed group carries no status", () => {
      const raw = dsnAround(["Final-Recipient: rfc822; sam.ito@example.org", "Action: failed"].join("\r\n"));
      expect(parseDsn(raw)).toBeNull();
    });
  ```

  Run — green given Step 6. If the `FINAL-RECIPIENT: Rfc822; <…>` shape fails,
  `cleanRecipient` is not handling angle brackets. Commit:
  `Handle every shape a Final-Recipient field arrives in`.

- [ ] **Step 12: Line endings and junk.**

  Add:

  ```ts
    // The watcher gets whatever imapflow hands it. A DSN whose CRLF was
    // flattened somewhere upstream is still a DSN.
    it("parses the same message with LF endings as with CRLF", () => {
      const crlf = fixture("gmail-hard-5.1.1.eml");
      const lf = crlf.replace(/\r\n/g, "\n");
      expect(parseDsn(lf)).toEqual(parseDsn(crlf));
      expect(parseDsn(lf)?.status).toBe("5.1.1");
    });

    it("returns null rather than throwing on anything it cannot read", () => {
      for (const raw of ["", "\r\n", "not a message at all", "Subject: hi\r\n\r\nbody"]) {
        expect(parseDsn(raw), JSON.stringify(raw)).toBeNull();
      }
    });

    it("returns null when a multipart/report declares no boundary", () => {
      const raw = "Content-Type: multipart/report; report-type=delivery-status\r\n\r\nbody\r\n";
      expect(parseDsn(raw)).toBeNull();
    });
  ```

  Run — green. Commit: `Survive a flattened or malformed message without throwing`.

- [ ] **Step 13: Full verification and the final commit.**

  Run, in order:

  ```
  npx vitest run src/lib/outreach/bounce.test.ts
  npm run typecheck
  npm test
  ```

  `npm run typecheck` is what catches the `noUncheckedIndexedAccess` traps in
  this module: `lines[lines.length - 1]`, `match[1]`, `quoted?.[1]`,
  `bare?.[1]` and `angled?.[1]` all need the guards written above. Confirm too
  that `git status` shows all seven `.eml` files staged — a fixture that never
  got added turns into a test that fails only on somebody else's machine. Then
  commit: `Parse delivery status notifications into bounce reports`.

---

### Task 7: MX lookup (`src/lib/contacts/mx.ts`)

**Files:**
- Create: `src/lib/contacts/mx.ts`
- Test: `src/lib/contacts/mx.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Node built-in only: `import { promises as dns } from "node:dns"` → `dns.resolveMx(hostname: string): Promise<{ priority: number; exchange: string }[]>`.
- Produces:
  - `export type MailProvider = "google" | "microsoft" | "other" | "none";`
  - `export interface MxResult { hasMx: boolean; provider: MailProvider; hosts: string[]; }`
  - `export interface MxRecord { priority: number; exchange: string; }` — structurally identical to Node's `dns.MxRecord`, declared here so the injectable resolver has a type the tests can build without importing from `node:dns`.
  - `export type MxResolver = (hostname: string) => Promise<MxRecord[]>;`
  - `export async function lookupMx(domain: string, resolveMx?: MxResolver): Promise<MxResult>;`
    — **the injectable signature.** The spec (§3 step 1) writes `lookupMx(domain: string): Promise<MxResult>`; the second parameter is optional and defaults to `dns.resolveMx`, so every caller in the spec's signature still type-checks unchanged and no test ever touches the network.
- Later tasks rely on: `lookupMx` and `MxResult` (Task: `discover.ts`, which short-circuits the whole pipeline on `hasMx: false`), and `MailProvider` (persisted for diagnostics and the catch-all caveat in §10).

**Notes carried into the code:**
- `ENOTFOUND` and `ENODATA` are *answers*, not failures — both mean "this domain publishes no MX". Any other DNS error (`ESERVFAIL`, `ETIMEOUT`, …) is rethrown, because "we could not ask" must never be recorded as "this domain accepts no mail". That distinction is the whole point of the module.
- Hosts are returned sorted by MX priority (lowest number first), lowercased, with the trailing root dot stripped.

- [ ] **Step 1: Write the failing test for the three ways DNS says "no MX".**
  Create `src/lib/contacts/mx.test.ts`:

  ```ts
  /**
   * Tests for the MX lookup.
   *
   * This is the step that can stop the whole pipeline before it spends a
   * single HTTP request: a domain with no MX record accepts no mail, so every
   * candidate address under it is dead (spec section 3, step 1).
   *
   * The two ways DNS says "no MX" - ENOTFOUND and ENODATA - are ORDINARY
   * ANSWERS, not failures, and they are pinned down here because getting it
   * wrong goes wrong in both directions: throwing on a perfectly normal
   * domain, or reporting a live mail domain as dead and never writing to
   * anyone there again.
   *
   * No test touches the network. Every test passes its own resolver.
   */

  import { describe, it, expect } from "vitest";
  import { lookupMx, type MxRecord } from "./mx";

  /** A resolver that answers with a fixed record set. */
  function resolverReturning(records: MxRecord[]) {
    return async () => records;
  }

  /** A resolver that fails the way Node's DNS layer fails, with a `.code`. */
  function resolverFailingWith(code: string) {
    return async (): Promise<MxRecord[]> => {
      const error = new Error(`queryMx ${code} acme.com`) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    };
  }

  describe("lookupMx", () => {
    it("treats ENOTFOUND as 'no MX', not as an error", async () => {
      const result = await lookupMx("acme.com", resolverFailingWith("ENOTFOUND"));
      expect(result).toEqual({ hasMx: false, provider: "none", hosts: [] });
    });

    it("treats ENODATA as 'no MX', not as an error", async () => {
      const result = await lookupMx("acme.com", resolverFailingWith("ENODATA"));
      expect(result).toEqual({ hasMx: false, provider: "none", hosts: [] });
    });

    it("treats an empty record list as 'no MX'", async () => {
      const result = await lookupMx("acme.com", resolverReturning([]));
      expect(result).toEqual({ hasMx: false, provider: "none", hosts: [] });
    });

    it("rethrows a DNS failure that is not an answer, so a lookup we could not make is never recorded as a dead domain", async () => {
      await expect(lookupMx("acme.com", resolverFailingWith("ESERVFAIL"))).rejects.toThrow(
        /ESERVFAIL/,
      );
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail for the right reason.**
  `npx vitest run src/lib/contacts/mx.test.ts`
  Expect a resolution failure — `Failed to resolve import "./mx"`. That is the correct first failure; the module does not exist yet.

- [ ] **Step 3: Write the minimum `mx.ts` that answers "no MX" correctly.**
  Create `src/lib/contacts/mx.ts`:

  ```ts
  /**
   * MX lookup - step 1 of the address-guessing pipeline (spec section 3).
   *
   * This asks one question, and it is the cheapest question in the whole
   * feature: does this domain publish any MX record at all? A domain with no
   * MX accepts no mail, so every guessed address under it is dead, and
   * returning `hasMx: false` stops the pipeline before a single HTTP request
   * is made.
   *
   * DNS is free, has no terms of service to violate, and no rate limit worth
   * modelling, which is why this runs before anything that costs a quota.
   */

  import { promises as dns } from "node:dns";

  export type MailProvider = "google" | "microsoft" | "other" | "none";

  export interface MxResult {
    hasMx: boolean;
    provider: MailProvider;
    hosts: string[];
  }

  /**
   * One MX record. Structurally the same as Node's `dns.MxRecord`, declared
   * here so a test can build one without importing from `node:dns`.
   */
  export interface MxRecord {
    priority: number;
    exchange: string;
  }

  /**
   * The resolver, as a parameter rather than a hard dependency.
   *
   * Every test passes its own, so the suite runs offline and deterministically
   * - a DNS-backed test would be slow, flaky, and would quietly start failing
   * on an aeroplane.
   */
  export type MxResolver = (hostname: string) => Promise<MxRecord[]>;

  /** The answer for a domain that publishes no MX. Built fresh each time so a
   * caller mutating `hosts` cannot corrupt the next answer. */
  function noMx(): MxResult {
    return { hasMx: false, provider: "none", hosts: [] };
  }

  export async function lookupMx(
    domain: string,
    resolveMx: MxResolver = dns.resolveMx,
  ): Promise<MxResult> {
    let records: MxRecord[];
    try {
      records = await resolveMx(domain);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // ENOTFOUND (the name does not resolve) and ENODATA (it resolves but has
      // no MX) are both DNS saying "there is no mail here". They are answers,
      // and an answer is not an error.
      if (code === "ENOTFOUND" || code === "ENODATA") {
        return noMx();
      }
      // Anything else - SERVFAIL, a timeout, a broken resolver - means we did
      // not get an answer. Reporting that as "this domain accepts no mail"
      // would be a lie that permanently silences a real company, so it is
      // raised instead.
      throw error;
    }

    if (records.length === 0) {
      return noMx();
    }

    return { hasMx: true, provider: "other", hosts: [] };
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  `npx vitest run src/lib/contacts/mx.test.ts` — all four tests green.

- [ ] **Step 5: Add the failing tests for provider identification and host ordering.**
  Append inside the existing `describe("lookupMx", …)` block in `src/lib/contacts/mx.test.ts`:

  ```ts
    it("identifies Google Workspace from the MX hostnames", async () => {
      const result = await lookupMx(
        "acme.com",
        resolverReturning([
          { priority: 1, exchange: "ASPMX.L.GOOGLE.COM." },
          { priority: 5, exchange: "alt1.aspmx.l.google.com." },
        ]),
      );
      expect(result.hasMx).toBe(true);
      expect(result.provider).toBe("google");
      // Lowercased, with the DNS root dot stripped.
      expect(result.hosts).toEqual(["aspmx.l.google.com", "alt1.aspmx.l.google.com"]);
    });

    it("identifies Google Workspace from a googlemail host", async () => {
      const result = await lookupMx(
        "acme.com",
        resolverReturning([{ priority: 10, exchange: "aspmx2.googlemail.com" }]),
      );
      expect(result.provider).toBe("google");
    });

    it("identifies Microsoft 365 from a protection.outlook.com host", async () => {
      const result = await lookupMx(
        "acme.com",
        resolverReturning([{ priority: 0, exchange: "acme-com.mail.protection.outlook.com" }]),
      );
      expect(result.provider).toBe("microsoft");
    });

    it("calls anything it does not recognise 'other' rather than guessing", async () => {
      const result = await lookupMx(
        "acme.com",
        resolverReturning([{ priority: 10, exchange: "mx1.mailhost.example.net" }]),
      );
      expect(result.provider).toBe("other");
    });

    it("sorts hosts by MX priority, lowest first", async () => {
      const result = await lookupMx(
        "acme.com",
        resolverReturning([
          { priority: 30, exchange: "backup.mail.example.net" },
          { priority: 10, exchange: "primary.mail.example.net" },
          { priority: 20, exchange: "secondary.mail.example.net" },
        ]),
      );
      expect(result.hosts).toEqual([
        "primary.mail.example.net",
        "secondary.mail.example.net",
        "backup.mail.example.net",
      ]);
    });

    it("does not mutate the record list the resolver handed it", async () => {
      const records: MxRecord[] = [
        { priority: 30, exchange: "b.example.net" },
        { priority: 10, exchange: "a.example.net" },
      ];
      await lookupMx("acme.com", async () => records);
      expect(records[0]!.exchange).toBe("b.example.net");
    });
  ```

- [ ] **Step 6: Run the new tests and watch them fail.**
  `npx vitest run src/lib/contacts/mx.test.ts`
  The four "no MX" tests still pass; the six new ones fail — `provider` is always `"other"` and `hosts` is always `[]`.

- [ ] **Step 7: Implement provider identification and host ordering.**
  In `src/lib/contacts/mx.ts`, insert the two helpers above `noMx()`:

  ```ts
  /**
   * The MX hostname suffixes that identify a hosted mail provider.
   *
   * This is recorded for diagnostics and for the catch-all caveat in the UI
   * (spec section 10). It deliberately does NOT change the guess: knowing a
   * company is on Google Workspace tells us nothing about whether they use
   * `first.last` or `flast`.
   */
  const PROVIDER_SUFFIXES: ReadonlyArray<{ suffix: string; provider: MailProvider }> = [
    { suffix: "google.com", provider: "google" },
    { suffix: "googlemail.com", provider: "google" },
    { suffix: "protection.outlook.com", provider: "microsoft" },
    { suffix: "outlook.com", provider: "microsoft" },
  ];

  /** `a.b.google.com` and `google.com` both match `google.com`; `notgoogle.com` does not. */
  function matchesSuffix(host: string, suffix: string): boolean {
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  function identifyProvider(hosts: string[]): MailProvider {
    for (const host of hosts) {
      for (const { suffix, provider } of PROVIDER_SUFFIXES) {
        if (matchesSuffix(host, suffix)) {
          return provider;
        }
      }
    }
    return "other";
  }

  /** DNS hands back mixed case and, depending on the resolver, a trailing root dot. */
  function normalizeHost(exchange: string): string {
    return exchange.trim().toLowerCase().replace(/\.$/, "");
  }
  ```

  Then replace the final line of `lookupMx`:

  ```ts
    // Copied before sorting: the array belongs to the caller (or, in a test,
    // to a fixture that other assertions still read).
    const hosts = [...records]
      .sort((a, b) => a.priority - b.priority)
      .map((record) => normalizeHost(record.exchange))
      .filter((host) => host.length > 0);

    if (hosts.length === 0) {
      // A record set that is entirely blank exchanges is the same as no
      // records at all - there is nowhere to deliver.
      return noMx();
    }

    return { hasMx: true, provider: identifyProvider(hosts), hosts };
  ```

- [ ] **Step 8: Run the whole file and watch it pass, then type-check.**
  `npx vitest run src/lib/contacts/mx.test.ts` — ten tests green.
  `npm run typecheck` — clean.

- [ ] **Step 9: Commit.**
  ```
  git add src/lib/contacts/mx.ts src/lib/contacts/mx.test.ts
  git commit -m "Stop the contact pipeline at a domain that accepts no mail"
  ```

---

### Task 8: Gravatar probe (`src/lib/contacts/gravatar.ts`)

**Files:**
- Create: `src/lib/contacts/gravatar.ts`
- Test: `src/lib/contacts/gravatar.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. `node:crypto` (`createHash`) and global `fetch`.
- Produces:
  - `export async function hasGravatar(address: string): Promise<boolean>;` — verbatim from the spec. **True when an avatar exists. False means unknown, never "not real".**
  - `export function gravatarHash(address: string): string;` — the MD5 of the lowercased, trimmed address, exported so the test can assert the URL without recomputing MD5 by hand.
  - `export const GRAVATAR_REQUEST_DELAY_MS: number;` — the politeness gap between consecutive probes (§11).
- Later tasks rely on: `hasGravatar` feeding `AddressSignals.gravatarHit` in `score.ts`, and `discover.ts` calling it once per candidate.

**Notes carried into the code:**
- The whole module exists to encode an asymmetry (§4): a 200 proves a human registered that exact address, a 404 proves **nothing**. A Gravatar outage, a 500, a DNS failure and a timeout must therefore all return `false` — the same "unknown" a 404 means — and must never throw, because an exception that aborts discovery would make an outage look like a verdict.
- Throttling (§11) is enforced *in code*, not by remembering: a module-level gate serialises probes and inserts `GRAVATAR_REQUEST_DELAY_MS` between them, so ten candidates are ten polite sequential requests even if a caller writes `Promise.all`. This is the hand-rolled style of `DETAIL_REQUEST_DELAY_MS` in `src/lib/ats/smartrecruiters.ts:116` — **no shared HTTP wrapper is introduced**, per §11's explicit instruction to follow the existing duplication rather than build a framework for two new callers.
- The user-agent string is duplicated into this file, matching `greenhouse.ts:163`, `lever.ts:199`, `ashby.ts:194`. Only `smartrecruiters.ts` hoists it into a const, and it hoists it into a *local* const, not a shared one. Do not "fix" this here.

- [ ] **Step 1: Write the failing test file, leading with the rule the module exists to enforce.**
  Create `src/lib/contacts/gravatar.test.ts`:

  ```ts
  /**
   * Tests for the Gravatar probe.
   *
   * This file matters because Gravatar is a POSITIVE-ONLY signal and that has
   * to be enforced in code rather than remembered (spec section 4). A 200
   * means a human registered that exact address, so the address is real. A 404
   * means NOTHING AT ALL - most corporate addresses have never been near
   * Gravatar. The repository's name for this rule is "silence is never a yes",
   * and the tests below are what stop a future reader from reading `false` as
   * "this address is fake" and scoring it negatively.
   *
   * The same applies to failure: a Gravatar outage, a 500 or a dropped
   * connection must come back as the same `false`/unknown and must never
   * throw. An outage is not evidence.
   *
   * `globalThis.fetch` is stubbed for every test; nothing here hits the
   * network.
   */

  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { hasGravatar, gravatarHash, GRAVATAR_REQUEST_DELAY_MS } from "./gravatar";

  function statusResponse(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
  }

  describe("gravatarHash", () => {
    it("hashes the lowercased, trimmed address", () => {
      expect(gravatarHash("  Jane.Okafor@ACME.com  ")).toBe(gravatarHash("jane.okafor@acme.com"));
    });

    it("is a 32-character hex MD5 digest", () => {
      // MD5 of the empty string. An address of nothing but whitespace trims to
      // empty, so this pins both the trimming and the algorithm.
      expect(gravatarHash("   ")).toBe("d41d8cd98f00b204e9800998ecf8427e");
      expect(gravatarHash("jane@acme.com")).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("hasGravatar", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("requests the documented avatar URL with d=404 and the shared user-agent", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(statusResponse(404));

      await hasGravatar("Jane.Okafor@acme.com");

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toBe(
        `https://www.gravatar.com/avatar/${gravatarHash("jane.okafor@acme.com")}?d=404`,
      );
      expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(
        "InternshipAutopilot/1.0 (+job-discovery; contact: internship-autopilot)",
      );
    });

    it("returns true on 200, because an avatar proves a human registered that exact address", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(statusResponse(200));
      await expect(hasGravatar("jane.okafor@acme.com")).resolves.toBe(true);
    });

    it("returns false on 404, and false here means UNKNOWN - never 'this address is fake'", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(statusResponse(404));
      await expect(hasGravatar("jane.okafor@acme.com")).resolves.toBe(false);
    });

    it("returns the same unknown false on a 500, because a Gravatar outage is not evidence", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(statusResponse(500));
      await expect(hasGravatar("jane.okafor@acme.com")).resolves.toBe(false);
    });

    it("returns the same unknown false on a 429, and does not throw", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(statusResponse(429));
      await expect(hasGravatar("jane.okafor@acme.com")).resolves.toBe(false);
    });

    it("never throws on a network failure or timeout - it answers unknown", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
      await expect(hasGravatar("jane.okafor@acme.com")).resolves.toBe(false);
    });

    it("sends one request at a time, so ten candidates are ten polite sequential requests", async () => {
      expect(GRAVATAR_REQUEST_DELAY_MS).toBeGreaterThan(0);

      let inFlight = 0;
      let maxInFlight = 0;
      vi.mocked(globalThis.fetch).mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return statusResponse(404);
      });

      await Promise.all([
        hasGravatar("a@acme.com"),
        hasGravatar("b@acme.com"),
        hasGravatar("c@acme.com"),
      ]);

      expect(maxInFlight).toBe(1);
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  `npx vitest run src/lib/contacts/gravatar.test.ts`
  Expect `Failed to resolve import "./gravatar"`.

- [ ] **Step 3: Write `gravatar.ts` in full.**
  Create `src/lib/contacts/gravatar.ts`:

  ```ts
  /**
   * The Gravatar probe - the only free pre-send signal we have (spec section 4).
   *
   * `https://www.gravatar.com/avatar/<md5(lowercased address)>?d=404` returns
   * 200 when an avatar exists for that exact address and 404 when none does.
   *
   * THE ASYMMETRY IS THE POINT, and it is enforced here rather than trusted to
   * memory:
   *
   *   200 -> a human registered that exact address with Gravatar. The address
   *          is real. This is ground truth and it is worth a lot.
   *   404 -> NOTHING. Most corporate addresses have never been near Gravatar.
   *          It is not weak evidence against the address; it is no evidence.
   *
   * So `hasGravatar` returns `false` for "no avatar", for a 500, for a 429,
   * for a dropped connection and for a timeout, and it NEVER throws. All of
   * those mean the same thing - we learned nothing - and `score.ts` treats
   * `gravatarHit: false` as absence of evidence, never as a negative. This is
   * the rule the repository already calls "silence is never a yes". It is also
   * why `ContactEmailStatus` has a GRAVATAR_HIT member and no GRAVATAR_MISS:
   * there is no such state to record.
   *
   * A thrown error here would be worse than a wrong answer: it would abort a
   * discovery run, so a Gravatar outage would read as a verdict on the person.
   */

  import { createHash } from "node:crypto";

  /**
   * Pause between consecutive probes. Ten candidates for one contact is ten
   * requests to a free service that owes us nothing; firing them concurrently
   * is the sort of thing that gets an endpoint closed. Modelled on the
   * hand-rolled DETAIL_REQUEST_DELAY_MS in src/lib/ats/smartrecruiters.ts.
   */
  export const GRAVATAR_REQUEST_DELAY_MS = 150;

  const REQUEST_TIMEOUT_MS = 15_000;

  /**
   * Gravatar keys avatars on the MD5 of the address, lowercased and trimmed.
   *
   * MD5 is not a security choice here and is not ours to make - it is the
   * lookup key Gravatar's URL scheme defines. Nothing secret is hashed.
   */
  export function gravatarHash(address: string): string {
    return createHash("md5").update(address.trim().toLowerCase()).digest("hex");
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * A one-lane queue. Probes run one at a time with a gap between them, even
   * if a caller writes `Promise.all(candidates.map(hasGravatar))` - which is
   * exactly what a caller will eventually write. Politeness that depends on
   * every future caller remembering it is not politeness.
   */
  let gate: Promise<unknown> = Promise.resolve();

  function throttled<T>(work: () => Promise<T>): Promise<T> {
    const result = gate.then(work);
    // The next caller waits for this probe and then for the gap, whether this
    // one succeeded or not - a failure is not a licence to go faster.
    gate = result.then(
      () => delay(GRAVATAR_REQUEST_DELAY_MS),
      () => delay(GRAVATAR_REQUEST_DELAY_MS),
    );
    return result;
  }

  /** True when an avatar exists. False means unknown, never "not real". */
  export async function hasGravatar(address: string): Promise<boolean> {
    const url = `https://www.gravatar.com/avatar/${gravatarHash(address)}?d=404`;

    return throttled(async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            "User-Agent": "InternshipAutopilot/1.0 (+job-discovery; contact: internship-autopilot)",
            Accept: "image/*",
          },
        });
      } catch {
        // Network failure, DNS failure, or the timeout firing. Unknown.
        return false;
      }

      // Only a 200 is a yes. A 404 is the documented "no avatar" and every
      // other status is Gravatar having a bad day; all of them are unknown,
      // and unknown is `false`.
      return response.status === 200;
    });
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  `npx vitest run src/lib/contacts/gravatar.test.ts` — nine tests green. The file takes roughly a second wall-clock because the throttle gap is real; that is expected, not a hang.

- [ ] **Step 5: Type-check and commit.**
  `npm run typecheck` — clean.
  ```
  git add src/lib/contacts/gravatar.ts src/lib/contacts/gravatar.test.ts
  git commit -m "Probe Gravatar, where only a hit means anything"
  ```

---

### Task 9: Hunter client (`src/lib/contacts/hunter.ts`)

**Files:**
- Create: `src/lib/contacts/hunter.ts`
- Test: `src/lib/contacts/hunter.test.ts`
- Modify: `.env.example:36-38` (the reserved `HUNTER_API_KEY` block)

**Interfaces:**
- Consumes (from Task 3, `src/lib/contacts/pattern.ts`):
  - `export type PatternId = "first.last" | "first" | "flast" | "firstlast" | "first_last" | "f.last" | "last.first" | "firstl" | "lastf" | "first-last";`
  - `export interface NameParts { first: string; last: string; middle?: string; }`
  - Imported as `import type { NameParts, PatternId } from "./pattern";` — **not redeclared.** (Note: the design document lists `NameParts` under `permute.ts` in §3 step 2 while `PatternId` is under `pattern.ts` in §3 step 4. Task 3 owns `pattern.ts` and is the declaration site for both; if Task 3 instead declares `NameParts` in `permute.ts`, `pattern.ts` must re-export it so this import is valid. Flagged for whoever executes Task 3.)
  - Relative import, not `@/lib/contacts/pattern`: the repo has **no `vitest.config.ts`**, so the `@/*` path alias from `tsconfig.json:24` is not resolved at test runtime. `greenhouse.ts` gets away with `@/lib/jobs/types` only because that is an `import type`, erased before the test runner sees it. A value import through `@/` would fail. Use `./pattern`.
- Produces:
  - `export class HunterApiError extends Error { readonly retryable: boolean; readonly statusCode?: number; }`
  - `export function hunterConfigured(env?: Record<string, string | undefined>): boolean;`
  - `export async function hunterDomainPattern(domain: string): Promise<PatternId | null>;`
  - `export async function hunterFindEmail(domain: string, name: NameParts): Promise<string | null>;`
  - `export async function hunterVerify(address: string): Promise<boolean | null>;`
  - `export function hunterPatternToId(pattern: string | null | undefined): PatternId | null;` — exported so the mapping can be tested directly and reused if Hunter's pattern string is ever persisted raw.
- Later tasks rely on: `discover.ts` calling all three (once per domain for the pattern, never re-verifying a `CONFIRMED`/`BOUNCED` address), and `store.ts` persisting the returned `PatternId` to `EmailPattern`.

**Convention this file copies from `src/lib/ats/greenhouse.ts`:**
typed error carrying `readonly retryable: boolean` and `readonly statusCode?: number`; a Zod schema declaring **only the fields actually used**; `AbortSignal.timeout(15_000)`; the shared user-agent string duplicated into this file rather than hoisted anywhere shared. §11 says explicitly there is no shared HTTP wrapper in this repository and that two new callers do not justify inventing one — so the duplication here is deliberate and must not be refactored away as part of this task.

**Hunter API shapes — verified against `https://hunter.io/api-documentation/v2`:**

| Call | Request | Fields we read |
|---|---|---|
| domain pattern | `GET https://api.hunter.io/v2/domain-search?domain=…&api_key=…` | `data.pattern` (a string like `{first}.{last}`, or `null` when Hunter has no pattern) |
| find | `GET https://api.hunter.io/v2/email-finder?domain=…&first_name=…&last_name=…&api_key=…` | `data.email` (string, or `null` when nothing was found) |
| verify | `GET https://api.hunter.io/v2/email-verifier?email=…&api_key=…` | `data.status` (`valid` / `invalid` / `accept_all` / `webmail` / `disposable` / `unknown`) |

Errors come back as `{ "errors": [{ "id": string, "code": number, "details": string }] }`. Documented status codes: **401** no valid API key, **403** rate limit exceeded, **429** usage quota exceeded, **451** legal restriction on processing this person's data.

> **NEEDS CONFIRMATION** — two details I could not pin down to a single authoritative source:
> 1. Whether `data.email` on email-finder is emitted as `null` or omitted entirely on a miss. The schema below accepts both (`.nullable()` on a key validated via `data.email ?? null`, with the key required) — resolve this against a real response before relying on a miss being distinguishable from a malformed body.
> 2. The exact free-tier allowance. Hunter's current published free plan is **50 credits a month** (one find = 1 credit, one verification = 0.5 credit, so 50 finds *or* 100 verifications *or* a mix); several third-party pages still quote the retired "25 searches + 50 verifications" split. Confirm at `https://hunter.io/pricing` before the number goes anywhere a person will act on.

**Deliberate deviation from the spec's literal retryable mapping:** the spec writes `429/5xx/network -> true; 401/404 -> false`. Hunter's docs assign **403** to "rate limit exceeded", which is genuinely transient, so 403 is classified retryable alongside 429 and 5xx. 451 is classified non-retryable — retrying a legal restriction will never succeed. Everything else non-`ok` follows Greenhouse's "unexpected HTTP" branch and is non-retryable.

**Secret handling:** the API key travels in the query string, so **the request URL must never appear in an error message, a log line, or a thrown `Error`.** Errors name the endpoint only. This is the same rule `src/lib/email/env-file.ts` follows when `mailboxStatus()` reports `hasPassword` instead of the password.

- [ ] **Step 1: Write the failing test file.**
  Create `src/lib/contacts/hunter.test.ts`:

  ```ts
  /**
   * Tests for the Hunter client.
   *
   * Two things are being pinned down here, and both are easy to get wrong in
   * a way that is invisible until it matters.
   *
   * First: Hunter is OPTIONAL. With no HUNTER_API_KEY set, every call returns
   * null and no request is made. That is an ordinary state, exactly like
   * inboxConfig() returning null for an unconfigured mailbox
   * (src/lib/email/inbox.ts:49) - not an error, and it must not read like one,
   * because a discovery run on the free signals alone is a supported way to
   * use this app, not a degraded one.
   *
   * Second: the retryable classification, which has to match the ATS-client
   * convention in src/lib/ats/greenhouse.ts. A rate limit is worth backing off
   * and retrying; a bad API key and a response shape we do not recognise are
   * not, and retrying either just burns the quota that made Hunter worth
   * calling.
   *
   * `globalThis.fetch` is stubbed throughout. Nothing here reaches Hunter.
   */

  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import {
    HunterApiError,
    hunterConfigured,
    hunterDomainPattern,
    hunterFindEmail,
    hunterPatternToId,
    hunterVerify,
  } from "./hunter";

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  const JANE = { first: "Jane", last: "Okafor" };

  describe("hunterConfigured", () => {
    it("is false when the key is missing, blank, or whitespace", () => {
      expect(hunterConfigured({})).toBe(false);
      expect(hunterConfigured({ HUNTER_API_KEY: "" })).toBe(false);
      expect(hunterConfigured({ HUNTER_API_KEY: "   " })).toBe(false);
    });

    it("is true when a key is set", () => {
      expect(hunterConfigured({ HUNTER_API_KEY: "hunter-key" })).toBe(true);
    });
  });

  describe("hunterPatternToId", () => {
    it("maps Hunter's token syntax onto our PatternId union", () => {
      expect(hunterPatternToId("{first}.{last}")).toBe("first.last");
      expect(hunterPatternToId("{first}")).toBe("first");
      expect(hunterPatternToId("{f}{last}")).toBe("flast");
      expect(hunterPatternToId("{first}{last}")).toBe("firstlast");
      expect(hunterPatternToId("{first}_{last}")).toBe("first_last");
      expect(hunterPatternToId("{f}.{last}")).toBe("f.last");
      expect(hunterPatternToId("{last}.{first}")).toBe("last.first");
      expect(hunterPatternToId("{first}{l}")).toBe("firstl");
      expect(hunterPatternToId("{last}{f}")).toBe("lastf");
      expect(hunterPatternToId("{first}-{last}")).toBe("first-last");
    });

    it("returns null for a pattern we do not model, rather than forcing a wrong match", () => {
      // Real Hunter patterns that our ten-pattern union genuinely cannot express.
      expect(hunterPatternToId("{first}.{m}.{last}")).toBeNull();
      expect(hunterPatternToId("{l}{first}")).toBeNull();
      expect(hunterPatternToId("{f}{m}{last}")).toBeNull();
      expect(hunterPatternToId(null)).toBeNull();
      expect(hunterPatternToId(undefined)).toBeNull();
      expect(hunterPatternToId("")).toBeNull();
    });
  });

  describe("the Hunter client with no API key", () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.HUNTER_API_KEY;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
      delete process.env.HUNTER_API_KEY;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.HUNTER_API_KEY;
      else process.env.HUNTER_API_KEY = originalKey;
    });

    it("returns null from every call and makes no request at all", async () => {
      await expect(hunterDomainPattern("acme.com")).resolves.toBeNull();
      await expect(hunterFindEmail("acme.com", JANE)).resolves.toBeNull();
      await expect(hunterVerify("jane.okafor@acme.com")).resolves.toBeNull();
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });
  });

  describe("the Hunter client with an API key", () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.HUNTER_API_KEY;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
      process.env.HUNTER_API_KEY = "hunter-test-key";
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.HUNTER_API_KEY;
      else process.env.HUNTER_API_KEY = originalKey;
    });

    it("reads the domain pattern out of a domain-search response", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({
          data: {
            domain: "acme.com",
            pattern: "{first}.{last}",
            organization: "Acme Corp",
            emails: [],
          },
          meta: { results: 12 },
        }),
      );

      await expect(hunterDomainPattern("acme.com")).resolves.toBe("first.last");

      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(String(url)).toContain("https://api.hunter.io/v2/domain-search?");
      expect(String(url)).toContain("domain=acme.com");
    });

    it("returns null when Hunter reports a pattern our union does not model", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({ data: { pattern: "{first}.{m}.{last}" }, meta: {} }),
      );
      await expect(hunterDomainPattern("acme.com")).resolves.toBeNull();
    });

    it("returns null when Hunter knows no pattern for the domain", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({ data: { pattern: null }, meta: {} }),
      );
      await expect(hunterDomainPattern("acme.com")).resolves.toBeNull();
    });

    it("reads the address out of an email-finder response, normalized", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({
          data: { email: "Jane.Okafor@acme.com", score: 97, domain: "acme.com" },
          meta: {},
        }),
      );

      await expect(hunterFindEmail("acme.com", JANE)).resolves.toBe("jane.okafor@acme.com");

      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(String(url)).toContain("https://api.hunter.io/v2/email-finder?");
      expect(String(url)).toContain("first_name=Jane");
      expect(String(url)).toContain("last_name=Okafor");
    });

    it("returns null when email-finder found nobody", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({ data: { email: null, score: 0 }, meta: {} }),
      );
      await expect(hunterFindEmail("acme.com", JANE)).resolves.toBeNull();
    });

    it("maps email-verifier 'valid' to true and 'invalid' to false", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({ data: { status: "valid", result: "deliverable", score: 96 }, meta: {} }),
      );
      await expect(hunterVerify("jane.okafor@acme.com")).resolves.toBe(true);

      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({ data: { status: "invalid", result: "undeliverable", score: 0 }, meta: {} }),
      );
      await expect(hunterVerify("jane.okafor@acme.com")).resolves.toBe(false);
    });

    it("maps every other verifier status to null, because 'accept_all' and 'unknown' are not verdicts", async () => {
      for (const status of ["accept_all", "webmail", "disposable", "unknown"]) {
        vi.mocked(globalThis.fetch).mockResolvedValue(
          jsonResponse({ data: { status, result: "risky", score: 50 }, meta: {} }),
        );
        await expect(hunterVerify("jane.okafor@acme.com")).resolves.toBeNull();
      }
    });

    it("throws a NON-retryable HunterApiError on 401, because a bad key never fixes itself", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(
          { errors: [{ id: "unauthorized", code: 401, details: "No valid API key provided." }] },
          401,
        ),
      );

      await expect(hunterDomainPattern("acme.com")).rejects.toMatchObject({
        name: "HunterApiError",
        retryable: false,
        statusCode: 401,
      });
    });

    it("throws a retryable HunterApiError on 429 (quota), so discovery can carry on with the free signals", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(
          { errors: [{ id: "usage_exceeded", code: 429, details: "Usage quota exceeded." }] },
          429,
        ),
      );

      await expect(hunterVerify("jane.okafor@acme.com")).rejects.toMatchObject({
        name: "HunterApiError",
        retryable: true,
        statusCode: 429,
      });
    });

    it("throws a retryable HunterApiError on 5xx", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 503));

      await expect(hunterFindEmail("acme.com", JANE)).rejects.toMatchObject({
        name: "HunterApiError",
        retryable: true,
        statusCode: 503,
      });
    });

    it("throws a retryable HunterApiError on a network failure", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      await expect(hunterDomainPattern("acme.com")).rejects.toMatchObject({
        name: "HunterApiError",
        retryable: true,
      });
    });

    it("throws a NON-retryable HunterApiError when a 200 body fails the schema", async () => {
      // A 200 whose shape we do not recognise is a permanent problem: a human
      // has to look at it, and retrying only spends quota on the same answer.
      vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ data: { pattern: 42 } }));

      await expect(hunterDomainPattern("acme.com")).rejects.toMatchObject({
        name: "HunterApiError",
        retryable: false,
      });
      await expect(hunterDomainPattern("acme.com")).rejects.toBeInstanceOf(HunterApiError);
    });

    it("never puts the API key into an error message", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, 503));

      await expect(hunterFindEmail("acme.com", JANE)).rejects.toSatisfy(
        (error: unknown) => !String((error as Error).message).includes("hunter-test-key"),
      );
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  `npx vitest run src/lib/contacts/hunter.test.ts`
  Expect `Failed to resolve import "./hunter"`. (If Task 3's `pattern.ts` is not merged yet, the import of `./pattern` in step 3 will also fail — Task 3 is a hard prerequisite for this task.)

- [ ] **Step 3: Write `hunter.ts` in full.**
  Create `src/lib/contacts/hunter.ts`:

  ```ts
  /**
   * Hunter.io client - the one paid signal in the contact finder (spec section 4).
   *
   * Three questions, each a single GET against https://api.hunter.io/v2:
   *
   *   domain-search  -> the address pattern this company uses
   *   email-finder   -> the address Hunter believes belongs to this person
   *   email-verifier -> whether Hunter believes an address is deliverable
   *
   * Two rules shape everything below.
   *
   * 1. HUNTER IS OPTIONAL, AND UNCONFIGURED IS NOT AN ERROR. With no
   *    HUNTER_API_KEY set, every function returns null without making a
   *    request. The whole guessing pipeline is designed to work on free
   *    signals - MX, permutation, Gravatar, bounce feedback - and Hunter only
   *    sharpens it. This mirrors inboxConfig() returning null for an
   *    unconfigured mailbox (src/lib/email/inbox.ts:49): an opt-in dependency
   *    that is simply off, not a failure to report.
   *
   * 2. THE QUOTA IS SMALL, so a call is never spent on a question already
   *    answered (spec section 11). This file does not enforce that - callers
   *    do, by persisting the domain pattern once per domain and never
   *    re-verifying an address already CONFIRMED or BOUNCED - but it is why a
   *    429 raises a retryable error rather than being swallowed: the caller
   *    must be able to tell "Hunter said no" from "Hunter would not answer".
   *
   * Follows the ATS client convention (src/lib/ats/greenhouse.ts) exactly: a
   * typed error carrying `retryable`, a Zod schema declaring only the fields
   * used, AbortSignal.timeout(15_000), and the shared user-agent string
   * duplicated into this file. The repository has no shared HTTP wrapper and
   * spec section 11 says not to invent one for two new callers.
   */

  import { z } from "zod";
  import type { NameParts, PatternId } from "./pattern";

  /**
   * Thrown whenever a configured Hunter call goes wrong.
   *
   * Never thrown for "Hunter is not configured" - that returns null.
   *
   * `retryable` tells the discovery pipeline whether to back off and try again
   * or to give up on Hunter for this run and continue on the free signals:
   *   - 429 (usage quota) / 403 (rate limit) / 5xx / network  -> retryable
   *   - 401 (no valid API key)                                -> NOT retryable
   *   - 404                                                   -> NOT retryable
   *   - 451 (legal restriction on this person's data)         -> NOT retryable
   *   - a 200 whose JSON does not match the expected shape    -> NOT retryable
   *     (retrying a schema mismatch spends quota to be told the same thing)
   */
  export class HunterApiError extends Error {
    readonly retryable: boolean;
    readonly statusCode?: number;

    constructor(message: string, options: { retryable: boolean; statusCode?: number }) {
      super(message);
      this.name = "HunterApiError";
      this.retryable = options.retryable;
      this.statusCode = options.statusCode;
    }
  }

  const API_BASE = "https://api.hunter.io/v2";
  const REQUEST_TIMEOUT_MS = 15_000;

  /** Whether a Hunter key is present. Never returns the key itself. */
  export function hunterConfigured(
    /** The variables to read. A plain record, so a test can pass just these. */
    env: Record<string, string | undefined> = process.env,
  ): boolean {
    return Boolean(env.HUNTER_API_KEY && env.HUNTER_API_KEY.trim().length > 0);
  }

  function apiKey(): string | null {
    const key = process.env.HUNTER_API_KEY?.trim();
    return key && key.length > 0 ? key : null;
  }

  // --- Shape of Hunter's responses, just enough to trust them ---------------
  //
  // Only the fields actually read are declared. Each schema keeps one required
  // anchor field so that an error body, an HTML interstitial, or a shape change
  // fails validation instead of quietly parsing as "Hunter knows nothing".
  // `pattern` and `email` are required KEYS whose value may be null, because
  // null is Hunter's documented "no answer" and must stay distinguishable from
  // a response that never mentioned the field.

  const DomainSearchSchema = z.object({
    data: z.object({
      pattern: z.string().nullable(),
    }),
  });

  const EmailFinderSchema = z.object({
    data: z.object({
      email: z.string().nullable(),
    }),
  });

  const EmailVerifierSchema = z.object({
    data: z.object({
      status: z.string(),
    }),
  });

  /**
   * Hunter's pattern syntax, mapped onto our ten-pattern union.
   *
   * Hunter models patterns we do not (middle initials, employee numbers,
   * reversed initials), and anything not in this table returns null rather
   * than being squeezed into the nearest member. A wrong pattern is worse than
   * no pattern: it would be persisted to EmailPattern and would then confidently
   * generate one wrong address for every future contact at that company.
   */
  const HUNTER_PATTERNS: Readonly<Record<string, PatternId>> = {
    "{first}.{last}": "first.last",
    "{first}": "first",
    "{f}{last}": "flast",
    "{first}{last}": "firstlast",
    "{first}_{last}": "first_last",
    "{f}.{last}": "f.last",
    "{last}.{first}": "last.first",
    "{first}{l}": "firstl",
    "{last}{f}": "lastf",
    "{first}-{last}": "first-last",
  };

  export function hunterPatternToId(pattern: string | null | undefined): PatternId | null {
    if (!pattern) return null;
    return HUNTER_PATTERNS[pattern.trim().toLowerCase()] ?? null;
  }

  /**
   * One GET against Hunter, with the whole error taxonomy in one place.
   *
   * The API key travels in the query string, so the URL NEVER appears in a
   * message, a log line or a thrown error - only the endpoint name does. This
   * is the same discipline src/lib/email/env-file.ts follows when it reports
   * `hasPassword` instead of the password.
   */
  async function hunterGet(
    endpoint: "domain-search" | "email-finder" | "email-verifier",
    params: Record<string, string>,
    key: string,
  ): Promise<unknown> {
    const query = new URLSearchParams({ ...params, api_key: key });
    const url = `${API_BASE}/${endpoint}?${query.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "User-Agent": "InternshipAutopilot/1.0 (+job-discovery; contact: internship-autopilot)",
          Accept: "application/json",
        },
      });
    } catch (error) {
      // Network failure, DNS failure, or the 15s timeout firing. Transient.
      throw new HunterApiError(
        `Network error calling Hunter ${endpoint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { retryable: true },
      );
    }

    if (!response.ok) {
      const status = response.status;

      if (status === 401) {
        throw new HunterApiError(
          `Hunter rejected the API key (401) on ${endpoint}. Check HUNTER_API_KEY in .env.`,
          { retryable: false, statusCode: 401 },
        );
      }
      if (status === 404) {
        throw new HunterApiError(`Hunter returned 404 for ${endpoint}.`, {
          retryable: false,
          statusCode: 404,
        });
      }
      if (status === 451) {
        // Hunter will not process this person's data for legal reasons.
        // Retrying cannot change that answer.
        throw new HunterApiError(
          `Hunter refused ${endpoint} for legal reasons (451). This person's data will not be returned.`,
          { retryable: false, statusCode: 451 },
        );
      }
      if (status === 403 || status === 429 || status >= 500) {
        // 403 is Hunter's rate limit and 429 its usage quota; both recover on
        // their own, as does a 5xx. The caller backs off and continues on the
        // free signals rather than failing the discovery.
        throw new HunterApiError(
          `Hunter returned HTTP ${status} on ${endpoint} (rate limit, quota, or server error).`,
          { retryable: true, statusCode: status },
        );
      }
      throw new HunterApiError(`Hunter returned unexpected HTTP ${status} on ${endpoint}.`, {
        retryable: false,
        statusCode: status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      // A 200 with an unreadable body: truncation, a proxy interstitial, or the
      // timeout firing mid-stream. All transient, like the Greenhouse client.
      throw new HunterApiError(
        `Hunter returned an unreadable response body on ${endpoint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { retryable: true },
      );
    }
  }

  function schemaError(endpoint: string, detail: string): HunterApiError {
    return new HunterApiError(
      `Hunter's ${endpoint} response did not match the expected shape: ${detail}`,
      { retryable: false },
    );
  }

  /**
   * The address pattern this company uses, or null.
   *
   * Null covers three different situations on purpose, because the caller
   * treats them identically - it simply has no pattern to persist:
   * Hunter is unconfigured, Hunter knows no pattern for the domain, or Hunter
   * reported a pattern our union cannot express.
   *
   * Consult this ONCE per domain and persist the answer to EmailPattern
   * (spec section 11). It is the most expensive question we ask.
   */
  export async function hunterDomainPattern(domain: string): Promise<PatternId | null> {
    const key = apiKey();
    if (!key) return null;

    const body = await hunterGet("domain-search", { domain }, key);
    const parsed = DomainSearchSchema.safeParse(body);
    if (!parsed.success) {
      throw schemaError("domain-search", parsed.error.message);
    }

    return hunterPatternToId(parsed.data.data.pattern);
  }

  /**
   * The address Hunter believes belongs to this person, lowercased, or null
   * when Hunter is unconfigured or found nobody.
   */
  export async function hunterFindEmail(
    domain: string,
    name: NameParts,
  ): Promise<string | null> {
    const key = apiKey();
    if (!key) return null;

    const body = await hunterGet(
      "email-finder",
      { domain, first_name: name.first, last_name: name.last },
      key,
    );
    const parsed = EmailFinderSchema.safeParse(body);
    if (!parsed.success) {
      throw schemaError("email-finder", parsed.error.message);
    }

    const email = parsed.data.data.email?.trim().toLowerCase();
    return email && email.length > 0 ? email : null;
  }

  /**
   * Hunter's verdict on one address: true for `valid`, false for `invalid`,
   * and null for everything else.
   *
   * Null is the honest answer for `accept_all`, `webmail`, `disposable` and
   * `unknown` - none of those is a statement about whether this particular
   * person reads mail at this address, and scoring them as a negative would be
   * the same mistake the Gravatar rule exists to prevent.
   *
   * Never call this for an address already CONFIRMED or BOUNCED: we already
   * know, and the quota is small (spec section 11).
   */
  export async function hunterVerify(address: string): Promise<boolean | null> {
    const key = apiKey();
    if (!key) return null;

    const body = await hunterGet("email-verifier", { email: address }, key);
    const parsed = EmailVerifierSchema.safeParse(body);
    if (!parsed.success) {
      throw schemaError("email-verifier", parsed.error.message);
    }

    const status = parsed.data.data.status.trim().toLowerCase();
    if (status === "valid") return true;
    if (status === "invalid") return false;
    return null;
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  `npx vitest run src/lib/contacts/hunter.test.ts` — every test green.
  If `rejects.toSatisfy` is unavailable in this vitest version, replace the last test's body with a `try/catch` that asserts `!message.includes("hunter-test-key")`; do not drop the assertion.

- [ ] **Step 5: Verify the reserved `.env.example` block before editing it.**
  `grep -n "Contact enrichment" -A 3 .env.example`
  Confirm it currently reads exactly:
  ```
  36: # Contact enrichment for the recruiter finder (spec section 26)
  37: HUNTER_API_KEY=""
  38: PEOPLE_DATA_LABS_API_KEY=""
  ```
  If the line numbers have moved, use the grep output rather than the numbers above.

- [ ] **Step 6: Update `.env.example` so the comment says the key is now read.**
  Replace lines 36-38 with:

  ```
  # Contact enrichment for the recruiter finder (spec section 26).
  #
  # HUNTER_API_KEY is now READ, by src/lib/contacts/hunter.ts. It is optional:
  # leave it blank and every Hunter call returns null, the contact finder runs
  # on the free signals alone (MX records, name permutation, Gravatar hits and
  # bounce feedback), and nothing is reported as broken — an unconfigured
  # optional dependency is an ordinary state, the same way an unconfigured
  # mailbox is.
  #
  # Hunter's free plan is metered — currently published as 50 credits a month,
  # where a find costs 1 credit and a verification half a credit. Because of
  # that, the pipeline never spends a call on a question already answered: the
  # domain pattern is fetched once per domain and persisted to EmailPattern,
  # and an address already CONFIRMED or BOUNCED is never re-verified
  # (spec section 11). Check https://hunter.io/pricing for the current
  # allowance before planning around that number.
  HUNTER_API_KEY=""

  # Not read by any code yet — reserved.
  PEOPLE_DATA_LABS_API_KEY=""
  ```

- [ ] **Step 7: Run the full suite and type-check.**
  `npm test`
  `npm run typecheck`
  Both clean. The full suite is the check that adding `src/lib/contacts/` broke nothing else.

- [ ] **Step 8: Commit.**
  ```
  git add src/lib/contacts/hunter.ts src/lib/contacts/hunter.test.ts .env.example
  git commit -m "Read Hunter when it is configured, and nothing when it is not"
  ```

---

## Phase 3 — Persistence

> **NOTE TO THE ASSEMBLING EDITOR — testing strategy for the two store tasks.**
>
> I searched the repo for any test that touches a real database
> (`grep -rln "@/lib/db\|prisma" --include="*.test.ts" src`). **There are none.**
> Every test that mentions Prisma — `src/lib/alerts/dispatch.test.ts`,
> `src/lib/apply/worker.test.ts`, `src/lib/analytics/summarize.test.ts` — builds a
> hand-rolled `fakeDb()` object and casts it `as unknown as PrismaClient`. There is
> no test database, no `vitest.config.ts`, and no global test setup file.
>
> There are also **no existing `store.test.ts` files at all** — `src/lib/candidate/store.ts`
> and `src/lib/applications/store.ts` ship untested.
>
> Both new stores therefore take `db: PrismaClient` as their **first parameter**, exactly
> like the two existing stores do, and their tests run against an injected fake. This is
> dependency injection, not a new convention: it is already how every store in this repo
> is written, and it is what makes the tests below runnable with no Postgres.
>
> If another fragment in this plan assumes a live-database test harness, reconcile toward
> this one — adding a Postgres-dependent test suite would be the first in the repo.

> **WINDOWS HAZARD, applies to every step that regenerates the Prisma client.**
> `prisma generate` (which `npm run db:push` runs) fails with `EPERM: operation not
> permitted, rename ... query_engine-windows.dll.node` if **any** node process in this
> repo still holds the DLL. Before running `npm run db:push`, stop the dev server
> (`npm run dev`), the scanner (`npm run scan`), and the apply daemon (`npm run daemon`),
> **including their `tsx` child processes** — `tsx` spawns a child that keeps the handle
> open after the parent is killed. Verify with
> `Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, Path` and kill any
> survivor rooted in this repo. Never run `npm run build` while `npm run dev` is up, for
> the same reason.

> **Commit style.** `git log --oneline -10` shows prose imperative subjects with no
> conventional-commit prefix: *"Make restoring a backup safe to run twice"*, *"Harden the
> password gate for a public address"*, *"Design for reaching people, not just boards"*.
> Every commit message below follows that. No `feat:`, no `chore:`.

---


### Task 10: Contact persistence (`src/lib/contacts/store.ts`)

**Files:**
- Create: `src/lib/contacts/store.ts`
- Test: `src/lib/contacts/store.test.ts`

**Interfaces:**
- Consumes (from Task 1, via `@prisma/client`):
  - `type PrismaClient`, `type Contact`, `type ContactEmail`, `type EmailPattern`
  - `ContactSource`, `ContactEmailStatus`, `EmailPatternSource`
  - `db.contactEmail.upsert({ where: { contactId_address: { contactId, address } }, ... })`
  - `db.emailPattern.findUnique({ where: { domain } })`
- Produces (Tasks that build `discover.ts`, `/contacts`, and the outreach store rely on these exact names):
  - `interface ContactInput { firstName: string; lastName: string; title?: string | null; domain: string; linkedinUrl?: string | null; source?: ContactSource; notes?: string | null }`
  - `type ContactWithEmails = Contact & { emails: ContactEmail[] }`
  - `interface AddressRow { address: string; pattern?: string | null; confidence?: number }`
  - `resolveCompanyId(db: PrismaClient, domain: string): Promise<string | null>`
  - `createContact(db: PrismaClient, input: ContactInput): Promise<Contact>`
  - `listContacts(db: PrismaClient): Promise<ContactWithEmails[]>`
  - `upsertContactEmails(db: PrismaClient, contactId: string, rows: AddressRow[]): Promise<ContactEmail[]>`
  - `updateEmailStatus(db: PrismaClient, emailId: string, status: ContactEmailStatus, confidence?: number): Promise<ContactEmail>`
  - `getEmailPattern(db: PrismaClient, domain: string): Promise<EmailPattern | null>`
  - `saveEmailPattern(db: PrismaClient, domain: string, pattern: string, source: EmailPatternSource, confidence: number): Promise<EmailPattern>`
  - `confirmEmailPattern(db: PrismaClient, domain: string, pattern: string): Promise<EmailPattern>`
  - `patternConfidence(confirmedCount: number): number`

- [ ] **Step 1: Write the failing test for defensive domain→company resolution and contact creation.**
  This is the rule the design calls out by name, so it gets the first test and its own
  fake. Create `src/lib/contacts/store.test.ts`:
  ```ts
  /**
   * Tests for contact persistence.
   *
   * The rule worth pinning down is the domain-to-company join. `Company.domain` has
   * no unique constraint of any kind — deduplication is enforced only in application
   * code (src/app/companies/actions.ts) — so two rows can claim the same domain. A
   * contact quietly filed under the wrong duplicate would show the candidate outreach
   * history for a company he never contacted, so an ambiguous lookup attaches nothing
   * and the contact stands on its own `domain`.
   *
   * The second rule: re-running discovery over a contact must never walk a BOUNCED or
   * CONFIRMED address back to GUESSED. Evidence is only ever added by the code that
   * gathered it.
   *
   * These run against a hand-rolled stand-in for Prisma rather than a real database,
   * matching src/lib/alerts/dispatch.test.ts — the behaviour worth testing is the
   * decision-making, not the SQL.
   */

  import { describe, it, expect } from "vitest";
  import {
    ContactEmailStatus,
    ContactSource,
    EmailPatternSource,
    type PrismaClient,
  } from "@prisma/client";
  import {
    confirmEmailPattern,
    createContact,
    getEmailPattern,
    listContacts,
    patternConfidence,
    resolveCompanyId,
    saveEmailPattern,
    updateEmailStatus,
    upsertContactEmails,
  } from "./store";

  interface FakeCompany {
    id: string;
    domain: string | null;
  }

  interface FakeContact {
    id: string;
    firstName: string;
    lastName: string;
    title: string | null;
    domain: string;
    linkedinUrl: string | null;
    source: ContactSource;
    notes: string | null;
    companyId: string | null;
    updatedAt: Date;
  }

  interface FakeEmail {
    id: string;
    contactId: string;
    address: string;
    pattern: string | null;
    confidence: number;
    status: ContactEmailStatus;
    checkedAt: Date | null;
  }

  interface FakePattern {
    id: string;
    domain: string;
    pattern: string;
    source: EmailPatternSource;
    confidence: number;
    confirmedCount: number;
  }

  interface Seed {
    companies?: FakeCompany[];
    contacts?: FakeContact[];
    emails?: FakeEmail[];
    patterns?: FakePattern[];
  }

  /** A stand-in for the four Prisma models this store touches. */
  function fakeDb(seed: Seed = {}) {
    const companies = [...(seed.companies ?? [])];
    const contacts = [...(seed.contacts ?? [])];
    const emails = [...(seed.emails ?? [])];
    const patterns = [...(seed.patterns ?? [])];

    const db = {
      company: {
        findMany: async ({ where }: { where: { domain: string } }) =>
          companies.filter((row) => row.domain === where.domain),
      },
      contact: {
        create: async ({ data }: { data: Partial<FakeContact> }) => {
          const row: FakeContact = {
            id: `contact-${contacts.length + 1}`,
            firstName: "",
            lastName: "",
            title: null,
            domain: "",
            linkedinUrl: null,
            source: ContactSource.MANUAL,
            notes: null,
            companyId: null,
            updatedAt: new Date(0),
            ...data,
          };
          contacts.push(row);
          return row;
        },
        findMany: async () =>
          [...contacts]
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .map((contact) => ({
              ...contact,
              emails: emails
                .filter((email) => email.contactId === contact.id)
                .sort(
                  (a, b) =>
                    b.confidence - a.confidence || a.address.localeCompare(b.address),
                ),
            })),
      },
      contactEmail: {
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { contactId_address: { contactId: string; address: string } };
          create: Partial<FakeEmail>;
          update: Partial<FakeEmail>;
        }) => {
          const key = where.contactId_address;
          const found = emails.find(
            (row) => row.contactId === key.contactId && row.address === key.address,
          );
          if (found) {
            Object.assign(found, update);
            return found;
          }
          const row: FakeEmail = {
            id: `email-${emails.length + 1}`,
            contactId: key.contactId,
            address: key.address,
            pattern: null,
            confidence: 0,
            status: ContactEmailStatus.GUESSED,
            checkedAt: null,
            ...create,
          };
          emails.push(row);
          return row;
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeEmail>;
        }) => {
          const row = emails.find((email) => email.id === where.id);
          if (!row) throw new Error(`no ContactEmail ${where.id}`);
          Object.assign(row, data);
          return row;
        },
      },
      emailPattern: {
        findUnique: async ({ where }: { where: { domain: string } }) =>
          patterns.find((row) => row.domain === where.domain) ?? null,
        create: async ({ data }: { data: Partial<FakePattern> }) => {
          const row: FakePattern = {
            id: `pattern-${patterns.length + 1}`,
            domain: "",
            pattern: "",
            source: EmailPatternSource.INFERRED,
            confidence: 0,
            confirmedCount: 0,
            ...data,
          };
          patterns.push(row);
          return row;
        },
        update: async ({
          where,
          data,
        }: {
          where: { domain: string };
          data: Partial<FakePattern>;
        }) => {
          const row = patterns.find((entry) => entry.domain === where.domain);
          if (!row) throw new Error(`no EmailPattern ${where.domain}`);
          Object.assign(row, data);
          return row;
        },
      },
    };

    return { db: db as unknown as PrismaClient, companies, contacts, emails, patterns };
  }

  describe("resolveCompanyId", () => {
    it("attaches the company when exactly one row claims the domain", async () => {
      const { db } = fakeDb({ companies: [{ id: "co-1", domain: "acme.com" }] });
      expect(await resolveCompanyId(db, "acme.com")).toBe("co-1");
    });

    it("attaches nothing when no company claims the domain", async () => {
      const { db } = fakeDb({ companies: [{ id: "co-1", domain: "other.com" }] });
      expect(await resolveCompanyId(db, "acme.com")).toBeNull();
    });

    it("attaches nothing when the domain is ambiguous", async () => {
      // Company has no unique constraint on domain, so this really happens.
      const { db } = fakeDb({
        companies: [
          { id: "co-1", domain: "acme.com" },
          { id: "co-2", domain: "acme.com" },
        ],
      });
      expect(await resolveCompanyId(db, "acme.com")).toBeNull();
    });
  });

  describe("createContact", () => {
    it("files the contact under the one company that matches", async () => {
      const { db } = fakeDb({ companies: [{ id: "co-1", domain: "acme.com" }] });
      const contact = await createContact(db, {
        firstName: "Jane",
        lastName: "Okafor",
        title: "University Recruiter",
        domain: "ACME.com ",
      });
      expect(contact.companyId).toBe("co-1");
      // Normalised on the way in, so the join and the guesser agree.
      expect(contact.domain).toBe("acme.com");
      expect(contact.source).toBe(ContactSource.MANUAL);
    });

    it("lets the contact stand alone when the domain is ambiguous", async () => {
      const { db } = fakeDb({
        companies: [
          { id: "co-1", domain: "acme.com" },
          { id: "co-2", domain: "acme.com" },
        ],
      });
      const contact = await createContact(db, {
        firstName: "Jane",
        lastName: "Okafor",
        domain: "acme.com",
      });
      expect(contact.companyId).toBeNull();
      expect(contact.domain).toBe("acme.com");
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```powershell
  npx vitest run src/lib/contacts/store.test.ts
  ```
  Expect `Failed to load ... ./store` — the module does not exist yet. That is the
  correct failure; if it reports anything else, the test file itself is wrong.

- [ ] **Step 3: Write the minimal `store.ts` that satisfies those two describes.**
  Create `src/lib/contacts/store.ts`:
  ```ts
  /**
   * Reading and writing contacts, their candidate addresses, and the learned
   * address pattern for a mail domain (spec §26).
   *
   * The domain-to-company join is deliberately defensive. `Company.domain` has no
   * unique constraint, so two rows can claim the same domain; filing a contact under
   * the wrong duplicate would show the candidate outreach history for a company he
   * never contacted. An ambiguous lookup attaches nothing and lets the contact stand
   * on its own `domain`, which is all the guessing pipeline ever needs.
   */

  import {
    ContactSource,
    type Contact,
    type ContactEmail,
    type ContactEmailStatus,
    type PrismaClient,
  } from "@prisma/client";

  /** What the /contacts form collects for a new person. */
  export interface ContactInput {
    firstName: string;
    lastName: string;
    title?: string | null;
    domain: string;
    linkedinUrl?: string | null;
    source?: ContactSource;
    notes?: string | null;
  }

  /** A contact with its candidate addresses, best guess first. */
  export type ContactWithEmails = Contact & { emails: ContactEmail[] };

  /** Lowercased and trimmed, so the join, the guesser and EmailPattern agree. */
  function normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  /**
   * The company that owns this domain, or null.
   *
   * Null on *both* no match and several matches. A wrong join is worse than no join
   * here, and because `Contact.domain` is non-nullable and independent of the join,
   * no join costs the feature nothing.
   */
  export async function resolveCompanyId(
    db: PrismaClient,
    domain: string,
  ): Promise<string | null> {
    const matches = await db.company.findMany({
      where: { domain: normalizeDomain(domain) },
      select: { id: true },
    });
    const only = matches.length === 1 ? matches[0] : undefined;
    return only ? only.id : null;
  }

  /** Add a person, attaching the company only when the domain is unambiguous. */
  export async function createContact(
    db: PrismaClient,
    input: ContactInput,
  ): Promise<Contact> {
    const domain = normalizeDomain(input.domain);
    const companyId = await resolveCompanyId(db, domain);

    return db.contact.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        title: input.title ?? null,
        domain,
        linkedinUrl: input.linkedinUrl ?? null,
        source: input.source ?? ContactSource.MANUAL,
        notes: input.notes ?? null,
        companyId,
      },
    });
  }
  ```
  (`ContactEmailStatus` is imported as a type here and used by later steps; if the
  linter objects to an unused import at this stage, add it in Step 7 instead.)

- [ ] **Step 4: Run the test and watch it pass.**
  ```powershell
  npx vitest run src/lib/contacts/store.test.ts
  ```
  Expect 5 passing tests. Then `npm run typecheck` — expect exit 0.

- [ ] **Step 5: Commit the first cycle.**
  ```powershell
  git add src/lib/contacts/store.ts src/lib/contacts/store.test.ts
  git commit -m "Resolve a contact's company only when the domain is unambiguous"
  ```

- [ ] **Step 6: Write the failing test for listing and for address upserts.**
  Append to `src/lib/contacts/store.test.ts`:
  ```ts
  function contactRow(id: string, updatedAt: Date): FakeContact {
    return {
      id,
      firstName: "Jane",
      lastName: "Okafor",
      title: null,
      domain: "acme.com",
      linkedinUrl: null,
      source: ContactSource.MANUAL,
      notes: null,
      companyId: null,
      updatedAt,
    };
  }

  describe("listContacts", () => {
    it("returns contacts most-recently-touched first, with their addresses ranked", async () => {
      const { db } = fakeDb({
        contacts: [
          contactRow("contact-1", new Date("2026-09-01T00:00:00.000Z")),
          contactRow("contact-2", new Date("2026-09-10T00:00:00.000Z")),
        ],
        emails: [
          {
            id: "email-1",
            contactId: "contact-2",
            address: "j.okafor@acme.com",
            pattern: "f.last",
            confidence: 20,
            status: ContactEmailStatus.GUESSED,
            checkedAt: null,
          },
          {
            id: "email-2",
            contactId: "contact-2",
            address: "jane.okafor@acme.com",
            pattern: "first.last",
            confidence: 70,
            status: ContactEmailStatus.GUESSED,
            checkedAt: null,
          },
        ],
      });

      const listed = await listContacts(db);
      expect(listed.map((row) => row.id)).toEqual(["contact-2", "contact-1"]);
      expect(listed[0]?.emails.map((row) => row.address)).toEqual([
        "jane.okafor@acme.com",
        "j.okafor@acme.com",
      ]);
    });
  });

  describe("upsertContactEmails", () => {
    it("writes one row per address and lowercases it", async () => {
      const { db, emails } = fakeDb();
      const saved = await upsertContactEmails(db, "contact-1", [
        { address: "Jane.Okafor@ACME.com", pattern: "first.last", confidence: 70 },
        { address: "jokafor@acme.com", pattern: "flast", confidence: 40 },
      ]);

      expect(saved).toHaveLength(2);
      expect(emails.map((row) => row.address)).toEqual([
        "jane.okafor@acme.com",
        "jokafor@acme.com",
      ]);
    });

    it("re-scores an address it already knows instead of duplicating it", async () => {
      const { db, emails } = fakeDb({
        emails: [
          {
            id: "email-1",
            contactId: "contact-1",
            address: "jane.okafor@acme.com",
            pattern: "first.last",
            confidence: 40,
            status: ContactEmailStatus.GUESSED,
            checkedAt: null,
          },
        ],
      });

      await upsertContactEmails(db, "contact-1", [
        { address: "jane.okafor@acme.com", pattern: "first.last", confidence: 85 },
      ]);

      expect(emails).toHaveLength(1);
      expect(emails[0]?.confidence).toBe(85);
    });

    it("never walks a bounced address back to guessed", async () => {
      // Discovery re-runs. Evidence gathered by the bounce watcher must survive it.
      const { db, emails } = fakeDb({
        emails: [
          {
            id: "email-1",
            contactId: "contact-1",
            address: "jane.okafor@acme.com",
            pattern: "first.last",
            confidence: 0,
            status: ContactEmailStatus.BOUNCED,
            checkedAt: new Date("2026-09-05T00:00:00.000Z"),
          },
        ],
      });

      await upsertContactEmails(db, "contact-1", [
        { address: "jane.okafor@acme.com", pattern: "first.last", confidence: 85 },
      ]);

      expect(emails[0]?.status).toBe(ContactEmailStatus.BOUNCED);
    });
  });

  describe("updateEmailStatus", () => {
    it("records the status, the score and the moment it was checked", async () => {
      const { db, emails } = fakeDb({
        emails: [
          {
            id: "email-1",
            contactId: "contact-1",
            address: "jane.okafor@acme.com",
            pattern: "first.last",
            confidence: 40,
            status: ContactEmailStatus.GUESSED,
            checkedAt: null,
          },
        ],
      });

      const updated = await updateEmailStatus(
        db,
        "email-1",
        ContactEmailStatus.GRAVATAR_HIT,
        88,
      );

      expect(updated.status).toBe(ContactEmailStatus.GRAVATAR_HIT);
      expect(emails[0]?.confidence).toBe(88);
      // Null meant "never checked"; that has stopped being true.
      expect(emails[0]?.checkedAt).toBeInstanceOf(Date);
    });
  });
  ```

- [ ] **Step 7: Run the test and watch the new describes fail.**
  ```powershell
  npx vitest run src/lib/contacts/store.test.ts
  ```
  Expect the 5 tests from Step 1 to pass and the 5 new ones to fail with
  `listContacts is not a function` / `upsertContactEmails is not a function` /
  `updateEmailStatus is not a function`.

- [ ] **Step 8: Implement listing, upserts and status updates.**
  Append to `src/lib/contacts/store.ts`:
  ```ts
  /** Every contact, most-recently-touched first, with its addresses ranked. */
  export async function listContacts(db: PrismaClient): Promise<ContactWithEmails[]> {
    return db.contact.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        emails: { orderBy: [{ confidence: "desc" }, { address: "asc" }] },
      },
    });
  }

  /** One candidate address as the discovery pipeline produced it. */
  export interface AddressRow {
    address: string;
    pattern?: string | null;
    confidence?: number;
  }

  /**
   * Save the pipeline's candidate addresses for a contact.
   *
   * Keyed on the schema's @@unique([contactId, address]) so a re-run updates what it
   * already knows instead of duplicating it. `status` is deliberately absent from the
   * update: re-running discovery must never walk a BOUNCED or CONFIRMED address back
   * to GUESSED. A null `pattern` in the input is also left alone rather than written,
   * because "no pattern explains this" is not a reason to forget one we had.
   */
  export async function upsertContactEmails(
    db: PrismaClient,
    contactId: string,
    rows: AddressRow[],
  ): Promise<ContactEmail[]> {
    const saved: ContactEmail[] = [];

    for (const row of rows) {
      const address = row.address.trim().toLowerCase();
      saved.push(
        await db.contactEmail.upsert({
          where: { contactId_address: { contactId, address } },
          create: {
            contactId,
            address,
            pattern: row.pattern ?? null,
            confidence: row.confidence ?? 0,
          },
          update: {
            confidence: row.confidence ?? 0,
            ...(row.pattern ? { pattern: row.pattern } : {}),
          },
        }),
      );
    }

    return saved;
  }

  /** Record what a verification signal found out about one address. */
  export async function updateEmailStatus(
    db: PrismaClient,
    emailId: string,
    status: ContactEmailStatus,
    confidence?: number,
  ): Promise<ContactEmail> {
    return db.contactEmail.update({
      where: { id: emailId },
      data: {
        status,
        ...(confidence === undefined ? {} : { confidence }),
        checkedAt: new Date(),
      },
    });
  }
  ```

- [ ] **Step 9: Run the test and watch it pass.**
  ```powershell
  npx vitest run src/lib/contacts/store.test.ts
  ```
  Expect 10 passing tests. Then `npm run typecheck` — expect exit 0.

- [ ] **Step 10: Commit the second cycle.**
  ```powershell
  git add src/lib/contacts/store.ts src/lib/contacts/store.test.ts
  git commit -m "Keep hard-won evidence when discovery re-runs over an address"
  ```

- [ ] **Step 11: Write the failing test for EmailPattern read and write.**
  Append to `src/lib/contacts/store.test.ts`:
  ```ts
  describe("patternConfidence", () => {
    it("rises with each confirmation and stops short of certain", () => {
      expect(patternConfidence(0)).toBe(40);
      expect(patternConfidence(1)).toBeGreaterThan(patternConfidence(0));
      expect(patternConfidence(2)).toBeGreaterThan(patternConfidence(1));
      // Never 100: a pattern that held four times is still a pattern, not a fact.
      expect(patternConfidence(50)).toBe(95);
    });
  });

  describe("EmailPattern read and write", () => {
    it("returns null for a domain nothing is known about", async () => {
      const { db } = fakeDb();
      expect(await getEmailPattern(db, "acme.com")).toBeNull();
    });

    it("stores a pattern from a named source and reads it back", async () => {
      const { db } = fakeDb();
      await saveEmailPattern(
        db,
        "ACME.com ",
        "first.last",
        EmailPatternSource.HUNTER,
        80,
      );

      const found = await getEmailPattern(db, "acme.com");
      expect(found?.pattern).toBe("first.last");
      expect(found?.source).toBe(EmailPatternSource.HUNTER);
      expect(found?.confidence).toBe(80);
      // Hunter telling us the pattern is not the same as us confirming it.
      expect(found?.confirmedCount).toBe(0);
    });

    it("counts an unambiguous confirmation of the pattern already on file", async () => {
      const { db } = fakeDb({
        patterns: [
          {
            id: "pattern-1",
            domain: "acme.com",
            pattern: "first.last",
            source: EmailPatternSource.INFERRED,
            confidence: 40,
            confirmedCount: 1,
          },
        ],
      });

      const confirmed = await confirmEmailPattern(db, "acme.com", "first.last");
      expect(confirmed.confirmedCount).toBe(2);
      expect(confirmed.confidence).toBe(patternConfidence(2));
    });

    it("restarts the count when a confirmation contradicts the stored pattern", async () => {
      // The old count backed a different claim and must not be inherited.
      const { db } = fakeDb({
        patterns: [
          {
            id: "pattern-1",
            domain: "acme.com",
            pattern: "first.last",
            source: EmailPatternSource.HUNTER,
            confidence: 80,
            confirmedCount: 3,
          },
        ],
      });

      const confirmed = await confirmEmailPattern(db, "acme.com", "flast");
      expect(confirmed.pattern).toBe("flast");
      expect(confirmed.confirmedCount).toBe(1);
      expect(confirmed.source).toBe(EmailPatternSource.INFERRED);
    });
  });
  ```

- [ ] **Step 12: Run the test and watch the new describes fail.**
  ```powershell
  npx vitest run src/lib/contacts/store.test.ts
  ```
  Expect 10 passing and 5 failing with `patternConfidence is not a function` and friends.

- [ ] **Step 13: Implement the EmailPattern reader and the two writers.**
  Append to `src/lib/contacts/store.ts` (and add `EmailPatternSource` plus
  `type EmailPattern` to the import block at the top of the file):
  ```ts
  /**
   * 0-100 for an inferred pattern, from how many times it has been confirmed.
   *
   * JUDGMENT CALL: the design says only "rises with confirmedCount". This curve is a
   * placeholder with the two properties that matter — monotonic, and capped below
   * 100, because a pattern that held four times is still a pattern and not a fact.
   */
  export function patternConfidence(confirmedCount: number): number {
    if (confirmedCount <= 0) return 40;
    return Math.min(95, 40 + 20 * confirmedCount);
  }

  /** What is known about the address pattern at this domain, if anything. */
  export async function getEmailPattern(
    db: PrismaClient,
    domain: string,
  ): Promise<EmailPattern | null> {
    return db.emailPattern.findUnique({ where: { domain: normalizeDomain(domain) } });
  }

  /**
   * Record a pattern from a source that asserted it (Hunter, or a human).
   *
   * Does not touch `confirmedCount`: being told a pattern is not the same as having
   * watched it work, and only the second kind of evidence is counted.
   */
  export async function saveEmailPattern(
    db: PrismaClient,
    domain: string,
    pattern: string,
    source: EmailPatternSource,
    confidence: number,
  ): Promise<EmailPattern> {
    const key = normalizeDomain(domain);
    const existing = await db.emailPattern.findUnique({ where: { domain: key } });

    if (!existing) {
      return db.emailPattern.create({
        data: { domain: key, pattern, source, confidence, confirmedCount: 0 },
      });
    }
    return db.emailPattern.update({
      where: { domain: key },
      data: { pattern, source, confidence },
    });
  }

  /**
   * Count one unambiguous confirmation — a real address that this pattern explains.
   *
   * This is the call that makes the free path compound. Ambiguous evidence never
   * reaches here: inferPattern() returns null when two patterns both explain an
   * address, and the caller must not invent a choice.
   */
  export async function confirmEmailPattern(
    db: PrismaClient,
    domain: string,
    pattern: string,
  ): Promise<EmailPattern> {
    const key = normalizeDomain(domain);
    const existing = await db.emailPattern.findUnique({ where: { domain: key } });

    if (!existing) {
      return db.emailPattern.create({
        data: {
          domain: key,
          pattern,
          source: EmailPatternSource.INFERRED,
          confidence: patternConfidence(1),
          confirmedCount: 1,
        },
      });
    }

    if (existing.pattern !== pattern) {
      // A different pattern than the one on file: the old count backed a different
      // claim, so it starts over rather than transferring.
      return db.emailPattern.update({
        where: { domain: key },
        data: {
          pattern,
          source: EmailPatternSource.INFERRED,
          confidence: patternConfidence(1),
          confirmedCount: 1,
        },
      });
    }

    const confirmedCount = existing.confirmedCount + 1;
    return db.emailPattern.update({
      where: { domain: key },
      data: { confirmedCount, confidence: patternConfidence(confirmedCount) },
    });
  }
  ```
  The import block at the top of `store.ts` becomes:
  ```ts
  import {
    ContactSource,
    EmailPatternSource,
    type Contact,
    type ContactEmail,
    type ContactEmailStatus,
    type EmailPattern,
    type PrismaClient,
  } from "@prisma/client";
  ```

- [ ] **Step 14: Run the whole suite and type-check.**
  ```powershell
  npx vitest run src/lib/contacts/store.test.ts
  npm test
  npm run typecheck
  ```
  Expect 15 passing in the store file, the full suite green, and typecheck exit 0.

- [ ] **Step 15: Commit the third cycle.**
  ```powershell
  git add src/lib/contacts/store.ts src/lib/contacts/store.test.ts
  git commit -m "Remember the address pattern a domain uses"
  ```

---

### Task 11: Outreach persistence (`src/lib/outreach/store.ts`)

**Files:**
- Create: `src/lib/outreach/store.ts`
- Test: `src/lib/outreach/store.test.ts`

**Interfaces:**
- Consumes:
  - From Task 1, via `@prisma/client`: `type PrismaClient`, `type OutreachMessage`, `type Contact`, `OutreachStatus`, `ContactEmailStatus`
  - From Task 10, conceptually: `ContactEmail.status` is written here too. This store does **not** import `src/lib/contacts/store.ts` — the two cross-model writes below are one-field updates and routing them through the contacts store would make the outreach store depend on it for nothing.
- Produces:
  - `interface DraftInput { contactId: string; emailId: string; applicationId?: string | null; subject: string; body: string; draftFolder?: string | null }`
  - `type OutreachWithContact = OutreachMessage & { contact: Contact }`
  - `createDraft(db: PrismaClient, input: DraftInput): Promise<OutreachMessage>`
  - `listMessagesForContact(db: PrismaClient, contactId: string): Promise<OutreachMessage[]>`
  - `markSent(db: PrismaClient, messageId: string, sentAt?: Date, draftFolder?: string | null): Promise<OutreachMessage>`
  - `recordBounce(db: PrismaClient, messageId: string, bounce: { hard: boolean }, at?: Date): Promise<OutreachMessage>`
  - `recordReply(db: PrismaClient, messageId: string, at?: Date): Promise<OutreachMessage>`
  - `setFollowUp(db: PrismaClient, messageId: string, followUpAt: Date | null): Promise<OutreachMessage>`
  - `listFollowUpsDue(db: PrismaClient, asOf?: Date): Promise<OutreachWithContact[]>`

- [ ] **Step 1: Write the failing test for drafting and for the thread view.**
  Create `src/lib/outreach/store.test.ts`:
  ```ts
  /**
   * Tests for outreach persistence.
   *
   * The interesting part is the cross-model write. A hard (5.x.x) bounce is the only
   * free proof that an address is wrong, so it must condemn the ContactEmail it named,
   * not just the message. Everything softer must not: a 4.x.x is a full mailbox or a
   * server having a bad hour, and a MAILER-DAEMON message recognised only by heuristic
   * could be an out-of-office. Treating either as a negative would discard a correct
   * address at exactly the companies whose mail servers are busiest.
   *
   * Symmetrically, a reply is the strongest signal available and marks the address
   * CONFIRMED.
   *
   * These run against a hand-rolled stand-in for Prisma rather than a real database,
   * matching src/lib/alerts/dispatch.test.ts.
   */

  import { describe, it, expect } from "vitest";
  import {
    ContactEmailStatus,
    OutreachStatus,
    type PrismaClient,
  } from "@prisma/client";
  import {
    createDraft,
    listFollowUpsDue,
    listMessagesForContact,
    markSent,
    recordBounce,
    recordReply,
    setFollowUp,
  } from "./store";

  interface FakeMessage {
    id: string;
    contactId: string;
    emailId: string;
    applicationId: string | null;
    subject: string;
    body: string;
    status: OutreachStatus;
    draftFolder: string | null;
    draftedAt: Date;
    sentAt: Date | null;
    bouncedAt: Date | null;
    repliedAt: Date | null;
    followUpAt: Date | null;
  }

  interface FakeEmail {
    id: string;
    status: ContactEmailStatus;
    confidence: number;
    checkedAt: Date | null;
  }

  interface MessageWhere {
    contactId?: string;
    status?: OutreachStatus;
    followUpAt?: { not?: null; lte?: Date };
  }

  /** A stand-in for the two Prisma models this store touches. */
  function fakeDb(seedMessages: FakeMessage[] = [], seedEmails: FakeEmail[] = []) {
    const messages = [...seedMessages];
    const emails = [...seedEmails];

    const db = {
      outreachMessage: {
        create: async ({ data }: { data: Partial<FakeMessage> }) => {
          const row: FakeMessage = {
            id: `msg-${messages.length + 1}`,
            contactId: "",
            emailId: "",
            applicationId: null,
            subject: "",
            body: "",
            status: OutreachStatus.DRAFT,
            draftFolder: null,
            draftedAt: new Date("2026-09-19T00:00:00.000Z"),
            sentAt: null,
            bouncedAt: null,
            repliedAt: null,
            followUpAt: null,
            ...data,
          };
          messages.push(row);
          return row;
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeMessage>;
        }) => {
          const row = messages.find((message) => message.id === where.id);
          if (!row) throw new Error(`no OutreachMessage ${where.id}`);
          Object.assign(row, data);
          return row;
        },
        findMany: async ({
          where = {},
          orderBy,
        }: {
          where?: MessageWhere;
          orderBy?: Record<string, string>;
        }) => {
          const matched = messages.filter((message) => {
            if (where.contactId !== undefined && message.contactId !== where.contactId) {
              return false;
            }
            if (where.status !== undefined && message.status !== where.status) {
              return false;
            }
            if (where.followUpAt) {
              if (message.followUpAt === null) return false;
              const { lte } = where.followUpAt;
              if (lte && message.followUpAt.getTime() > lte.getTime()) return false;
            }
            return true;
          });

          const byFollowUp = orderBy !== undefined && "followUpAt" in orderBy;
          matched.sort((a, b) => {
            const left = byFollowUp ? (a.followUpAt?.getTime() ?? 0) : a.draftedAt.getTime();
            const right = byFollowUp ? (b.followUpAt?.getTime() ?? 0) : b.draftedAt.getTime();
            return left - right;
          });

          return matched.map((message) => ({
            ...message,
            contact: { id: message.contactId },
          }));
        },
      },
      contactEmail: {
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeEmail>;
        }) => {
          const row = emails.find((email) => email.id === where.id);
          if (!row) throw new Error(`no ContactEmail ${where.id}`);
          Object.assign(row, data);
          return row;
        },
      },
    };

    return { db: db as unknown as PrismaClient, messages, emails };
  }

  function messageRow(id: string, overrides: Partial<FakeMessage> = {}): FakeMessage {
    return {
      id,
      contactId: "contact-1",
      emailId: "email-1",
      applicationId: null,
      subject: "Hello from a student",
      body: "Dear Jane,",
      status: OutreachStatus.DRAFT,
      draftFolder: null,
      draftedAt: new Date("2026-09-19T00:00:00.000Z"),
      sentAt: null,
      bouncedAt: null,
      repliedAt: null,
      followUpAt: null,
      ...overrides,
    };
  }

  function emailRow(id: string): FakeEmail {
    return { id, status: ContactEmailStatus.GUESSED, confidence: 60, checkedAt: null };
  }

  describe("createDraft", () => {
    it("starts a message as a draft, with no send having happened", async () => {
      const { db } = fakeDb();
      const draft = await createDraft(db, {
        contactId: "contact-1",
        emailId: "email-1",
        subject: "Hello from a student",
        body: "Dear Jane,",
      });

      expect(draft.status).toBe(OutreachStatus.DRAFT);
      expect(draft.sentAt).toBeNull();
      // Optional because introducing yourself before applying is a normal order.
      expect(draft.applicationId).toBeNull();
    });

    it("keeps the application association when one was given", async () => {
      const { db } = fakeDb();
      const draft = await createDraft(db, {
        contactId: "contact-1",
        emailId: "email-1",
        applicationId: "app-1",
        subject: "Following up on my application",
        body: "Dear Jane,",
        draftFolder: "[Gmail]/Drafts",
      });

      expect(draft.applicationId).toBe("app-1");
      expect(draft.draftFolder).toBe("[Gmail]/Drafts");
    });
  });

  describe("listMessagesForContact", () => {
    it("returns the whole thread oldest-first so a second introduction is visible", async () => {
      const { db } = fakeDb([
        messageRow("msg-1", { draftedAt: new Date("2026-09-10T00:00:00.000Z") }),
        messageRow("msg-2", { draftedAt: new Date("2026-09-18T00:00:00.000Z") }),
        messageRow("msg-3", { contactId: "contact-2" }),
      ]);

      const thread = await listMessagesForContact(db, "contact-1");
      expect(thread.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  ```
  Expect `Failed to load ... ./store`.

- [ ] **Step 3: Write the minimal `store.ts` for drafting and listing.**
  Create `src/lib/outreach/store.ts`:
  ```ts
  /**
   * Reading and writing outreach messages (spec §27).
   *
   * This app never sends mail, so there is no SENDING state and no transport here.
   * A message is drafted, the person sends it from his own mail client and says so,
   * and everything after that is evidence arriving in his inbox: a bounce, or a reply.
   *
   * Two of the writes below reach across into ContactEmail, and that is the point of
   * this module. A hard bounce and a reply are the only free ground truth the free
   * path ever gets, and evidence that is not written down where the scorer reads it
   * may as well not have arrived.
   */

  import {
    OutreachStatus,
    type Contact,
    type OutreachMessage,
    type PrismaClient,
  } from "@prisma/client";

  /** Everything needed to record a draft the person has not sent yet. */
  export interface DraftInput {
    contactId: string;
    emailId: string;
    applicationId?: string | null;
    subject: string;
    body: string;
    draftFolder?: string | null;
  }

  /** A message with the person it was written to, for the follow-ups view. */
  export type OutreachWithContact = OutreachMessage & { contact: Contact };

  /** Record a draft. Nothing has been sent; only the person can do that. */
  export async function createDraft(
    db: PrismaClient,
    input: DraftInput,
  ): Promise<OutreachMessage> {
    return db.outreachMessage.create({
      data: {
        contactId: input.contactId,
        emailId: input.emailId,
        applicationId: input.applicationId ?? null,
        subject: input.subject,
        body: input.body,
        draftFolder: input.draftFolder ?? null,
      },
    });
  }

  /**
   * The whole thread with one person, oldest first.
   *
   * There is deliberately no unique constraint on OutreachMessage — a follow-up is a
   * second message — so the UI has to be able to show what has already been said, or
   * the candidate introduces himself twice by accident.
   */
  export async function listMessagesForContact(
    db: PrismaClient,
    contactId: string,
  ): Promise<OutreachMessage[]> {
    return db.outreachMessage.findMany({
      where: { contactId },
      orderBy: { draftedAt: "asc" },
    });
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  ```
  Expect 3 passing tests. Then `npm run typecheck` — expect exit 0.

- [ ] **Step 5: Commit the first cycle.**
  ```powershell
  git add src/lib/outreach/store.ts src/lib/outreach/store.test.ts
  git commit -m "Record an outreach draft and the thread it belongs to"
  ```

- [ ] **Step 6: Write the failing test for marking a message sent.**
  Append to `src/lib/outreach/store.test.ts`:
  ```ts
  describe("markSent", () => {
    it("sets SENT and the instant the watcher starts reading from", async () => {
      const { db, messages } = fakeDb([messageRow("msg-1")]);
      const at = new Date("2026-09-19T14:30:00.000Z");

      const sent = await markSent(db, "msg-1", at);

      expect(sent.status).toBe(OutreachStatus.SENT);
      expect(sent.sentAt).toEqual(at);
      expect(messages[0]?.sentAt).toEqual(at);
    });

    it("records where the draft was found when the person says so", async () => {
      const { db } = fakeDb([messageRow("msg-1")]);
      const sent = await markSent(
        db,
        "msg-1",
        new Date("2026-09-19T14:30:00.000Z"),
        "INBOX.Drafts",
      );
      expect(sent.draftFolder).toBe("INBOX.Drafts");
    });
  });
  ```

- [ ] **Step 7: Run the test and watch the new describe fail.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  ```
  Expect 3 passing and 2 failing with `markSent is not a function`.

- [ ] **Step 8: Implement `markSent`.**
  Append to `src/lib/outreach/store.ts`:
  ```ts
  /**
   * The person says he sent it.
   *
   * `sentAt` is load-bearing beyond display: the bounce watcher reads only mail that
   * arrived after this instant, so an unmarked message is never correlated with
   * anything and a bounce against it is missed entirely.
   */
  export async function markSent(
    db: PrismaClient,
    messageId: string,
    sentAt: Date = new Date(),
    draftFolder?: string | null,
  ): Promise<OutreachMessage> {
    return db.outreachMessage.update({
      where: { id: messageId },
      data: {
        status: OutreachStatus.SENT,
        sentAt,
        ...(draftFolder === undefined ? {} : { draftFolder }),
      },
    });
  }
  ```

- [ ] **Step 9: Run the test and watch it pass, then commit.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  npm run typecheck
  git add src/lib/outreach/store.ts src/lib/outreach/store.test.ts
  git commit -m "Mark an outreach message sent"
  ```
  Expect 5 passing before committing.

- [ ] **Step 10: Write the failing test for the bounce cross-model write.**
  This is the test the whole task exists for. Append to
  `src/lib/outreach/store.test.ts`:
  ```ts
  describe("recordBounce", () => {
    it("condemns the address a hard bounce named", async () => {
      const { db, messages, emails } = fakeDb(
        [messageRow("msg-1", { status: OutreachStatus.SENT, sentAt: new Date("2026-09-19T14:30:00.000Z") })],
        [emailRow("email-1")],
      );
      const at = new Date("2026-09-19T14:31:00.000Z");

      const bounced = await recordBounce(db, "msg-1", { hard: true }, at);

      expect(bounced.status).toBe(OutreachStatus.BOUNCED);
      expect(messages[0]?.bouncedAt).toEqual(at);
      // The cross-model write: 5.x.x is the only free proof an address is wrong.
      expect(emails[0]?.status).toBe(ContactEmailStatus.BOUNCED);
      expect(emails[0]?.confidence).toBe(0);
      expect(emails[0]?.checkedAt).toEqual(at);
    });

    it("leaves the address alone on a soft bounce", async () => {
      // 4.x.x is a full mailbox or a bad hour. Discarding the address over it would
      // lose correct addresses at the busiest employers.
      const { db, messages, emails } = fakeDb(
        [messageRow("msg-1", { status: OutreachStatus.SENT })],
        [emailRow("email-1")],
      );

      const bounced = await recordBounce(db, "msg-1", { hard: false });

      expect(bounced.status).toBe(OutreachStatus.BOUNCED);
      expect(messages[0]?.bouncedAt).toBeInstanceOf(Date);
      expect(emails[0]?.status).toBe(ContactEmailStatus.GUESSED);
      expect(emails[0]?.confidence).toBe(60);
      // Never checked is still the truth: nothing was learned about the address.
      expect(emails[0]?.checkedAt).toBeNull();
    });
  });
  ```

- [ ] **Step 11: Run the test and watch the new describe fail.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  ```
  Expect 5 passing and 2 failing with `recordBounce is not a function`.

- [ ] **Step 12: Implement `recordBounce`.**
  Append to `src/lib/outreach/store.ts` (and add `ContactEmailStatus` to the
  `@prisma/client` import block at the top):
  ```ts
  /**
   * A delivery status notification came back for this message.
   *
   * `hard` must come from a parsed 5.x.x status and nothing else. A soft 4.x.x, or a
   * MAILER-DAEMON message recognised only by the sender-address heuristic, marks the
   * message and stops there: misreading an out-of-office as a bounce would throw away
   * a correct address, and there is no way to get it back.
   */
  export async function recordBounce(
    db: PrismaClient,
    messageId: string,
    bounce: { hard: boolean },
    at: Date = new Date(),
  ): Promise<OutreachMessage> {
    const message = await db.outreachMessage.update({
      where: { id: messageId },
      data: { status: OutreachStatus.BOUNCED, bouncedAt: at },
    });

    if (bounce.hard) {
      await db.contactEmail.update({
        where: { id: message.emailId },
        data: {
          status: ContactEmailStatus.BOUNCED,
          confidence: 0,
          checkedAt: at,
        },
      });
    }

    return message;
  }
  ```
  The import block at the top of the file becomes:
  ```ts
  import {
    ContactEmailStatus,
    OutreachStatus,
    type Contact,
    type OutreachMessage,
    type PrismaClient,
  } from "@prisma/client";
  ```

- [ ] **Step 13: Run the test and watch it pass, then commit.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  npm run typecheck
  git add src/lib/outreach/store.ts src/lib/outreach/store.test.ts
  git commit -m "Let a hard bounce condemn the address it named"
  ```
  Expect 7 passing before committing.

- [ ] **Step 14: Write the failing test for replies and follow-ups.**
  Append to `src/lib/outreach/store.test.ts`:
  ```ts
  describe("recordReply", () => {
    it("confirms the address a reply came back from", async () => {
      const { db, messages, emails } = fakeDb(
        [messageRow("msg-1", { status: OutreachStatus.SENT })],
        [emailRow("email-1")],
      );
      const at = new Date("2026-09-20T09:00:00.000Z");

      const replied = await recordReply(db, "msg-1", at);

      expect(replied.status).toBe(OutreachStatus.REPLIED);
      expect(messages[0]?.repliedAt).toEqual(at);
      // A reply is ground truth — the strongest signal the free path ever gets.
      expect(emails[0]?.status).toBe(ContactEmailStatus.CONFIRMED);
      expect(emails[0]?.confidence).toBe(100);
    });
  });

  describe("follow-ups", () => {
    it("stores and clears a follow-up date", async () => {
      const { db, messages } = fakeDb([messageRow("msg-1", { status: OutreachStatus.SENT })]);
      const due = new Date("2026-09-26T00:00:00.000Z");

      await setFollowUp(db, "msg-1", due);
      expect(messages[0]?.followUpAt).toEqual(due);

      await setFollowUp(db, "msg-1", null);
      expect(messages[0]?.followUpAt).toBeNull();
    });

    it("surfaces only sent messages whose follow-up date has arrived, soonest first", async () => {
      const asOf = new Date("2026-09-26T12:00:00.000Z");
      const { db } = fakeDb([
        messageRow("msg-overdue", {
          status: OutreachStatus.SENT,
          followUpAt: new Date("2026-09-20T00:00:00.000Z"),
        }),
        messageRow("msg-today", {
          status: OutreachStatus.SENT,
          followUpAt: new Date("2026-09-26T09:00:00.000Z"),
        }),
        messageRow("msg-later", {
          status: OutreachStatus.SENT,
          followUpAt: new Date("2026-10-05T00:00:00.000Z"),
        }),
        messageRow("msg-no-date", { status: OutreachStatus.SENT }),
        // Answered and dead messages are not waiting on anybody.
        messageRow("msg-replied", {
          status: OutreachStatus.REPLIED,
          followUpAt: new Date("2026-09-20T00:00:00.000Z"),
        }),
        messageRow("msg-unsent", {
          status: OutreachStatus.DRAFT,
          followUpAt: new Date("2026-09-20T00:00:00.000Z"),
        }),
      ]);

      const due = await listFollowUpsDue(db, asOf);
      expect(due.map((message) => message.id)).toEqual(["msg-overdue", "msg-today"]);
      expect(due[0]?.contact.id).toBe("contact-1");
    });
  });
  ```

- [ ] **Step 15: Run the test and watch the new describes fail.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  ```
  Expect 7 passing and 3 failing with `recordReply is not a function` /
  `setFollowUp is not a function` / `listFollowUpsDue is not a function`.

- [ ] **Step 16: Implement replies and the follow-up queue.**
  Append to `src/lib/outreach/store.ts`:
  ```ts
  /**
   * A human replied.
   *
   * The strongest signal available anywhere in this feature, and the one that teaches
   * EmailPattern for free: the address is real, so the pattern that generated it is
   * the pattern at that domain. Marking the ContactEmail CONFIRMED here is what lets
   * the pattern learner find it later.
   */
  export async function recordReply(
    db: PrismaClient,
    messageId: string,
    at: Date = new Date(),
  ): Promise<OutreachMessage> {
    const message = await db.outreachMessage.update({
      where: { id: messageId },
      data: { status: OutreachStatus.REPLIED, repliedAt: at },
    });

    await db.contactEmail.update({
      where: { id: message.emailId },
      data: {
        status: ContactEmailStatus.CONFIRMED,
        confidence: 100,
        checkedAt: at,
      },
    });

    return message;
  }

  /** Set or clear the date the UI should nag about. Nothing acts on it. */
  export async function setFollowUp(
    db: PrismaClient,
    messageId: string,
    followUpAt: Date | null,
  ): Promise<OutreachMessage> {
    return db.outreachMessage.update({
      where: { id: messageId },
      data: { followUpAt },
    });
  }

  /**
   * Messages whose follow-up date has arrived, soonest first.
   *
   * SENT only, by design. A draft that was never sent is waiting on the person to
   * send it, not to follow up; a REPLIED or BOUNCED message is finished. This is the
   * "needs you" list the /contacts index puts at the top, the same shape the
   * /applications tracker already uses.
   */
  export async function listFollowUpsDue(
    db: PrismaClient,
    asOf: Date = new Date(),
  ): Promise<OutreachWithContact[]> {
    return db.outreachMessage.findMany({
      where: {
        status: OutreachStatus.SENT,
        followUpAt: { not: null, lte: asOf },
      },
      orderBy: { followUpAt: "asc" },
      include: { contact: true },
    });
  }
  ```

- [ ] **Step 17: Run everything and type-check.**
  ```powershell
  npx vitest run src/lib/outreach/store.test.ts
  npm test
  npm run typecheck
  ```
  Expect 10 passing in the outreach store file, the full suite green, typecheck exit 0.

- [ ] **Step 18: Commit the last cycle.**
  ```powershell
  git add src/lib/outreach/store.ts src/lib/outreach/store.test.ts
  git commit -m "Confirm an address when a reply arrives"
  ```

---


---

## Phase 4 — Orchestration

### Task 12: Discovery pipeline (`src/lib/contacts/discover.ts`)

`discover.ts` is one of only two modules in this feature that know the order of
operations (design §9). Everything it calls answers exactly one question and has
no opinion about when it is asked; this module holds the sequence, the
short-circuit, and the politeness budget.

**Files:**
- Create: `src/lib/contacts/discover.ts`
- Modify: none — `src/lib/contacts/{mx,gravatar,hunter,permute,pattern,score,store}.ts` are imported, not changed.
- Test: `src/lib/contacts/discover.test.ts`

**Interfaces:**

- Consumes:
  - `permuteAddresses(name: NameParts, domain: string): AddressCandidate[]` (Task 2)
  - `applyPattern(pattern: PatternId, name: NameParts, domain: string): string | null` (Task 3)
  - `scoreAddress(signals: AddressSignals): number` (Task 4)
  - `lookupMx(domain: string): Promise<MxResult>` (Task 7)
  - `hasGravatar(address: string): Promise<boolean>` (Task 8)
  - `hunterConfigured(env?: Record<string, string | undefined>): boolean` (Task 9)
  - `hunterDomainPattern(domain: string): Promise<PatternId | null>` (Task 9)
  - `hunterFindEmail(domain: string, name: NameParts): Promise<string | null>` (Task 9)
  - `hunterVerify(address: string): Promise<boolean | null>` (Task 9)
  - `HunterApiError` (Task 9)
  - From `src/lib/contacts/store.ts` (Task 10), via the deps object only:
    `getEmailPattern(db, domain)`, `upsertEmailPattern(db, {domain, pattern, source, confidence})`,
    `saveDiscoveredAddresses(db, contactId, rows)`.
    **Judgment call:** Task 10's exact export names were not fixed when this
    section was written. `discover.ts` never imports them directly — it reaches
    them through `DiscoverDeps`, so if Task 10 names them differently only
    `liveDeps()` changes, and not one test.
  - `PatternId`, `NameParts`, `AddressCandidate`, `AddressSignals`, `MxResult`, `MailProvider` — imported as types, never redeclared.

- Produces:
```ts
export const GRAVATAR_PROBE_LIMIT = 3;
export const GRAVATAR_DELAY_MS = 150;

export interface DiscoverInput {
  contactId: string;
  name: NameParts;
  domain: string;
}

export interface DiscoveredAddress {
  address: string;
  pattern: PatternId | null;
  confidence: number;
  status: ContactEmailStatus;
  gravatarHit: boolean;
  hunterVerified: boolean | null;
}

/** Why the returned list looks the way it does. Shown in the UI verbatim. */
export type DiscoveryStrategy = "no-mx" | "learned-pattern" | "hunter" | "permuted";

export interface DiscoveryResult {
  domain: string;
  hasMx: boolean;
  provider: MailProvider;
  strategy: DiscoveryStrategy;
  hunterConsulted: boolean;
  addresses: DiscoveredAddress[];
}

/** Every outside effect this pipeline can have, in one injectable object. */
export interface DiscoverDeps {
  lookupMx(domain: string): Promise<MxResult>;
  hasGravatar(address: string): Promise<boolean>;
  hunterConfigured(): boolean;
  hunterFindEmail(domain: string, name: NameParts): Promise<string | null>;
  hunterDomainPattern(domain: string): Promise<PatternId | null>;
  hunterVerify(address: string): Promise<boolean | null>;
  getEmailPattern(domain: string): Promise<PatternId | null>;
  saveEmailPattern(domain: string, pattern: PatternId, source: "HUNTER" | "INFERRED"): Promise<void>;
  saveAddresses(contactId: string, rows: DiscoveredAddress[]): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export function liveDeps(db: PrismaClient): DiscoverDeps;
export async function discoverAddresses(input: DiscoverInput, deps: DiscoverDeps): Promise<DiscoveryResult>;
```

`deps` is a required second parameter rather than an optional override. An
optional one would make "forgot to stub it" indistinguishable from "meant to
hit the network", and this is the module where that mistake costs a real
Hunter call.

**Why `GRAVATAR_PROBE_LIMIT = 3`.** Design §11 fixes the shape: one request per
address, sequential, with a short delay between candidates modelled on
`DETAIL_REQUEST_DELAY_MS` (`src/lib/ats/smartrecruiters.ts:116`). It does not fix
how many. Probing all ten is ten requests and ~1.4s per contact spent almost
entirely on the patterns least likely to be right — §13 already records that
Gravatar coverage on corporate domains is low, so the long tail of the list is
where a hit is least probable *and* least useful. The top three by prior
(`first.last` 0.34, `first` 0.12, `flast` 0.11) hold 0.57 of the modelled mass,
which is where a positive signal actually changes the ordering. The limit binds
only in the permutation branch: the learned-pattern and Hunter branches emit one
address and probe that one.

- [ ] **Step 1: Write the failing test for the MX short-circuit.**
  Create `src/lib/contacts/discover.test.ts`. This is the first required named
  test and it asserts on stub *call counts*, not on return values — the point is
  that nothing downstream ran.
```ts
/**
 * Tests for the discovery pipeline.
 *
 * This module is the one place that knows the order of operations, so what is
 * tested here is the order itself: what runs, what does not run, and what the
 * short-circuits actually prevent. Every dependency is injected, so the whole
 * pipeline runs with no network and no database.
 */

import { describe, expect, it, vi } from "vitest";
import { discoverAddresses, type DiscoverDeps } from "./discover";
import type { NameParts } from "./pattern";

const JANE: NameParts = { first: "Jane", last: "Okafor" };

/** A deps object where every outside call is a stub that records its use. */
function stubDeps(overrides: Partial<DiscoverDeps> = {}): DiscoverDeps {
  return {
    lookupMx: vi.fn(async () => ({ hasMx: true, provider: "google" as const, hosts: ["aspmx.l.google.com"] })),
    hasGravatar: vi.fn(async () => false),
    hunterConfigured: vi.fn(() => false),
    hunterFindEmail: vi.fn(async () => null),
    hunterDomainPattern: vi.fn(async () => null),
    hunterVerify: vi.fn(async () => null),
    getEmailPattern: vi.fn(async () => null),
    saveEmailPattern: vi.fn(async () => undefined),
    saveAddresses: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("discoverAddresses", () => {
  it("makes no HTTP calls when the domain has no MX record", async () => {
    // A domain that accepts no mail has no live address under it, so every
    // request after this point would be spent proving nothing.
    const deps = stubDeps({
      lookupMx: vi.fn(async () => ({ hasMx: false, provider: "none" as const, hosts: [] })),
      hunterConfigured: vi.fn(() => true),
    });

    const result = await discoverAddresses(
      { contactId: "c1", name: JANE, domain: "no-mail.example" },
      deps,
    );

    expect(result.hasMx).toBe(false);
    expect(result.strategy).toBe("no-mx");
    expect(result.addresses).toEqual([]);

    expect(deps.hasGravatar).not.toHaveBeenCalled();
    expect(deps.hunterFindEmail).not.toHaveBeenCalled();
    expect(deps.hunterDomainPattern).not.toHaveBeenCalled();
    expect(deps.hunterVerify).not.toHaveBeenCalled();
    expect(deps.getEmailPattern).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and see it fail.**
  `npx vitest run src/lib/contacts/discover.test.ts` — fails to resolve
  `./discover`.

- [ ] **Step 3: Create `discover.ts` with the MX short-circuit only.**
```ts
/**
 * Running the guessing pipeline over one contact.
 *
 * This and `src/lib/outreach/draft.ts` are the only modules in this feature
 * that know the order of operations. Everything they call answers a single
 * question and has no opinion about when it is asked, which is what makes all
 * of those pieces testable without a network. The sequence, the short-circuit
 * and the request budget live here, in one readable function.
 *
 * Nothing in here reaches the outside world directly: every effect arrives
 * through `DiscoverDeps`. That is not testing ceremony — it is the reason a
 * test can assert that a domain with no MX record spends no Hunter quota.
 */

import { ContactEmailStatus } from "@prisma/client";
import type { MailProvider, MxResult } from "./mx";
import type { NameParts, PatternId } from "./pattern";
import type { AddressCandidate } from "./permute";

/**
 * How many permuted candidates get a Gravatar probe.
 *
 * Gravatar coverage on corporate domains is low, so probing all ten spends
 * nine-tenths of the requests on the patterns least likely to be right. The
 * top three by prior hold most of the modelled mass, which is the part of the
 * list where a hit can still change the ordering.
 */
export const GRAVATAR_PROBE_LIMIT = 3;

/** Pause between consecutive Gravatar probes; see src/lib/ats/smartrecruiters.ts. */
export const GRAVATAR_DELAY_MS = 150;

export interface DiscoverInput {
  contactId: string;
  name: NameParts;
  domain: string;
}

export interface DiscoveredAddress {
  address: string;
  pattern: PatternId | null;
  confidence: number;
  status: ContactEmailStatus;
  gravatarHit: boolean;
  hunterVerified: boolean | null;
}

/** Why the returned list looks the way it does. Surfaced to the person. */
export type DiscoveryStrategy = "no-mx" | "learned-pattern" | "hunter" | "permuted";

export interface DiscoveryResult {
  domain: string;
  hasMx: boolean;
  provider: MailProvider;
  strategy: DiscoveryStrategy;
  hunterConsulted: boolean;
  addresses: DiscoveredAddress[];
}

/** Every outside effect the pipeline can have, in one injectable object. */
export interface DiscoverDeps {
  lookupMx(domain: string): Promise<MxResult>;
  hasGravatar(address: string): Promise<boolean>;
  hunterConfigured(): boolean;
  hunterFindEmail(domain: string, name: NameParts): Promise<string | null>;
  hunterDomainPattern(domain: string): Promise<PatternId | null>;
  hunterVerify(address: string): Promise<boolean | null>;
  getEmailPattern(domain: string): Promise<PatternId | null>;
  saveEmailPattern(domain: string, pattern: PatternId, source: "HUNTER" | "INFERRED"): Promise<void>;
  saveAddresses(contactId: string, rows: DiscoveredAddress[]): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export async function discoverAddresses(
  input: DiscoverInput,
  deps: DiscoverDeps,
): Promise<DiscoveryResult> {
  const domain = input.domain.trim().toLowerCase();

  // Step 1 — MX. Free, no terms of service, and it answers the question that
  // stops everything else: a domain with no MX record accepts no mail, so
  // every candidate address under it is dead. Nothing below this line runs.
  const mx = await deps.lookupMx(domain);
  if (!mx.hasMx) {
    return {
      domain,
      hasMx: false,
      provider: mx.provider,
      strategy: "no-mx",
      hunterConsulted: false,
      addresses: [],
    };
  }

  return {
    domain,
    hasMx: true,
    provider: mx.provider,
    strategy: "permuted",
    hunterConsulted: false,
    addresses: [],
  };
}
```

- [ ] **Step 4: Run the test and see it pass.**
  `npx vitest run src/lib/contacts/discover.test.ts`, then `npm run typecheck`.
  Commit: `Stop discovery before it spends a request on a domain that takes no mail`

- [ ] **Step 5: Write the failing test for the learned-pattern collapse.**
  Second required named test. Append to `discover.test.ts` inside the same
  `describe`:
```ts
  it("collapses the candidate list to one when a pattern is already learned", async () => {
    // This is the compounding that makes the free path viable: the first
    // confirmed address at a domain turns every later contact there from ten
    // guesses into one.
    const deps = stubDeps({
      getEmailPattern: vi.fn(async () => "first.last" as const),
    });

    const result = await discoverAddresses(
      { contactId: "c1", name: JANE, domain: "acme.com" },
      deps,
    );

    expect(result.strategy).toBe("learned-pattern");
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0].address).toBe("jane.okafor@acme.com");
    expect(result.addresses[0].pattern).toBe("first.last");
    // A known pattern is not a question for Hunter.
    expect(deps.hunterFindEmail).not.toHaveBeenCalled();
    expect(deps.hunterDomainPattern).not.toHaveBeenCalled();
    expect(deps.saveAddresses).toHaveBeenCalledWith("c1", result.addresses);
  });

  it("falls through to permutation when the learned pattern cannot be applied", async () => {
    // applyPattern returns null when the name lacks a part the pattern needs.
    // A pattern that cannot be built is not a reason to return nothing.
    const deps = stubDeps({
      getEmailPattern: vi.fn(async () => "first.last" as const),
    });

    const result = await discoverAddresses(
      { contactId: "c1", name: { first: "Jane", last: "" }, domain: "acme.com" },
      deps,
    );

    expect(result.strategy).toBe("permuted");
  });
```

- [ ] **Step 6: Run and see both new tests fail.**
  `npx vitest run src/lib/contacts/discover.test.ts` — strategy is `"permuted"`
  and the list is empty.

- [ ] **Step 7: Add scoring, the learned-pattern branch, and persistence.**
  Add the imports and helpers, then the branch, to `discover.ts`:
```ts
import { applyPattern } from "./pattern";
import { scoreAddress } from "./score";
```
```ts
/** Turn one candidate plus whatever evidence exists into a stored row. */
function toDiscovered(
  candidate: { address: string; pattern: PatternId | null; prior: number },
  evidence: {
    gravatarHit: boolean;
    hunterVerified: boolean | null;
    matchesDomainPattern: boolean;
  },
): DiscoveredAddress {
  const confidence = scoreAddress({
    // Nothing has been sent yet at discovery time, so the two ground-truth
    // signals are both false here. The watcher is what sets them later.
    replied: false,
    hardBounced: false,
    hunterVerified: evidence.hunterVerified,
    gravatarHit: evidence.gravatarHit,
    daysSinceSentClean: null,
    matchesDomainPattern: evidence.matchesDomainPattern,
    prior: candidate.prior,
  });

  return {
    address: candidate.address,
    pattern: candidate.pattern,
    confidence,
    status: statusFor(evidence),
    gravatarHit: evidence.gravatarHit,
    hunterVerified: evidence.hunterVerified,
  };
}

/**
 * The strongest state the evidence supports.
 *
 * There is deliberately no branch for "Gravatar said no" or "Hunter said no":
 * a missing avatar is absence of evidence, and only a parsed hard bounce or a
 * reply moves an address out of the guessed-or-better range.
 */
function statusFor(evidence: {
  gravatarHit: boolean;
  hunterVerified: boolean | null;
}): ContactEmailStatus {
  if (evidence.hunterVerified === true) return ContactEmailStatus.API_VERIFIED;
  if (evidence.gravatarHit) return ContactEmailStatus.GRAVATAR_HIT;
  return ContactEmailStatus.GUESSED;
}
```
  And in `discoverAddresses`, replacing the trailing `return`:
```ts
  // Step 2 — a pattern already learned for this domain. One high-confidence
  // address beats ten guesses, and it costs nothing to ask.
  const learned = await deps.getEmailPattern(domain);
  if (learned) {
    const address = applyPattern(learned, input.name, domain);
    // Null means the name lacks a part this pattern needs. That is a reason to
    // keep going, not a reason to return an empty list.
    if (address) {
      const gravatarHit = await deps.hasGravatar(address);
      const addresses = [
        toDiscovered(
          { address, pattern: learned, prior: 1 },
          { gravatarHit, hunterVerified: null, matchesDomainPattern: true },
        ),
      ];
      await deps.saveAddresses(input.contactId, addresses);
      return {
        domain,
        hasMx: true,
        provider: mx.provider,
        strategy: "learned-pattern",
        hunterConsulted: false,
        addresses,
      };
    }
  }

  return {
    domain,
    hasMx: true,
    provider: mx.provider,
    strategy: "permuted",
    hunterConsulted: false,
    addresses: [],
  };
```

- [ ] **Step 8: Run and see the learned-pattern tests pass.**
  `npx vitest run src/lib/contacts/discover.test.ts`.
  Commit: `Reuse the pattern a domain already taught us`

- [ ] **Step 9: Write the failing tests for permutation and the Gravatar budget.**
  Append to `discover.test.ts`:
```ts
  it("degrades silently to permutation when Hunter is not configured", async () => {
    // An unconfigured optional dependency is an ordinary state, the same way
    // inboxConfig() returns null for an unconfigured mailbox. It is not an
    // error and must not read like one.
    const deps = stubDeps({ hunterConfigured: vi.fn(() => false) });

    const result = await discoverAddresses(
      { contactId: "c1", name: JANE, domain: "acme.com" },
      deps,
    );

    expect(result.strategy).toBe("permuted");
    expect(result.hunterConsulted).toBe(false);
    expect(deps.hunterFindEmail).not.toHaveBeenCalled();
    expect(deps.hunterDomainPattern).not.toHaveBeenCalled();
    expect(result.addresses.length).toBeGreaterThan(1);
    expect(result.addresses.map((row) => row.address)).toContain("jane.okafor@acme.com");
    // Every row carries a real score, and the list is ordered by it.
    const scores = result.addresses.map((row) => row.confidence);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("probes only the top three permutations with Gravatar", async () => {
    const probed: string[] = [];
    const deps = stubDeps({
      hasGravatar: vi.fn(async (address: string) => {
        probed.push(address);
        return false;
      }),
    });

    await discoverAddresses({ contactId: "c1", name: JANE, domain: "acme.com" }, deps);

    expect(probed).toEqual([
      "jane.okafor@acme.com",
      "jane@acme.com",
      "jokafor@acme.com",
    ]);
    // Sequential with a pause between them, per the politeness rule.
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it("promotes a Gravatar hit above a higher-prior guess", async () => {
    const deps = stubDeps({
      hasGravatar: vi.fn(async (address: string) => address === "jokafor@acme.com"),
    });

    const result = await discoverAddresses(
      { contactId: "c1", name: JANE, domain: "acme.com" },
      deps,
    );

    expect(result.addresses[0].address).toBe("jokafor@acme.com");
    expect(result.addresses[0].status).toBe("GRAVATAR_HIT");
  });
```

- [ ] **Step 10: Run and see them fail.**
  `npx vitest run src/lib/contacts/discover.test.ts` — the permuted branch still
  returns an empty list.

- [ ] **Step 11: Implement the permutation branch with the probe budget.**
  Add `import { permuteAddresses } from "./permute";` and this helper:
```ts
/**
 * Probe the most promising candidates, one at a time with a pause.
 *
 * Sequential on purpose: ten candidates is ten requests, there is nothing to
 * gain from firing them at once, and a free service is owed that much.
 */
async function probeTopCandidates(
  candidates: AddressCandidate[],
  deps: DiscoverDeps,
): Promise<Set<string>> {
  const hits = new Set<string>();
  const probes = candidates.slice(0, GRAVATAR_PROBE_LIMIT);

  for (const [index, candidate] of probes.entries()) {
    if (index > 0) await deps.sleep(GRAVATAR_DELAY_MS);
    if (await deps.hasGravatar(candidate.address)) hits.add(candidate.address);
  }

  return hits;
}
```
  Then replace the trailing `return` in `discoverAddresses` with:
```ts
  // Step 4 — permute, probe, score. The free path, and the fallback for every
  // path above it.
  const candidates = permuteAddresses(input.name, domain);
  const hits = await probeTopCandidates(candidates, deps);

  const addresses = candidates
    .map((candidate) =>
      toDiscovered(candidate, {
        gravatarHit: hits.has(candidate.address),
        hunterVerified: null,
        matchesDomainPattern: learned !== null && candidate.pattern === learned,
      }),
    )
    .sort((a, b) => b.confidence - a.confidence);

  await deps.saveAddresses(input.contactId, addresses);

  return {
    domain,
    hasMx: true,
    provider: mx.provider,
    strategy: "permuted",
    hunterConsulted: false,
    addresses,
  };
```

- [ ] **Step 12: Run and see the permutation tests pass.**
  `npx vitest run src/lib/contacts/discover.test.ts`, then `npm run typecheck`.
  Commit: `Guess ten addresses and rank them by what is actually known`

- [ ] **Step 13: Write the failing tests for the Hunter branch.**
  Append to `discover.test.ts`:
```ts
  it("uses Hunter's known address when Hunter has one", async () => {
    const deps = stubDeps({
      hunterConfigured: vi.fn(() => true),
      hunterFindEmail: vi.fn(async () => "j.okafor@acme.com"),
      hunterVerify: vi.fn(async () => true),
    });

    const result = await discoverAddresses(
      { contactId: "c1", name: JANE, domain: "acme.com" },
      deps,
    );

    expect(result.strategy).toBe("hunter");
    expect(result.hunterConsulted).toBe(true);
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0].address).toBe("j.okafor@acme.com");
    expect(result.addresses[0].status).toBe("API_VERIFIED");
    // A verified address is not worth spending a domain-pattern call on too.
    expect(deps.hunterDomainPattern).not.toHaveBeenCalled();
  });

  it("learns and stores Hunter's domain pattern when it has no address", async () => {
    const deps = stubDeps({
      hunterConfigured: vi.fn(() => true),
      hunterFindEmail: vi.fn(async () => null),
      hunterDomainPattern: vi.fn(async () => "flast" as const),
    });

    const result = await discoverAddresses(
      { contactId: "c1", name: JANE, domain: "acme.com" },
      deps,
    );

    expect(result.strategy).toBe("hunter");
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0].address).toBe("jokafor@acme.com");
    // Persisted, so the next contact at this domain never asks Hunter again.
    expect(deps.saveEmailPattern).toHaveBeenCalledWith("acme.com", "flast", "HUNTER");
  });

  it("continues on the free signals when Hunter fails", async () => {
    // A 429 means the quota is gone, not that discovery failed. Design §11.
    const deps = stubDeps({
      hunterConfigured: vi.fn(() => true),
      hunterFindEmail: vi.fn(async () => {
        throw new Error("429 Too Many Requests");
      }),
      hunterDomainPattern: vi.fn(async () => {
        throw new Error("429 Too Many Requests");
      }),
    });

    const result = await discoverAddresses(
      { contactId: "c1", name: JANE, domain: "acme.com" },
      deps,
    );

    expect(result.strategy).toBe("permuted");
    expect(result.hunterConsulted).toBe(true);
    expect(result.addresses.length).toBeGreaterThan(1);
  });
```

- [ ] **Step 14: Run and see them fail.**
  `npx vitest run src/lib/contacts/discover.test.ts` — the third test passes
  already by accident; the first two do not.

- [ ] **Step 15: Implement the Hunter branch.**
  Add this helper to `discover.ts`:
```ts
/**
 * Ask Hunter something, and treat every failure as "no answer".
 *
 * A 429 means the free tier is spent and a 401 means the key is wrong. Neither
 * is a reason to fail a discovery that has a perfectly good free path below
 * it, so the exception stops here and the pipeline carries on.
 */
async function askHunter<T>(ask: () => Promise<T | null>): Promise<T | null> {
  try {
    return await ask();
  } catch {
    return null;
  }
}
```
  And insert this between the learned-pattern branch and the permutation branch:
```ts
  // Step 3 — Hunter, when a key is configured. Never spend a call on a
  // question already answered: the learned-pattern branch above returns before
  // this runs, and the domain-pattern call is skipped when an address is found.
  let hunterConsulted = false;
  if (deps.hunterConfigured()) {
    hunterConsulted = true;

    const found = await askHunter(() => deps.hunterFindEmail(domain, input.name));
    if (found) {
      const verified = await askHunter(() => deps.hunterVerify(found));
      const addresses = [
        toDiscovered(
          { address: found, pattern: null, prior: 1 },
          { gravatarHit: false, hunterVerified: verified, matchesDomainPattern: false },
        ),
      ];
      await deps.saveAddresses(input.contactId, addresses);
      return { domain, hasMx: true, provider: mx.provider, strategy: "hunter", hunterConsulted, addresses };
    }

    const pattern = await askHunter(() => deps.hunterDomainPattern(domain));
    const address = pattern ? applyPattern(pattern, input.name, domain) : null;
    if (pattern && address) {
      // Persist it: this is the last time this domain costs a Hunter call.
      await deps.saveEmailPattern(domain, pattern, "HUNTER");
      const gravatarHit = await deps.hasGravatar(address);
      const addresses = [
        toDiscovered(
          { address, pattern, prior: 1 },
          { gravatarHit, hunterVerified: null, matchesDomainPattern: true },
        ),
      ];
      await deps.saveAddresses(input.contactId, addresses);
      return { domain, hasMx: true, provider: mx.provider, strategy: "hunter", hunterConsulted, addresses };
    }
  }
```
  Then change the permuted branch's return to use `hunterConsulted` instead of
  the literal `false`.

- [ ] **Step 16: Run and see every Hunter test pass.**
  `npx vitest run src/lib/contacts/discover.test.ts`, then `npm run typecheck`.
  Commit: `Spend a Hunter call only on a question nothing else can answer`

- [ ] **Step 17: Add `liveDeps` and wire the real modules.**
  This is the only place in the feature that imports the I/O modules together.
```ts
import type { PrismaClient } from "@prisma/client";
import { hasGravatar } from "./gravatar";
import {
  hunterConfigured,
  hunterDomainPattern,
  hunterFindEmail,
  hunterVerify,
} from "./hunter";
import { lookupMx } from "./mx";
import { getEmailPattern, saveDiscoveredAddresses, upsertEmailPattern } from "./store";
```
```ts
/**
 * The real dependencies, for the server action that runs a discovery.
 *
 * Kept separate from `discoverAddresses` so that importing the pipeline in a
 * test does not drag in a DNS resolver, an HTTP client and Prisma.
 */
export function liveDeps(db: PrismaClient): DiscoverDeps {
  return {
    lookupMx,
    hasGravatar,
    hunterConfigured: () => hunterConfigured(),
    hunterFindEmail,
    hunterDomainPattern,
    hunterVerify,
    getEmailPattern: (domain) => getEmailPattern(db, domain),
    saveEmailPattern: (domain, pattern, source) =>
      upsertEmailPattern(db, { domain, pattern, source }),
    saveAddresses: (contactId, rows) => saveDiscoveredAddresses(db, contactId, rows),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
```

- [ ] **Step 18: Verify the whole suite and commit.**
  `npm test` and `npm run typecheck`, both clean.
  Commit: `Wire the discovery pipeline to its real sources`

---

### Task 13: Draft generation (`src/lib/outreach/draft.ts`)

**The AI writes prose. Rules supply every fact.** This module is the second of
the two that know an order of operations, and the order is: build the fact
block from stored rows, render it, hand the model nothing else, take back
prose. Nothing the model returns is parsed into a fact.

**Files:**
- Create: `src/lib/outreach/draft.ts`
- Modify: none — `src/lib/ai/index.ts` and `src/lib/ai/types.ts` are imported, not changed.
- Test: `src/lib/outreach/draft.test.ts`

**Interfaces:**

- Consumes:
  - `getProvider(db: PrismaClient): Promise<AiProvider | null>` (`src/lib/ai/index.ts:67`)
  - `AiUnavailableError` (`src/lib/ai/types.ts`)
  - `AiProvider`, `CompletionRequest`, `CompletionResult` (`src/lib/ai/types.ts`) — types only
  - Prisma row types `Candidate`, `TruthFact`, `Job` from `@prisma/client` — types only
- Produces:
```ts
export const MAX_EXPERIENCE_FACTS = 8;
export const DRAFT_SYSTEM_PROMPT: string;

/** Everything the draft is allowed to assert, and nothing else. */
export interface FactBlock {
  candidateName: string;
  school: string | null;
  degree: string | null;
  graduationDate: string | null;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  jobTitle: string | null;
  /** TruthFact.statement strings, verbatim. Never WorkExperience prose. */
  experienceFacts: string[];
}

export interface DraftInput {
  candidate: Pick<Candidate, "name" | "school" | "degree" | "graduationDate">;
  /** TruthFact rows. The ONLY source of a claim about experience. */
  truthFacts: Pick<TruthFact, "category" | "statement">[];
  contact: { firstName: string; lastName: string; title: string | null };
  /** The linked posting, when there is one. Introducing yourself first is fine. */
  job: (Pick<Job, "title"> & { companyName: string }) | null;
}

export interface DraftContent {
  subject: string;
  body: string;
  source: "ai" | "template";
  /** Set when AI was configured but could not run. Shown, never swallowed. */
  fallbackReason?: string;
}

export function buildFactBlock(input: DraftInput): FactBlock;
export function renderFactBlock(facts: FactBlock): string;
export function subjectFor(facts: FactBlock): string;
export function templateDraft(facts: FactBlock): DraftContent;
export function buildPrompt(facts: FactBlock): string;
export async function buildDraft(input: DraftInput, provider: AiProvider | null): Promise<DraftContent>;
export async function draftForContact(db: PrismaClient, input: DraftInput): Promise<DraftContent>;
```

`buildDraft` takes the provider rather than the database so that every test but
one runs with no Prisma client at all; `draftForContact` is the four-line seam
that calls `getProvider(db)` and owns the `AiUnavailableError` decision.

**Judgment call — the subject line is never written by the model.** The spec
says the model writes prose and rules supply facts. A subject is one line, it
is almost entirely facts, and it is the single most visible place a fabricated
claim would land. `subjectFor` builds it from the block with a documented rule
and is unit-tested; the model is asked only for the body.

- [ ] **Step 1: Write the failing test for the fact block.**
  Create `src/lib/outreach/draft.test.ts`:
```ts
/**
 * Tests for outreach draft generation.
 *
 * The rule this file exists to enforce is the Truth Ledger guarantee: the AI
 * writes prose and rules supply every fact. The failure mode here is a fluent,
 * confident, false claim about the candidate sent to somebody who could hire
 * him, and unlike a form field nobody validates it on the way out. So the
 * tests assert on what goes INTO the model as hard as on what comes out, and
 * the whole feature is required to work with no model at all.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildDraft,
  buildFactBlock,
  buildPrompt,
  renderFactBlock,
  subjectFor,
  templateDraft,
  type DraftInput,
} from "./draft";
import type { AiProvider } from "../ai/types";

const INPUT: DraftInput = {
  candidate: {
    name: "Ada Okafor",
    school: "Rutgers University",
    degree: "BS Computer Science",
    graduationDate: new Date("2027-05-15T00:00:00Z"),
  },
  truthFacts: [
    { category: "EXPERIENCE", statement: "Uniqlo — Seasonal Sales Associate — inventory and restocking" },
    { category: "PROJECT", statement: "Built a Postgres-backed scheduling tool in TypeScript" },
  ],
  contact: { firstName: "Jane", lastName: "Reed", title: "University Recruiter" },
  job: { title: "Software Engineering Intern", companyName: "Acme" },
};

describe("buildFactBlock", () => {
  it("draws every claim from stored rows", () => {
    const facts = buildFactBlock(INPUT);

    expect(facts).toEqual({
      candidateName: "Ada Okafor",
      school: "Rutgers University",
      degree: "BS Computer Science",
      graduationDate: "May 2027",
      contactName: "Jane Reed",
      contactTitle: "University Recruiter",
      companyName: "Acme",
      jobTitle: "Software Engineering Intern",
      experienceFacts: [
        "Uniqlo — Seasonal Sales Associate — inventory and restocking",
        "Built a Postgres-backed scheduling tool in TypeScript",
      ],
    });
  });

  it("leaves a missing field null rather than inventing one", () => {
    const facts = buildFactBlock({
      ...INPUT,
      candidate: { name: "Ada Okafor", school: null, degree: null, graduationDate: null },
      job: null,
      truthFacts: [],
    });

    expect(facts.school).toBeNull();
    expect(facts.degree).toBeNull();
    expect(facts.graduationDate).toBeNull();
    expect(facts.jobTitle).toBeNull();
    expect(facts.companyName).toBeNull();
    expect(facts.experienceFacts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and see it fail.**
  `npx vitest run src/lib/outreach/draft.test.ts` — cannot resolve `./draft`.

- [ ] **Step 3: Create `draft.ts` with the fact block only.**
```ts
/**
 * Writing an introduction to a person at a company.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE AI WRITES PROSE. RULES SUPPLY EVERY FACT.
 *
 * This is the Truth Ledger guarantee the repository already enforces
 * (TruthFactCategory, prisma/schema.prisma:97-104), and it matters more here
 * than anywhere else in the app. The failure mode is a fluent, confident,
 * false claim about the candidate, sent to somebody who could hire him — and
 * unlike a form field, nobody validates it on the way out.
 *
 * So the fact block below is assembled from stored rows only:
 *
 *   - name, school, degree, graduation date   -> Candidate
 *   - the posting title and the company       -> Job, when one is linked
 *   - any claim about experience              -> TruthFact rows, EXCLUSIVELY
 *
 * WorkExperience.description is candidate-written prose and is deliberately
 * not read here; TruthFact is the verifiable version of the same experience
 * and is the only thing the model is allowed to draw a claim from.
 *
 * Nothing the model returns is parsed back into a fact. The output is prose,
 * and a human reads it before it goes anywhere.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Candidate, Job, TruthFact } from "@prisma/client";

/**
 * How many experience facts go into one introduction.
 *
 * This is a short email, not a resume. Eight is already more than an
 * introduction can carry, and a longer list mostly invites padding.
 */
export const MAX_EXPERIENCE_FACTS = 8;

/** Everything the draft is allowed to assert, and nothing else. */
export interface FactBlock {
  candidateName: string;
  school: string | null;
  degree: string | null;
  /** Rendered as "May 2027". A date the candidate stated, never estimated. */
  graduationDate: string | null;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  jobTitle: string | null;
  /** TruthFact.statement strings, verbatim. */
  experienceFacts: string[];
}

export interface DraftInput {
  candidate: Pick<Candidate, "name" | "school" | "degree" | "graduationDate">;
  /** The only source of a claim about experience. */
  truthFacts: Pick<TruthFact, "category" | "statement">[];
  contact: { firstName: string; lastName: string; title: string | null };
  job: (Pick<Job, "title"> & { companyName: string }) | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "May 2027", in UTC so the month does not shift with the reader's zone. */
function formatGraduation(date: Date | null): string | null {
  if (!date) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Assemble the fact block from stored rows. Pure, and the whole guarantee. */
export function buildFactBlock(input: DraftInput): FactBlock {
  return {
    candidateName: input.candidate.name.trim(),
    school: blankToNull(input.candidate.school),
    degree: blankToNull(input.candidate.degree),
    graduationDate: formatGraduation(input.candidate.graduationDate),
    contactName: `${input.contact.firstName} ${input.contact.lastName}`.trim(),
    contactTitle: blankToNull(input.contact.title),
    companyName: input.job ? input.job.companyName.trim() : null,
    jobTitle: input.job ? input.job.title.trim() : null,
    experienceFacts: input.truthFacts
      .map((fact) => fact.statement.trim())
      .filter((statement) => statement.length > 0)
      .slice(0, MAX_EXPERIENCE_FACTS),
  };
}
```

- [ ] **Step 4: Run the test and see it pass.**
  `npx vitest run src/lib/outreach/draft.test.ts`, then `npm run typecheck`.
  Commit: `Assemble what an introduction is allowed to claim`

- [ ] **Step 5: Write the failing test for the subject and the template draft.**
  Append to `draft.test.ts`:
```ts
describe("subjectFor", () => {
  it("names the posting when one is linked", () => {
    expect(subjectFor(buildFactBlock(INPUT))).toBe(
      "Software Engineering Intern — Ada Okafor, Rutgers University",
    );
  });

  it("introduces the person when no posting is linked", () => {
    const facts = buildFactBlock({ ...INPUT, job: null });
    expect(subjectFor(facts)).toBe("Introduction — Ada Okafor, Rutgers University");
  });

  it("drops the school rather than leaving a dangling comma", () => {
    const facts = buildFactBlock({
      ...INPUT,
      job: null,
      candidate: { name: "Ada Okafor", school: null, degree: null, graduationDate: null },
    });
    expect(subjectFor(facts)).toBe("Introduction — Ada Okafor");
  });
});

describe("templateDraft", () => {
  it("produces a complete email with no model involved", () => {
    const draft = templateDraft(buildFactBlock(INPUT));

    expect(draft.source).toBe("template");
    expect(draft.subject).toBe("Software Engineering Intern — Ada Okafor, Rutgers University");
    expect(draft.body).toContain("Hi Jane,");
    expect(draft.body).toContain("Software Engineering Intern");
    expect(draft.body).toContain("Rutgers University");
    expect(draft.body).toContain("Uniqlo — Seasonal Sales Associate — inventory and restocking");
    expect(draft.body).toContain("Ada Okafor");
    // No unfilled slots ever reach a recruiter.
    expect(draft.body).not.toMatch(/\{\{|\bundefined\b|\bnull\b/);
  });

  it("reads correctly with nothing but a name", () => {
    const draft = templateDraft(
      buildFactBlock({
        candidate: { name: "Ada Okafor", school: null, degree: null, graduationDate: null },
        truthFacts: [],
        contact: { firstName: "Jane", lastName: "Reed", title: null },
        job: null,
      }),
    );

    expect(draft.body).toContain("Hi Jane,");
    expect(draft.body).not.toMatch(/\{\{|\bundefined\b|\bnull\b/);
    expect(draft.body.trim().length).toBeGreaterThan(80);
  });
});
```

- [ ] **Step 6: Run and see them fail.**
  `npx vitest run src/lib/outreach/draft.test.ts`.

- [ ] **Step 7: Implement `subjectFor` and `templateDraft`.**
```ts
export interface DraftContent {
  subject: string;
  body: string;
  source: "ai" | "template";
  /** Set when AI was configured but could not run. Surfaced, never swallowed. */
  fallbackReason?: string;
}

/**
 * The subject line, built from the block by rule.
 *
 * Deliberately never written by the model. It is one line, it is almost
 * entirely facts, and it is the most visible place an invented claim could
 * land. The model is asked for the body and nothing else.
 */
export function subjectFor(facts: FactBlock): string {
  const lead = facts.jobTitle ?? "Introduction";
  const who = facts.school
    ? `${facts.candidateName}, ${facts.school}`
    : facts.candidateName;
  return `${lead} — ${who}`;
}

/**
 * The email, written by rule with no model at all.
 *
 * This is not a degraded mode to apologise for. A template introduction is
 * worse writing than a generated one and is still a perfectly good email; the
 * feature does not require an AI provider to function, and this is the path
 * that guarantees it.
 */
export function templateDraft(facts: FactBlock): DraftContent {
  const greetingName = facts.contactName.split(" ")[0] || facts.contactName;
  const lines: string[] = [`Hi ${greetingName},`, ""];

  const study = [facts.degree, facts.school ? `at ${facts.school}` : null]
    .filter((part): part is string => part !== null)
    .join(" ");
  const graduating = facts.graduationDate ? `, graduating ${facts.graduationDate}` : "";

  if (facts.jobTitle && facts.companyName) {
    lines.push(
      `My name is ${facts.candidateName} and I am applying for the ${facts.jobTitle} role at ${facts.companyName}.`,
    );
  } else if (facts.companyName) {
    lines.push(
      `My name is ${facts.candidateName} and I am interested in internship openings at ${facts.companyName}.`,
    );
  } else {
    lines.push(`My name is ${facts.candidateName} and I am looking for an internship this year.`);
  }

  if (study) lines.push(`I am studying ${study}${graduating}.`);
  else if (facts.graduationDate) lines.push(`I graduate in ${facts.graduationDate}.`);

  if (facts.experienceFacts.length > 0) {
    lines.push("", "A little about what I have done:");
    for (const fact of facts.experienceFacts) lines.push(`- ${fact}`);
  }

  lines.push(
    "",
    "If you have a few minutes, I would appreciate the chance to introduce myself properly.",
    "",
    "Thank you for your time,",
    facts.candidateName,
  );

  return { subject: subjectFor(facts), body: lines.join("\n"), source: "template" };
}
```

- [ ] **Step 8: Run and see the template tests pass.**
  `npx vitest run src/lib/outreach/draft.test.ts`, then `npm run typecheck`.
  Commit: `Write a usable introduction with no model at all`

- [ ] **Step 9: Write the failing test that the prompt carries nothing but the fact block.**
  This is the guard against fabrication, so it asserts on the exact string.
  Append to `draft.test.ts`:
```ts
describe("buildPrompt", () => {
  it("contains only facts drawn from the fact block", () => {
    const facts = buildFactBlock(INPUT);
    const prompt = buildPrompt(facts);

    // The prompt is the rendered block and nothing else. Asserted by equality
    // rather than by `toContain`, because the thing being guarded against is
    // something EXTRA reaching the model, which toContain cannot see.
    expect(prompt).toBe(`Write the body of this email using only the facts below.

${renderFactBlock(facts)}`);
  });

  it("never carries WorkExperience prose the caller did not put in the block", () => {
    // WorkExperience.description is candidate-written free text and is the one
    // source the model must never see. DraftInput has no field for it, and
    // this test is the standing check that nobody adds one.
    const withDecoy = {
      ...INPUT,
      candidate: { ...INPUT.candidate },
      // A field shaped like the one that must never be read.
      ...({ workExperiences: [{ description: "Led a team of forty engineers" }] } as object),
    } as DraftInput;

    expect(buildPrompt(buildFactBlock(withDecoy))).not.toContain("forty engineers");
  });

  it("omits an unknown field entirely instead of saying it is unknown", () => {
    const facts = buildFactBlock({
      ...INPUT,
      job: null,
      candidate: { name: "Ada Okafor", school: null, degree: null, graduationDate: null },
    });
    const prompt = buildPrompt(facts);

    expect(prompt).not.toMatch(/null|unknown|N\/A/i);
    expect(prompt).toContain("Candidate name: Ada Okafor");
    expect(prompt).not.toContain("School:");
  });
});
```

- [ ] **Step 10: Run and see them fail.**
  `npx vitest run src/lib/outreach/draft.test.ts`.

- [ ] **Step 11: Implement `renderFactBlock`, `DRAFT_SYSTEM_PROMPT` and `buildPrompt`.**
```ts
/**
 * The fact block as text.
 *
 * An absent fact is omitted rather than written as "unknown". A line saying
 * "School: unknown" is an invitation to fill the gap, and filling a gap is
 * exactly what must not happen.
 */
export function renderFactBlock(facts: FactBlock): string {
  const lines: string[] = [`Candidate name: ${facts.candidateName}`];

  if (facts.school) lines.push(`School: ${facts.school}`);
  if (facts.degree) lines.push(`Degree: ${facts.degree}`);
  if (facts.graduationDate) lines.push(`Graduates: ${facts.graduationDate}`);

  lines.push(`Writing to: ${facts.contactName}`);
  if (facts.contactTitle) lines.push(`Their title: ${facts.contactTitle}`);
  if (facts.companyName) lines.push(`Their company: ${facts.companyName}`);
  if (facts.jobTitle) lines.push(`The role: ${facts.jobTitle}`);

  if (facts.experienceFacts.length > 0) {
    lines.push("Verified facts about the candidate:");
    for (const fact of facts.experienceFacts) lines.push(`- ${fact}`);
  }

  return lines.join("\n");
}

export const DRAFT_SYSTEM_PROMPT = `You write short, plain introduction emails from one student to one person at a company.

You are given a list of facts. Write the body of the email using only those facts.

Rules you must follow:
- Never state anything that is not in the facts you were given. Do not infer a skill from a job title, do not add a number, do not name a technology that is not listed.
- If a fact is not given, write the email without it. Do not say that it is unknown and do not leave a blank to fill in.
- Four short paragraphs at most. No bullet lists, no subject line, no signature block.
- Plain text. No markdown, no headings, no links.
- Write in the first person as the candidate, addressed to the person named.
- Return the email body and nothing else.`;

/** The user half of the request: the block, and an instruction to use only it. */
export function buildPrompt(facts: FactBlock): string {
  return `Write the body of this email using only the facts below.

${renderFactBlock(facts)}`;
}
```

- [ ] **Step 12: Run and see the prompt tests pass.**
  `npx vitest run src/lib/outreach/draft.test.ts`, then `npm run typecheck`.
  Commit: `Send the model facts and nothing but facts`

- [ ] **Step 13: Write the failing tests for `buildDraft` with and without a provider.**
  Append to `draft.test.ts`:
```ts
function fakeProvider(text: string): AiProvider {
  return {
    kind: "local",
    label: "stub",
    model: "stub-model",
    complete: vi.fn(async () => ({ text, model: "stub-model", latencyMs: 1 })),
  };
}

describe("buildDraft", () => {
  it("falls back to the template when no provider is configured", async () => {
    // getProvider returns null when AI features are off, and off is an
    // ordinary state. The feature works fully with no model.
    const draft = await buildDraft(INPUT, null);

    expect(draft.source).toBe("template");
    expect(draft).toEqual(templateDraft(buildFactBlock(INPUT)));
  });

  it("uses the model's prose for the body and the rule for the subject", async () => {
    const provider = fakeProvider("Hi Jane,\n\nI am applying for the intern role.\n\nAda");
    const draft = await buildDraft(INPUT, provider);

    expect(draft.source).toBe("ai");
    expect(draft.body).toBe("Hi Jane,\n\nI am applying for the intern role.\n\nAda");
    expect(draft.subject).toBe(subjectFor(buildFactBlock(INPUT)));
    expect(provider.complete).toHaveBeenCalledWith({
      system: expect.stringContaining("Never state anything that is not in the facts"),
      prompt: buildPrompt(buildFactBlock(INPUT)),
      maxTokens: 700,
    });
  });

  it("falls back to the template when the model returns nothing usable", async () => {
    const draft = await buildDraft(INPUT, fakeProvider("   "));

    expect(draft.source).toBe("template");
    expect(draft.fallbackReason).toBe("The model returned an empty answer.");
  });

  it("falls back to the template when the model call fails, and says why", async () => {
    const provider: AiProvider = {
      kind: "local",
      label: "stub",
      model: "stub-model",
      complete: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      }),
    };

    const draft = await buildDraft(INPUT, provider);

    expect(draft.source).toBe("template");
    expect(draft.body).toBe(templateDraft(buildFactBlock(INPUT)).body);
    expect(draft.fallbackReason).toContain("ECONNREFUSED");
  });
});
```

- [ ] **Step 14: Run and see them fail.**
  `npx vitest run src/lib/outreach/draft.test.ts`.

- [ ] **Step 15: Implement `buildDraft`.**
```ts
import type { AiProvider } from "../ai/types";
```
```ts
/**
 * Roughly the length of a good introduction, with room to spare.
 *
 * Four short paragraphs is around 250 tokens; 700 leaves headroom without
 * paying for an essay nobody will send.
 */
const DRAFT_MAX_TOKENS = 700;

/**
 * Build the draft: prose from the model when there is one, template when not.
 *
 * Takes the provider rather than the database so a test can exercise every
 * path with no Prisma client. `draftForContact` below is the seam that reads
 * the setting.
 */
export async function buildDraft(
  input: DraftInput,
  provider: AiProvider | null,
): Promise<DraftContent> {
  const facts = buildFactBlock(input);
  const template = templateDraft(facts);

  // Null means AI features are switched off. Ordinary state, template email.
  if (!provider) return template;

  let text: string;
  try {
    const result = await provider.complete({
      system: DRAFT_SYSTEM_PROMPT,
      prompt: buildPrompt(facts),
      maxTokens: DRAFT_MAX_TOKENS,
    });
    text = result.text.trim();
  } catch (error) {
    // A model that is configured but unreachable must not cost the person the
    // feature — but it must not disappear either, or he will wonder for weeks
    // why his drafts read like a form letter.
    const detail = error instanceof Error ? error.message : String(error);
    return { ...template, fallbackReason: `The model could not be reached: ${detail}` };
  }

  if (text.length === 0) {
    return { ...template, fallbackReason: "The model returned an empty answer." };
  }

  // The subject stays rule-built. Only the body is the model's.
  return { subject: subjectFor(facts), body: text, source: "ai" };
}
```

- [ ] **Step 16: Run and see the provider tests pass.**
  `npx vitest run src/lib/outreach/draft.test.ts`, then `npm run typecheck`.
  Commit: `Let the model write the prose and keep the facts out of its hands`

- [ ] **Step 17: Add `draftForContact`, the database seam.**
```ts
import type { PrismaClient } from "@prisma/client";
import { getProvider } from "../ai/index";
import { AiUnavailableError } from "../ai/types";
```
```ts
/**
 * The entry point a server action calls.
 *
 * `getProvider` throws AiUnavailableError when a provider IS configured but
 * cannot be built — a missing key, a blank model. For drafting that is still
 * not a reason to refuse: the template path exists precisely so this feature
 * has no hard dependency on a model. The reason travels with the draft so the
 * settings mistake is visible rather than silently absorbed.
 */
export async function draftForContact(
  db: PrismaClient,
  input: DraftInput,
): Promise<DraftContent> {
  try {
    return await buildDraft(input, await getProvider(db));
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return { ...templateDraft(buildFactBlock(input)), fallbackReason: error.message };
    }
    throw error;
  }
}
```

- [ ] **Step 18: Write and run the test for the unavailable-provider seam.**
  Append to `draft.test.ts`:
```ts
describe("draftForContact", () => {
  it("still produces a draft when the configured provider cannot be built", async () => {
    // A LOCAL provider with no model selected. Configured, but broken.
    const db = {
      aiSettings: {
        findUnique: vi.fn(async () => ({ provider: "LOCAL", baseUrl: null, model: null })),
      },
    } as unknown as Parameters<typeof draftForContact>[0];

    const draft = await draftForContact(db, INPUT);

    expect(draft.source).toBe("template");
    expect(draft.fallbackReason).toContain("No local model is selected");
  });
});
```
  Add `draftForContact` to the import at the top of the test file. Run
  `npx vitest run src/lib/outreach/draft.test.ts`, then `npm test` and
  `npm run typecheck`.
  Commit: `Keep drafting when the AI settings are half-finished`

---

### Task 14: IMAP draft delivery (`src/lib/outreach/deliver.ts`)

**Files:**
- Create: `src/lib/outreach/deliver.ts`
- Modify: none — `InboxConfig` is imported from `src/lib/email/inbox.ts:35`, not redeclared.
- Test: `src/lib/outreach/deliver.test.ts`

**Interfaces:**

- Consumes:
  - `InboxConfig` from `src/lib/email/inbox.ts` (type import only)
  - `composeMime(message: { from, to, subject, body, date }): string` (Task 5) — the caller's job; `deliver.ts` takes the MIME string it produced
  - `ImapFlow` from `imapflow@2.0.2`. **Verified:** it exposes `append()`, and `list()` results carry `specialUse`.
- Produces (verbatim from design §7, plus one seam):
```ts
export type DeliveryResult = { ok: true; folder: string } | { ok: false; reason: string };
export const DRAFTS_FOLDER_CANDIDATES: readonly string[];
export type ImapConnect = (config: InboxConfig) => Promise<ImapFlow>;
export async function findDraftsFolder(client: ImapFlow): Promise<string | null>;
export async function appendDraft(config: InboxConfig, mime: string, connect?: ImapConnect): Promise<DeliveryResult>;
```

**Judgment call — the third parameter.** The spec fixes `appendDraft(config,
mime)`. A live IMAP server is not available in CI and the repo's convention for
network tests is to substitute the transport (`globalThis.fetch = vi.fn()` in
`src/lib/ats/greenhouse.test.ts:25`), which has no equivalent for `imapflow`.
`connect` is an optional third parameter with a real default, so every caller
still writes `appendDraft(config, mime)` and the spec's signature is satisfied
exactly; only the tests pass a third argument.

**Errors never throw.** Every failure path returns `{ ok: false, reason }`,
because the copy fallback in `/contacts` must always be reachable — a thrown
exception here would take out the only remaining way to use the feature.

- [ ] **Step 1: Write the failing test for `findDraftsFolder` against recorded LIST responses.**
  Create `src/lib/outreach/deliver.test.ts`:
```ts
/**
 * Tests for writing a draft into the candidate's mailbox.
 *
 * No test here touches a live server: the ImapFlow client is stubbed, because
 * the interesting logic is entirely in deciding WHERE a draft goes and what
 * happens when that cannot be decided. The name of the drafts folder varies by
 * provider, and guessing "Drafts" puts a message somewhere the person will
 * never look.
 *
 * Every failure returns { ok: false } rather than throwing, and that is load-
 * bearing: the copy-to-clipboard fallback is the only remaining path when
 * this one fails, and an exception would take it out too.
 */

import { describe, expect, it, vi } from "vitest";
import type { ImapFlow } from "imapflow";
import { appendDraft, findDraftsFolder } from "./deliver";
import type { InboxConfig } from "../email/inbox";

const CONFIG: InboxConfig = {
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  user: "me@example.com",
  password: "app-password",
};

/** A client stub exposing only what these functions touch. */
function stubClient(options: {
  list?: Array<{ path: string; specialUse?: string }>;
  append?: () => Promise<unknown>;
}): ImapFlow & { logout: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn(async () => options.list ?? []),
    append: vi.fn(options.append ?? (async () => ({ uid: 1 }))),
    logout: vi.fn(async () => undefined),
  } as unknown as ImapFlow & { logout: ReturnType<typeof vi.fn> };
}

describe("findDraftsFolder", () => {
  it("finds Gmail's drafts folder by its special-use flag", async () => {
    const client = stubClient({
      list: [
        { path: "INBOX" },
        { path: "[Gmail]/All Mail", specialUse: "\\All" },
        { path: "[Gmail]/Drafts", specialUse: "\\Drafts" },
        { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" },
      ],
    });

    expect(await findDraftsFolder(client)).toBe("[Gmail]/Drafts");
  });

  it("finds Outlook's drafts folder by its special-use flag", async () => {
    const client = stubClient({
      list: [
        { path: "Inbox", specialUse: "\\Inbox" },
        { path: "Drafts", specialUse: "\\Drafts" },
        { path: "Sent Items", specialUse: "\\Sent" },
      ],
    });

    expect(await findDraftsFolder(client)).toBe("Drafts");
  });

  it("falls back to a known name on a server that reports no special use", async () => {
    // Plenty of generic IMAP servers answer LIST with nothing but paths.
    const client = stubClient({
      list: [{ path: "INBOX" }, { path: "INBOX.Drafts" }, { path: "INBOX.Sent" }],
    });

    expect(await findDraftsFolder(client)).toBe("INBOX.Drafts");
  });

  it("returns null when no drafts folder can be identified", async () => {
    // Null is the signal to use the copy fallback, not an error.
    const client = stubClient({ list: [{ path: "INBOX" }, { path: "Archive" }] });

    expect(await findDraftsFolder(client)).toBeNull();
  });

  it("returns null rather than throwing when LIST itself fails", async () => {
    const client = {
      list: vi.fn(async () => {
        throw new Error("NO LIST failed");
      }),
    } as unknown as ImapFlow;

    expect(await findDraftsFolder(client)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and see it fail.**
  `npx vitest run src/lib/outreach/deliver.test.ts` — cannot resolve `./deliver`.

- [ ] **Step 3: Create `deliver.ts` with `findDraftsFolder`.**
```ts
/**
 * Putting a finished draft where the candidate's mail client will show it.
 *
 * This app never sends. What it does instead is write a real draft into the
 * Drafts folder over the IMAP connection it already holds: he opens his mail
 * client and the message is waiting, addressed and written, for him to read
 * and send himself. No new secret, no new protocol, no SMTP.
 *
 * Two rules shape this file:
 *
 *   1. The drafts folder is found by its \Drafts special-use flag, never by
 *      name. The name varies — "[Gmail]/Drafts", "Drafts", "INBOX.Drafts" —
 *      and a draft appended to a guessed folder is a draft in a place nobody
 *      looks.
 *   2. Nothing here throws. Every failure returns { ok: false, reason }, so
 *      the copy-to-clipboard fallback on /contacts is always reachable. That
 *      path also has to exist regardless: a candidate with no mailbox
 *      configured must still be able to use the feature.
 */

import type { ImapFlow } from "imapflow";
import type { InboxConfig } from "../email/inbox";

export type DeliveryResult = { ok: true; folder: string } | { ok: false; reason: string };

/**
 * Names to try when the server reports no special-use flags at all.
 *
 * Ordered most to least specific so a Gmail server that somehow omitted its
 * flag is still matched before a bare "Drafts" that might be a user folder.
 */
export const DRAFTS_FOLDER_CANDIDATES = [
  "[Gmail]/Drafts",
  "Drafts",
  "INBOX.Drafts",
] as const;

/** Locate the drafts mailbox by \Drafts special-use, falling back to name. */
export async function findDraftsFolder(client: ImapFlow): Promise<string | null> {
  let mailboxes: Array<{ path: string; specialUse?: string }>;
  try {
    mailboxes = await client.list();
  } catch {
    // A server that will not list its folders cannot tell us where drafts go.
    // Null sends the caller to the copy fallback, which is the right answer.
    return null;
  }

  const flagged = mailboxes.find((box) => box.specialUse === "\\Drafts");
  if (flagged) return flagged.path;

  for (const candidate of DRAFTS_FOLDER_CANDIDATES) {
    const match = mailboxes.find(
      (box) => box.path.toLowerCase() === candidate.toLowerCase(),
    );
    if (match) return match.path;
  }

  return null;
}
```

- [ ] **Step 4: Run the test and see it pass.**
  `npx vitest run src/lib/outreach/deliver.test.ts`, then `npm run typecheck`.
  Commit: `Find the drafts folder by what the server says it is`

- [ ] **Step 5: Write the failing tests for `appendDraft`.**
  Append to `deliver.test.ts`:
```ts
const MIME = ["From: me@example.com", "To: jane@acme.com", "Subject: Hello", "", "Hi Jane,"].join("\r\n");

describe("appendDraft", () => {
  it("appends the message to the discovered folder and logs out", async () => {
    const client = stubClient({
      list: [{ path: "[Gmail]/Drafts", specialUse: "\\Drafts" }],
    });

    const result = await appendDraft(CONFIG, MIME, async () => client);

    expect(result).toEqual({ ok: true, folder: "[Gmail]/Drafts" });
    expect(client.append).toHaveBeenCalledWith("[Gmail]/Drafts", MIME, ["\\Draft", "\\Seen"]);
    expect(client.logout).toHaveBeenCalledTimes(1);
  });

  it("reports failure instead of throwing when the connection cannot be made", async () => {
    const result = await appendDraft(CONFIG, MIME, async () => {
      throw new Error("getaddrinfo ENOTFOUND imap.gmail.com");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ENOTFOUND");
  });

  it("reports failure when no drafts folder exists", async () => {
    const client = stubClient({ list: [{ path: "INBOX" }] });

    const result = await appendDraft(CONFIG, MIME, async () => client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("drafts folder");
    // Still hung up cleanly.
    expect(client.logout).toHaveBeenCalledTimes(1);
  });

  it("reports failure when the append itself is rejected", async () => {
    const client = stubClient({
      list: [{ path: "Drafts", specialUse: "\\Drafts" }],
      append: async () => {
        throw new Error("NO [OVERQUOTA] Mailbox is full");
      },
    });

    const result = await appendDraft(CONFIG, MIME, async () => client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("OVERQUOTA");
    expect(client.logout).toHaveBeenCalledTimes(1);
  });

  it("logs out even when finding the folder throws", async () => {
    const client = {
      list: vi.fn(async () => {
        throw new Error("boom");
      }),
      append: vi.fn(),
      logout: vi.fn(async () => undefined),
    } as unknown as ImapFlow & { logout: ReturnType<typeof vi.fn> };

    await appendDraft(CONFIG, MIME, async () => client);

    expect(client.logout).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run and see them fail.**
  `npx vitest run src/lib/outreach/deliver.test.ts`.

- [ ] **Step 7: Implement `appendDraft`.**
  Add to `deliver.ts`:
```ts
import { ImapFlow } from "imapflow";
```
  *(change the existing `import type { ImapFlow }` to a value import — the class
  is now constructed here.)*
```ts
/** How the connection is opened. A parameter so tests need no live mailbox. */
export type ImapConnect = (config: InboxConfig) => Promise<ImapFlow>;

async function defaultConnect(config: InboxConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  return client;
}

/**
 * Write one draft into the candidate's Drafts folder.
 *
 * Never throws. A rejected append, an unreachable host and a mailbox with no
 * drafts folder all come back as { ok: false }, because the caller's next move
 * is the same in every case: show the message with a copy button.
 */
export async function appendDraft(
  config: InboxConfig,
  mime: string,
  connect: ImapConnect = defaultConnect,
): Promise<DeliveryResult> {
  let client: ImapFlow;
  try {
    client = await connect(config);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason:
        `Could not reach the mailbox at ${config.host}: ${detail}. ` +
        "With Gmail this needs an app password, not your account password.",
    };
  }

  try {
    const folder = await findDraftsFolder(client);
    if (!folder) {
      return {
        ok: false,
        reason: `No drafts folder was found on ${config.host}. Copy the message instead.`,
      };
    }

    // \Draft so the client treats it as editable, \Seen so a message the
    // person wrote himself does not arrive as unread mail.
    await client.append(folder, mime, ["\\Draft", "\\Seen"]);
    return { ok: true, folder };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `The mailbox refused the draft: ${detail}` };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
```

- [ ] **Step 8: Run and see every delivery test pass.**
  `npx vitest run src/lib/outreach/deliver.test.ts`, then `npm test` and
  `npm run typecheck`.
  Commit: `Leave the draft in the mailbox instead of sending it`

- [ ] **Step 9: Add the by-hand live check script entry, not a test.**
  Design §12 asks for one real `APPEND` run by hand and never in CI, in the
  style of `scripts/check-mailbox.ts`. Create `scripts/check-drafts.ts`:
```ts
/**
 * Append one harmless draft to the configured mailbox, by hand.
 *
 * Run with `npm run drafts:check`. This is the only code path in the project
 * that touches a real mailbox with a write, and it is deliberately a script
 * rather than a test: nothing in CI should ever put a message in somebody's
 * Drafts folder.
 */

import { composeMime } from "../src/lib/outreach/compose";
import { appendDraft } from "../src/lib/outreach/deliver";
import { inboxConfig } from "../src/lib/email/inbox";

async function main(): Promise<void> {
  const config = inboxConfig();
  if (!config) {
    console.error("No mailbox is configured. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD in .env.");
    process.exitCode = 1;
    return;
  }

  const mime = composeMime({
    from: config.user,
    to: config.user,
    subject: "Internship Autopilot — drafts check",
    body: "If you are reading this in your Drafts folder, appending works.\n",
    date: new Date(),
  });

  const result = await appendDraft(config, mime);
  if (result.ok) console.log(`Draft written to ${result.folder}. Delete it when you have seen it.`);
  else console.error(`Could not write the draft: ${result.reason}`);
}

void main();
```
  Add to `package.json` scripts, beside `mailbox:check`:
```json
    "//drafts:check": "Append one test draft to the configured mailbox — by hand only, never in CI",
    "drafts:check": "tsx scripts/check-drafts.ts",
```
  Run `npm run typecheck`.
  Commit: `A by-hand check that appending really works`

---

### Task 15: Bounce and reply watcher (`src/lib/outreach/watch.ts`)

**Files:**
- Create: `src/lib/outreach/watch.ts`
- Modify: none — `src/lib/email/inbox.ts` is the pattern this follows, not a file it changes.
- Test: `src/lib/outreach/watch.test.ts`

**Interfaces:**

- Consumes:
  - `parseDsn(raw: string): BounceReport | null` (Task 6)
  - `isHardStatus(status: string): boolean` (Task 6)
  - `BounceReport` (Task 6) — type only
  - `inferPattern(address: string, name: NameParts): PatternId | null` (Task 3)
  - `NameParts`, `PatternId` (Task 3) — types only
  - `InboxConfig` from `src/lib/email/inbox.ts` — type only, not redeclared
  - From `src/lib/outreach/store.ts` (Task 11) and `src/lib/contacts/store.ts` (Task 10), via `WatchDeps` only — same judgment call as Task 12: the watcher never imports them directly.
- Produces:
```ts
export const BOUNCE_SENDER_PATTERN: RegExp;

/** One sent message the watcher is waiting on. */
export interface WatchedMessage {
  messageId: string;
  contactId: string;
  emailId: string;
  address: string;
  domain: string;
  contactName: NameParts;
  /** Null is never correlated. See the comment on the field. */
  sentAt: Date | null;
}

/** One incoming message, already read out of the mailbox. */
export interface IncomingMessage {
  from: string;
  receivedAt: Date;
  source: string;
}

export type WatchOutcome =
  | { kind: "hard-bounce"; messageId: string; emailId: string; address: string; status: string }
  | { kind: "soft-bounce"; messageId: string; emailId: string; address: string; status: string }
  | { kind: "probable-bounce"; messageId: string; emailId: string; address: string; sender: string }
  | { kind: "reply"; messageId: string; emailId: string; address: string; receivedAt: Date; pattern: PatternId | null };

export function classifyIncoming(message: IncomingMessage, tracked: readonly WatchedMessage[]): WatchOutcome | null;

export interface WatchDeps {
  listAwaitingMessages(): Promise<WatchedMessage[]>;
  recordHardBounce(outcome: { messageId: string; emailId: string; at: Date }): Promise<void>;
  recordReply(outcome: { messageId: string; emailId: string; at: Date }): Promise<void>;
  promoteNextBest(contactId: string, bouncedEmailId: string): Promise<string | null>;
  learnPattern(domain: string, pattern: PatternId): Promise<void>;
  fetchSince(config: InboxConfig, since: Date): Promise<IncomingMessage[]>;
}

export interface WatchPassResult {
  scanned: number;
  outcomes: WatchOutcome[];
  /** Addresses promoted to replace a hard-bounced one, for the run log. */
  promoted: string[];
}

export async function watchOnce(config: InboxConfig, deps: WatchDeps): Promise<WatchPassResult>;
export function fetchSinceOverImap(config: InboxConfig, since: Date): Promise<IncomingMessage[]>;
```

`classifyIncoming` is pure, and that is the design decision that matters: every
rule the spec calls load-bearing — hard versus soft, the `MAILER-DAEMON`
restriction, the `sentAt == null` exclusion — is decided there and tested with
no mailbox anywhere in sight. `watchOnce` only connects, loops and persists.

- [ ] **Step 1: Write the failing test for the MAILER-DAEMON restriction.**
  Create `src/lib/outreach/watch.test.ts`. This is the most important test in
  the feature, so it goes first.
```ts
/**
 * Tests for the bounce and reply watcher.
 *
 * The app never sends, yet it still gets ground truth, because a bounce is
 * delivered to the sender's inbox and this app already reads that inbox.
 *
 * Two rules here are load-bearing and both have their own test:
 *
 *   - A MAILER-DAEMON or postmaster sender may surface a message as a PROBABLE
 *     bounce for display, and may never mark the address BOUNCED without a
 *     parsed 5.x.x. Misreading an out-of-office would discard a correct
 *     address — the strongest evidence this feature can obtain, thrown away.
 *   - A message with sentAt == null is never correlated at all. That is the
 *     spec's biggest known risk: if the person forgets to mark a draft sent,
 *     the watcher must stay silent rather than guess.
 *
 * Classification is pure, so none of this needs a mailbox.
 */

import { describe, expect, it, vi } from "vitest";
import { classifyIncoming, type IncomingMessage, type WatchedMessage } from "./watch";

const SENT_AT = new Date("2026-09-10T12:00:00Z");

const TRACKED: WatchedMessage = {
  messageId: "m1",
  contactId: "c1",
  emailId: "e1",
  address: "jane.okafor@acme.com",
  domain: "acme.com",
  contactName: { first: "Jane", last: "Okafor" },
  sentAt: SENT_AT,
};

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    from: "jane.okafor@acme.com",
    receivedAt: new Date("2026-09-10T13:00:00Z"),
    source: "Subject: Re: hello\r\n\r\nHappy to chat.\r\n",
    ...overrides,
  };
}

const HARD_DSN = [
  "From: MAILER-DAEMON@acme.com",
  "Content-Type: multipart/report; report-type=delivery-status; boundary=b",
  "",
  "--b",
  "Content-Type: message/delivery-status",
  "",
  "Final-Recipient: rfc822; jane.okafor@acme.com",
  "Action: failed",
  "Status: 5.1.1",
  "",
  "--b--",
].join("\r\n");

const OUT_OF_OFFICE = [
  "From: postmaster@acme.com",
  "Subject: Automatic reply: hello",
  "",
  "Jane Okafor (jane.okafor@acme.com) is out of the office until Monday.",
].join("\r\n");

describe("classifyIncoming", () => {
  it("never marks an address bounced on the MAILER-DAEMON heuristic alone", () => {
    const outcome = classifyIncoming(
      incoming({ from: "postmaster@acme.com", source: OUT_OF_OFFICE }),
      [TRACKED],
    );

    // Surfaced for the person to look at, and nothing more. Anything that
    // returns "hard-bounce" here would discard a correct address.
    expect(outcome).toEqual({
      kind: "probable-bounce",
      messageId: "m1",
      emailId: "e1",
      address: "jane.okafor@acme.com",
      sender: "postmaster@acme.com",
    });
  });

  it("never correlates a message that was not marked sent", () => {
    // sentAt is null when the person forgot the "I sent it" click. There is
    // no instant to compare against, so there is nothing honest to conclude.
    const outcome = classifyIncoming(
      incoming({ from: "MAILER-DAEMON@acme.com", source: HARD_DSN }),
      [{ ...TRACKED, sentAt: null }],
    );

    expect(outcome).toBeNull();
  });
});
```

- [ ] **Step 2: Run and see it fail.**
  `npx vitest run src/lib/outreach/watch.test.ts` — cannot resolve `./watch`.

- [ ] **Step 3: Create `watch.ts` with `classifyIncoming` covering only these two rules.**
```ts
/**
 * Watching the inbox for what happened to a message the candidate sent.
 *
 * This app never sends, so it cannot watch its own outbound mail. It does not
 * need to: a bounce is delivered to the sender's inbox, and this app already
 * reads that inbox. The same pass also sees replies, which are the strongest
 * signal available anywhere in this feature.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS ALLOWED TO READ — the same discipline as src/lib/email/inbox.ts
 *
 *   - a fresh connection per pass, closed again in a finally block
 *   - INBOX only, opened read-only
 *   - only mail that arrived after a message was marked sent
 *   - nothing is marked, moved, deleted or stored beyond what is extracted
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Classification is pure and lives in `classifyIncoming`, because every rule
 * worth arguing about is in there: hard versus soft, the daemon-sender limit,
 * and the refusal to correlate anything that was never marked sent.
 */

import type { NameParts, PatternId } from "../contacts/pattern";
import type { InboxConfig } from "../email/inbox";

/**
 * Senders that make a message a candidate bounce — and nothing more than a
 * candidate. See the comment in `classifyIncoming`.
 */
export const BOUNCE_SENDER_PATTERN = /^(mailer-daemon|postmaster)@/i;

/** One sent message the watcher is waiting on. */
export interface WatchedMessage {
  messageId: string;
  contactId: string;
  emailId: string;
  address: string;
  domain: string;
  contactName: NameParts;
  /**
   * When the person said he sent it. Null is never correlated: with no
   * instant to measure from, any conclusion drawn would be a guess, and the
   * guesses here write to ContactEmail.status.
   */
  sentAt: Date | null;
}

/** One incoming message, already read out of the mailbox. */
export interface IncomingMessage {
  from: string;
  receivedAt: Date;
  source: string;
}

export type WatchOutcome =
  | { kind: "hard-bounce"; messageId: string; emailId: string; address: string; status: string }
  | { kind: "soft-bounce"; messageId: string; emailId: string; address: string; status: string }
  | { kind: "probable-bounce"; messageId: string; emailId: string; address: string; sender: string }
  | {
      kind: "reply";
      messageId: string;
      emailId: string;
      address: string;
      receivedAt: Date;
      pattern: PatternId | null;
    };

/** The tracked message this incoming mail could relate to, or null. */
function trackedFor(
  tracked: readonly WatchedMessage[],
  match: (entry: WatchedMessage) => boolean,
  receivedAt: Date,
): WatchedMessage | null {
  const found = tracked.find(
    (entry) =>
      // Null sentAt is excluded here as well as in the query that built this
      // list. Belt and braces, because the cost of getting it wrong is an
      // address marked BOUNCED on the strength of unrelated mail.
      entry.sentAt !== null && entry.sentAt.getTime() <= receivedAt.getTime() && match(entry),
  );
  return found ?? null;
}

/** Decide what one incoming message means. Pure. */
export function classifyIncoming(
  message: IncomingMessage,
  tracked: readonly WatchedMessage[],
): WatchOutcome | null {
  const sender = message.from.trim();

  if (BOUNCE_SENDER_PATTERN.test(sender)) {
    // A daemon sender with no machine-readable report. This is reported so the
    // person can look at it, and it stops there: an out-of-office autoreply
    // from postmaster@ looks exactly like this, and marking the address
    // BOUNCED on that basis would throw away a correct address.
    const entry = trackedFor(
      tracked,
      (candidate) => message.source.toLowerCase().includes(candidate.address.toLowerCase()),
      message.receivedAt,
    );
    if (!entry) return null;

    return {
      kind: "probable-bounce",
      messageId: entry.messageId,
      emailId: entry.emailId,
      address: entry.address,
      sender,
    };
  }

  return null;
}
```

- [ ] **Step 4: Run and see both tests pass.**
  `npx vitest run src/lib/outreach/watch.test.ts`, then `npm run typecheck`.
  Commit: `Report a suspected bounce without acting on the suspicion`

- [ ] **Step 5: Write the failing tests for parsed DSNs, hard and soft.**
  Append to `watch.test.ts` inside the same `describe`:
```ts
  it("marks a hard 5.x.x bounce against the address it names", () => {
    const outcome = classifyIncoming(
      incoming({ from: "MAILER-DAEMON@acme.com", source: HARD_DSN }),
      [TRACKED],
    );

    expect(outcome).toEqual({
      kind: "hard-bounce",
      messageId: "m1",
      emailId: "e1",
      address: "jane.okafor@acme.com",
      status: "5.1.1",
    });
  });

  it("records nothing negative for a soft 4.x.x bounce", () => {
    // A full mailbox, greylisting, or a server having a bad hour. It says
    // nothing about whether the address is right, and treating it as a
    // negative would discard correct addresses at the busiest companies.
    const softDsn = HARD_DSN.replace("Status: 5.1.1", "Status: 4.2.2");

    const outcome = classifyIncoming(
      incoming({ from: "MAILER-DAEMON@acme.com", source: softDsn }),
      [TRACKED],
    );

    expect(outcome).toEqual({
      kind: "soft-bounce",
      messageId: "m1",
      emailId: "e1",
      address: "jane.okafor@acme.com",
      status: "4.2.2",
    });
  });

  it("ignores a DSN naming an address we never wrote to", () => {
    const foreign = HARD_DSN.replace(/jane\.okafor@acme\.com/g, "someone@else.test");

    expect(
      classifyIncoming(incoming({ from: "MAILER-DAEMON@acme.com", source: foreign }), [TRACKED]),
    ).toBeNull();
  });

  it("ignores a bounce that predates the moment the message was sent", () => {
    expect(
      classifyIncoming(
        incoming({
          from: "MAILER-DAEMON@acme.com",
          source: HARD_DSN,
          receivedAt: new Date("2026-09-09T12:00:00Z"),
        }),
        [TRACKED],
      ),
    ).toBeNull();
  });
```

- [ ] **Step 6: Run and see them fail.**
  `npx vitest run src/lib/outreach/watch.test.ts`.

- [ ] **Step 7: Put DSN parsing ahead of the sender heuristic.**
  Add to `watch.ts`:
```ts
import { isHardStatus, parseDsn } from "./bounce";
```
  and insert at the top of `classifyIncoming`, before the
  `BOUNCE_SENDER_PATTERN` block:
```ts
  // The machine-readable form first, because it is the only one that can
  // produce a negative. Everything below it is display-only.
  const report = parseDsn(message.source);
  if (report) {
    const failed = report.failedRecipient.trim().toLowerCase();
    const entry = trackedFor(
      tracked,
      (candidate) => candidate.address.toLowerCase() === failed,
      message.receivedAt,
    );
    if (!entry) return null;

    return isHardStatus(report.status)
      ? {
          kind: "hard-bounce",
          messageId: entry.messageId,
          emailId: entry.emailId,
          address: entry.address,
          status: report.status,
        }
      : {
          kind: "soft-bounce",
          messageId: entry.messageId,
          emailId: entry.emailId,
          address: entry.address,
          status: report.status,
        };
  }
```

- [ ] **Step 8: Run and see the DSN tests pass.**
  `npx vitest run src/lib/outreach/watch.test.ts`, then `npm run typecheck`.
  Commit: `Treat a soft bounce as the non-event it is`

- [ ] **Step 9: Write the failing tests for replies.**
  Append to `watch.test.ts`:
```ts
  it("treats a non-bounce from the contact's address as a reply and learns the pattern", () => {
    const outcome = classifyIncoming(incoming(), [TRACKED]);

    expect(outcome).toEqual({
      kind: "reply",
      messageId: "m1",
      emailId: "e1",
      address: "jane.okafor@acme.com",
      receivedAt: new Date("2026-09-10T13:00:00Z"),
      pattern: "first.last",
    });
  });

  it("matches a reply case-insensitively and past a display name", () => {
    const outcome = classifyIncoming(
      incoming({ from: "Jane Okafor <Jane.Okafor@Acme.com>" }),
      [TRACKED],
    );

    expect(outcome?.kind).toBe("reply");
  });

  it("reports a reply with no pattern when the evidence is ambiguous", () => {
    // inferPattern returns null when two patterns both explain the address.
    // Ambiguous evidence must update nothing.
    const outcome = classifyIncoming(incoming({ from: "j.okafor@acme.com" }), [
      { ...TRACKED, address: "j.okafor@acme.com", contactName: { first: "J", last: "Okafor" } },
    ]);

    expect(outcome).toMatchObject({ kind: "reply", pattern: null });
  });

  it("ignores ordinary mail from somebody we never wrote to", () => {
    expect(classifyIncoming(incoming({ from: "newsletter@example.com" }), [TRACKED])).toBeNull();
  });
```

- [ ] **Step 10: Run and see them fail.**
  `npx vitest run src/lib/outreach/watch.test.ts`.

- [ ] **Step 11: Add reply classification.**
  Add `import { inferPattern } from "../contacts/pattern";` and this helper:
```ts
/** The bare address out of "Jane Okafor <jane@acme.com>" or "jane@acme.com". */
function bareAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return (angled ? angled[1] : from).trim().toLowerCase();
}
```
  and replace the final `return null;` of `classifyIncoming` with:
```ts
  // Anything else from an address we wrote to is a reply — the strongest
  // signal this feature can get, and the one that teaches EmailPattern for
  // free.
  const sent = bareAddress(sender);
  const entry = trackedFor(
    tracked,
    (candidate) => candidate.address.toLowerCase() === sent,
    message.receivedAt,
  );
  if (!entry) return null;

  return {
    kind: "reply",
    messageId: entry.messageId,
    emailId: entry.emailId,
    address: entry.address,
    receivedAt: message.receivedAt,
    // Null when two patterns both explain the address. Ambiguous evidence
    // updates nothing.
    pattern: inferPattern(entry.address, entry.contactName),
  };
```

- [ ] **Step 12: Run and see the reply tests pass.**
  `npx vitest run src/lib/outreach/watch.test.ts`, then `npm run typecheck`.
  Commit: `Let a reply confirm the address and teach the domain`

- [ ] **Step 13: Write the failing tests for one watcher pass.**
  Append a new `describe` to `watch.test.ts`:
```ts
describe("watchOnce", () => {
  function stubDeps(overrides: Partial<WatchDeps> = {}): WatchDeps {
    return {
      listAwaitingMessages: vi.fn(async () => [TRACKED]),
      recordHardBounce: vi.fn(async () => undefined),
      recordReply: vi.fn(async () => undefined),
      promoteNextBest: vi.fn(async () => "jokafor@acme.com"),
      learnPattern: vi.fn(async () => undefined),
      fetchSince: vi.fn(async () => []),
      ...overrides,
    };
  }

  const CONFIG = {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    user: "me@example.com",
    password: "app-password",
  };

  it("does not open a connection when nothing is awaiting a result", async () => {
    // No sent messages, nothing to correlate, no reason to read the mailbox.
    const deps = stubDeps({ listAwaitingMessages: vi.fn(async () => []) });

    const result = await watchOnce(CONFIG, deps);

    expect(result).toEqual({ scanned: 0, outcomes: [], promoted: [] });
    expect(deps.fetchSince).not.toHaveBeenCalled();
  });

  it("reads only mail after the earliest sentAt", async () => {
    const deps = stubDeps({
      listAwaitingMessages: vi.fn(async () => [
        { ...TRACKED, messageId: "m2", sentAt: new Date("2026-09-12T00:00:00Z") },
        TRACKED,
      ]),
    });

    await watchOnce(CONFIG, deps);

    expect(deps.fetchSince).toHaveBeenCalledWith(CONFIG, SENT_AT);
  });

  it("records a hard bounce and promotes the next-best candidate", async () => {
    const deps = stubDeps({
      fetchSince: vi.fn(async () => [
        { from: "MAILER-DAEMON@acme.com", receivedAt: new Date("2026-09-10T13:00:00Z"), source: HARD_DSN },
      ]),
    });

    const result = await watchOnce(CONFIG, deps);

    expect(result.outcomes[0].kind).toBe("hard-bounce");
    expect(deps.recordHardBounce).toHaveBeenCalledWith({
      messageId: "m1",
      emailId: "e1",
      at: new Date("2026-09-10T13:00:00Z"),
    });
    expect(deps.promoteNextBest).toHaveBeenCalledWith("c1", "e1");
    expect(result.promoted).toEqual(["jokafor@acme.com"]);
    expect(deps.recordReply).not.toHaveBeenCalled();
  });

  it("writes nothing for a soft bounce or a probable one", async () => {
    const deps = stubDeps({
      fetchSince: vi.fn(async () => [
        {
          from: "MAILER-DAEMON@acme.com",
          receivedAt: new Date("2026-09-10T13:00:00Z"),
          source: HARD_DSN.replace("Status: 5.1.1", "Status: 4.2.2"),
        },
        { from: "postmaster@acme.com", receivedAt: new Date("2026-09-10T14:00:00Z"), source: OUT_OF_OFFICE },
      ]),
    });

    const result = await watchOnce(CONFIG, deps);

    expect(result.outcomes.map((o) => o.kind)).toEqual(["soft-bounce", "probable-bounce"]);
    expect(deps.recordHardBounce).not.toHaveBeenCalled();
    expect(deps.promoteNextBest).not.toHaveBeenCalled();
    expect(deps.learnPattern).not.toHaveBeenCalled();
  });

  it("records a reply and teaches the pattern", async () => {
    const deps = stubDeps({
      fetchSince: vi.fn(async () => [
        { from: "jane.okafor@acme.com", receivedAt: new Date("2026-09-10T13:00:00Z"), source: "Re: hello" },
      ]),
    });

    await watchOnce(CONFIG, deps);

    expect(deps.recordReply).toHaveBeenCalledWith({
      messageId: "m1",
      emailId: "e1",
      at: new Date("2026-09-10T13:00:00Z"),
    });
    expect(deps.learnPattern).toHaveBeenCalledWith("acme.com", "first.last");
  });

  it("never reads the mailbox for a message that was not marked sent", async () => {
    const deps = stubDeps({
      listAwaitingMessages: vi.fn(async () => [{ ...TRACKED, sentAt: null }]),
    });

    const result = await watchOnce(CONFIG, deps);

    expect(deps.fetchSince).not.toHaveBeenCalled();
    expect(result.scanned).toBe(0);
  });
});
```
  Extend the import at the top of the file to `classifyIncoming, watchOnce,
  type IncomingMessage, type WatchDeps, type WatchedMessage`.

- [ ] **Step 14: Run and see them fail.**
  `npx vitest run src/lib/outreach/watch.test.ts`.

- [ ] **Step 15: Implement `watchOnce`.**
  Add to `watch.ts`:
```ts
export interface WatchDeps {
  /** Messages with status SENT and sentAt set. Nothing else is correlated. */
  listAwaitingMessages(): Promise<WatchedMessage[]>;
  /** ContactEmail.status = BOUNCED and OutreachMessage.status = BOUNCED. */
  recordHardBounce(outcome: { messageId: string; emailId: string; at: Date }): Promise<void>;
  /** ContactEmail.status = CONFIRMED and OutreachMessage.status = REPLIED. */
  recordReply(outcome: { messageId: string; emailId: string; at: Date }): Promise<void>;
  /** Returns the address promoted in place of the dead one, or null. */
  promoteNextBest(contactId: string, bouncedEmailId: string): Promise<string | null>;
  learnPattern(domain: string, pattern: PatternId): Promise<void>;
  fetchSince(config: InboxConfig, since: Date): Promise<IncomingMessage[]>;
}

export interface WatchPassResult {
  scanned: number;
  outcomes: WatchOutcome[];
  /** Addresses promoted to replace a hard-bounced one, for the run log. */
  promoted: string[];
}

/**
 * One pass over the new mail.
 *
 * Opens nothing when there is nothing to correlate. A message the person never
 * marked sent has no sentAt, so it is filtered out before the window is even
 * computed — if that leaves the list empty, the mailbox is not read at all.
 */
export async function watchOnce(
  config: InboxConfig,
  deps: WatchDeps,
): Promise<WatchPassResult> {
  const tracked = (await deps.listAwaitingMessages()).filter(
    (entry): entry is WatchedMessage & { sentAt: Date } => entry.sentAt !== null,
  );
  if (tracked.length === 0) return { scanned: 0, outcomes: [], promoted: [] };

  const since = new Date(
    Math.min(...tracked.map((entry) => entry.sentAt.getTime())),
  );

  const messages = await deps.fetchSince(config, since);
  const outcomes: WatchOutcome[] = [];
  const promoted: string[] = [];

  for (const message of messages) {
    const outcome = classifyIncoming(message, tracked);
    if (!outcome) continue;
    outcomes.push(outcome);

    if (outcome.kind === "hard-bounce") {
      await deps.recordHardBounce({
        messageId: outcome.messageId,
        emailId: outcome.emailId,
        at: message.receivedAt,
      });
      const next = await deps.promoteNextBest(
        tracked.find((entry) => entry.messageId === outcome.messageId)!.contactId,
        outcome.emailId,
      );
      if (next) promoted.push(next);
      continue;
    }

    if (outcome.kind === "reply") {
      await deps.recordReply({
        messageId: outcome.messageId,
        emailId: outcome.emailId,
        at: outcome.receivedAt,
      });
      if (outcome.pattern) {
        const entry = tracked.find((candidate) => candidate.messageId === outcome.messageId);
        if (entry) await deps.learnPattern(entry.domain, outcome.pattern);
      }
    }

    // soft-bounce and probable-bounce write nothing. They are reported and
    // that is the whole of it.
  }

  return { scanned: messages.length, outcomes, promoted };
}
```

- [ ] **Step 16: Run and see the pass tests go green.**
  `npx vitest run src/lib/outreach/watch.test.ts`, then `npm run typecheck`.
  Commit: `Act on a bounce only when the mail server said so in machine words`

- [ ] **Step 17: Add the IMAP reader, reusing the inbox discipline exactly.**
  Add to `watch.ts`:
```ts
import { ImapFlow } from "imapflow";
```
```ts
/**
 * Read the mail that arrived after `since`, and nothing else.
 *
 * A direct copy of the discipline in src/lib/email/inbox.ts, including the
 * second SINCE check: IMAP's SINCE has day granularity on some servers, which
 * would otherwise widen the window from "since he sent it" to "everything
 * today" — the difference between reading one message and reading a morning's
 * mail out of somebody's personal inbox.
 */
export async function fetchSinceOverImap(
  config: InboxConfig,
  since: Date,
): Promise<IncomingMessage[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  await client.connect();

  // readOnly, so nothing is marked as read by looking at it, and nothing is
  // moved, flagged or deleted anywhere in this function.
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });

  try {
    const found: IncomingMessage[] = [];

    for await (const message of client.fetch({ since }, { envelope: true, source: true })) {
      const received = message.envelope?.date ? new Date(message.envelope.date) : null;
      if (received && received.getTime() < since.getTime()) continue;

      found.push({
        from: message.envelope?.from?.[0]?.address ?? "",
        receivedAt: received ?? new Date(),
        source: message.source?.toString("utf8") ?? "",
      });
    }

    return found;
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}
```

- [ ] **Step 18: Verify the whole suite and commit.**
  `npm test` and `npm run typecheck`, both clean. Confirm by reading the file
  that `fetchSinceOverImap` contains no call that marks, moves, stores or
  deletes anything, and that `logout()` is inside `finally`.
  Commit: `Read the inbox for bounces the same careful way the code reader does`

---

## Phase 5 — Section F — UI (Tasks 16–17)

*Fragment of the Contact Finder / Recruiter Outreach implementation plan
(`docs/superpowers/specs/2026-09-19-contact-outreach-design.md`, §10 and §1).*

---

## Read this before dispatching Section F

### Concurrency: two files in this section are SHARED and must NOT go to a parallel agent

Another agent (**Codex**) is working concurrently in `src/app/**` on this
repository. Two of the files these tasks touch are files Codex also edits:

| File | Why it is shared | Who edits it |
|---|---|---|
| `src/app/site-nav.tsx` | Single `GROUPS` array; every feature that adds a page appends to it. Codex's frontend work (`bda65f8 Frontend workspace redesign (Codex)`) owns this file's structure. | **Human coordinator, after the implementation agents finish.** |
| `src/app/ui-icon.tsx` | Single `paths` object keyed by `IconName`; every new nav entry adds a key. | **Human coordinator, after the implementation agents finish.** |

Both edits are one-line additions to a literal. They are trivially done by hand
and catastrophically prone to merge conflict if two agents append to the same
object literal. **Steps 16.14, 16.15, 17.8 and 17.9 below are marked
`[COORDINATOR]` and must be excluded from any implementation agent's scope.**

Everything else in Tasks 16 and 17 lives in **new directories**
(`src/app/contacts/`, `src/app/settings/outreach/`, `src/lib/outreach/env-file.ts`)
and cannot collide with Codex even though `src/app/**` is nominally his area —
new files are not shared files. The single exception is the widening edit to
`src/lib/email/env-file.ts` (Step 17.1), which is outside `src/app/**` and so
outside Codex's lane entirely.

### There is no component or E2E test harness in this repository — verified

`package.json` `devDependencies` are: `@types/node`, `@types/react`,
`@types/react-dom`, `playwright`, `prisma`, `tsx`, `typescript`, `vitest`.

- **No `@testing-library/*` of any kind.** No `jsdom`, no `happy-dom`.
- **No `vitest.config.*` file exists** (`ls vitest.config.*` returns nothing), so
  vitest runs on its defaults: a Node environment, no DOM. A `.tsx` test that
  rendered a component would fail on `document is not defined`.
- `playwright` is a dependency of the *apply workers*
  (`scripts/apply-daemon.ts`, `scripts/shadow-apply.ts`), not of a test runner.
  There is no Playwright test config and no `test:e2e` script.

**Consequence, stated plainly rather than worked around:** pages, server actions
and client components in this section are **not unit tested**. They are verified
by `npm run typecheck` plus the manual browser checks written out in full at
Steps 16.17 and 17.13. Only the extracted pure helpers
(`src/app/contacts/format.ts`, `src/lib/outreach/env-file.ts`) get `.test.ts`
files, which is exactly what this repository already does with
`src/app/jobs/format.ts` / `src/app/jobs/format.test.ts` and
`src/app/jobs/filter-presentation.ts` / `.test.ts`.

**Do not add a component test harness as part of this feature.** Introducing
jsdom + Testing Library is a repository-wide decision with its own config,
setup file, CI cost and conventions; smuggling it in under a contacts page is
how a project ends up with one tested component and a harness nobody maintains.

### Hazards

- **Never run `npm run build` while `npm run dev` is running.** They fight over
  `.next/` and the build corrupts the dev server's output directory.
  `npm run typecheck` (`tsc --noEmit`) is safe to run alongside `dev` and is the
  type gate for this section.
- **`prisma generate` EPERMs on Windows while any repo Node process holds the
  query-engine DLL.** Stop `npm run dev`, any `tsx scripts/*` worker, and any
  `vitest --watch` before regenerating the client after the Section-B schema
  migration lands. This is also why `src/app/contacts/format.ts` (Step 16.2)
  deliberately types its inputs as **local string unions rather than importing
  `ContactEmailStatus` / `OutreachStatus` from `@prisma/client`**: its test then
  runs with no generated client at all.
- **`writeEnvVars` throws when `NODE_ENV === "test"` and the path is the real
  `.env`** (`src/lib/email/env-file.ts:46-50`). This guard exists because an
  earlier version of that file's own test called `writeEnvVars()` with no path,
  the default resolved to the project `.env`, and the run replaced it with two
  lines — destroying `DATABASE_URL` and every other secret. **Every test in Task
  17 passes an explicit `mkdtempSync` path.** Never call `writeEnvVars` from a
  test without one.
- Commit subjects in this repo are **prose imperative sentences**, not
  Conventional Commits. Recent history: `Design for reaching people, not just
  boards`, `Make restoring a backup safe to run twice`, `Harden the password
  gate for a public address`. Suggested subjects are given at the end of each
  task.

---

### Task 16: Contacts page and server actions (`src/app/contacts/`)

**Files:**
- Create: `src/app/contacts/format.ts`
- Create: `src/app/contacts/format.test.ts`
- Create: `src/app/contacts/copy-button.tsx`
- Create: `src/app/contacts/actions.ts`
- Create: `src/app/contacts/page.tsx`
- Create: `src/app/contacts/loading.tsx`
- Modify: `src/app/site-nav.tsx:28-34` — **SHARED, coordinator only**
- Modify: `src/app/ui-icon.tsx:3-23` — **SHARED, coordinator only**
- Test: `src/app/contacts/format.test.ts` (the only test; see the harness note above)

**Interfaces:**

*Consumes — from earlier tasks. These are the exact names and signatures Task 16
imports. If an earlier task exported a different name, **fix the import here and
tell the coordinator**; do not reimplement the function locally.*

- `src/lib/db` → `db` *(existing)*
- `src/lib/auth/guard` → `requireAccess(): Promise<void>` *(existing)*
- `src/lib/email/inbox` → `inboxConfig(): InboxConfig | null` *(existing,
  `src/lib/email/inbox.ts:49`)*
- `src/lib/contacts/discover` →
  `discoverContactEmails(contactId: string): Promise<{ generated: number; best: { address: string; confidence: number } | null; note: string | null }>`
- `src/lib/outreach/draft` →
  `buildOutreachDraft(contactId: string, emailId: string): Promise<{ subject: string; body: string }>`
- `src/lib/outreach/compose` →
  `composeMime(message: { from: string; to: string; subject: string; body: string; date: Date }): string`
- `src/lib/outreach/deliver` →
  `appendDraft(config: InboxConfig, mime: string): Promise<DeliveryResult>` and
  `type DeliveryResult = { ok: true; folder: string } | { ok: false; reason: string }`
- `@prisma/client` → `ContactSource`, `OutreachStatus`, `ContactEmailStatus`
  *(from the Section-B migration)*

*Produces:*

- `src/app/contacts/format.ts` → `CONFIDENCE_UNKNOWN`, `confidenceLabel`,
  `confidenceBadgeClass`, `emailStatusBadgeClass`, `outreachStatusBadgeClass`,
  `followUpLabel`, `type EmailStatusName`, `type OutreachStatusName`
- `src/app/contacts/copy-button.tsx` → `CopyButton`
- `src/app/contacts/actions.ts` → `addContactAction`, `discoverContactAction`,
  `draftMessageAction`, `pushDraftAction`, `markSentAction`, `setFollowUpAction`
- `src/app/contacts/page.tsx` → default `ContactsPage`, `dynamic`, `metadata`
- `src/app/contacts/loading.tsx` → default `ContactsLoading`

**Design notes that the steps below depend on:**

1. **The thread is the point.** §13 of the design: *"`OutreachMessage` has no
   unique constraint. Drafting twice for the same contact and address creates
   two rows, which is intentional — a follow-up is a second message — but it
   means the UI must make the existing thread visible so the person does not
   introduce himself twice by accident."* There is no database constraint
   guarding this. **The rendered thread is the only guard**, so every contact
   card renders its full `outreach` history, newest first, unconditionally —
   never behind a `<details>` that starts closed, and never truncated to the
   latest message.
2. **The copy path is always present**, not a failure branch.
   §7: *"This path is unconditional and always present. It also has to exist
   regardless, because a candidate with no mailbox configured must still be able
   to use the feature."* Every draft renders its subject and body with a copy
   button whether or not IMAP is configured and whether or not `appendDraft`
   ever succeeded.
3. **Colour is reserved for meaning.** `src/app/globals.css:958` heads the badge
   block *"Badges — judgements, and the only place semantic colour appears"*.
   The available vocabulary, confirmed by reading `globals.css:961-1010`, is:
   `badge` (neutral), `badge-keep` (success), `badge-ambiguous` (warning),
   `badge-reject` (danger), `badge-closed` (grey/inert), `badge-outcome`
   (accent). **No new badge class is invented.** A guessed address is not an
   error, so it gets `badge-closed`, not `badge-reject`; only a bounce is red.

---

- [ ] **Step 16.1: Create the directory.**
  `mkdir -p src/app/contacts` from the repository root.

- [ ] **Step 16.2: Write `src/app/contacts/format.ts`.**
  Pure view logic, extracted for the same reason `src/app/jobs/format.ts` is:
  it is the part worth testing, and a page cannot be. Note the local string
  unions — no `@prisma/client` import, so the test runs without a generated
  client (see the `prisma generate` EPERM hazard above).

  ```ts
  /**
   * Display formatting for the contacts screen.
   *
   * Pure string functions, kept out of the page so they can be tested without
   * rendering anything — the same split as src/app/jobs/format.ts, and for the
   * same reason: this repository has no component test harness, so the logic
   * worth asserting has to live somewhere a plain vitest run can reach it.
   *
   * The status names are declared here as string unions rather than imported
   * from @prisma/client on purpose. It keeps the test runnable with no
   * generated Prisma client, which matters on Windows where `prisma generate`
   * fails with EPERM whenever any repo node process is holding the query
   * engine DLL. The unions are checked against the real enums at the call site
   * in page.tsx, where a Prisma enum value flows into these functions.
   */

  /** Mirrors ContactEmailStatus. There is deliberately no GRAVATAR_MISS. */
  export type EmailStatusName =
    | "GUESSED"
    | "GRAVATAR_HIT"
    | "API_VERIFIED"
    | "BOUNCED"
    | "CONFIRMED";

  /** Mirrors OutreachStatus. There is no SENDING: this app never sends. */
  export type OutreachStatusName = "DRAFT" | "SENT" | "BOUNCED" | "REPLIED";

  /** What a contact with no addresses yet shows in the confidence column. */
  export const CONFIDENCE_UNKNOWN = "—";

  /**
   * Turn a 0-100 score into a word.
   *
   * The bands are wide on purpose. The score is built from population priors
   * and a Gravatar probe, and presenting "63%" would imply a precision that
   * scoreAddress() does not have. Four words carry everything the person can
   * actually act on: is this worth an email, or should discovery run again?
   */
  export function confidenceLabel(confidence: number): string {
    if (!Number.isFinite(confidence)) return CONFIDENCE_UNKNOWN;
    if (confidence >= 80) return "strong";
    if (confidence >= 55) return "likely";
    if (confidence >= 25) return "weak";
    return "guess";
  }

  /**
   * The badge class for a confidence score.
   *
   * Colour in this design system is reserved for meaning (globals.css:958,
   * "the only place semantic colour appears"), so a low score is grey rather
   * than red: a guess is not a failure, it is the normal state of a new
   * contact. Red belongs to a bounce, which is the one thing here that is
   * actually wrong.
   */
  export function confidenceBadgeClass(confidence: number): string {
    if (!Number.isFinite(confidence)) return "badge badge-closed";
    if (confidence >= 80) return "badge badge-keep";
    if (confidence >= 55) return "badge badge-ambiguous";
    return "badge badge-closed";
  }

  /** The badge class for one candidate address's state. */
  export function emailStatusBadgeClass(status: EmailStatusName): string {
    switch (status) {
      case "CONFIRMED":
        return "badge badge-keep";
      case "API_VERIFIED":
      case "GRAVATAR_HIT":
        // Real evidence, but not a reply. Warning-tinted reads as
        // "promising, unproven" — the same meaning badge-elig-unconfirmed
        // carries on the jobs table.
        return "badge badge-ambiguous";
      case "BOUNCED":
        return "badge badge-reject";
      case "GUESSED":
      default:
        return "badge badge-closed";
    }
  }

  /** The badge class for one outreach message's fate. */
  export function outreachStatusBadgeClass(status: OutreachStatusName): string {
    switch (status) {
      case "REPLIED":
        return "badge badge-keep";
      case "BOUNCED":
        return "badge badge-reject";
      case "SENT":
        // An accent badge, not a green one: sending is an action taken, not a
        // good outcome. Green here would congratulate the person for pressing
        // a button.
        return "badge badge-outcome";
      case "DRAFT":
      default:
        return "badge badge-closed";
    }
  }

  /**
   * How a follow-up date reads in a list.
   *
   * Nothing acts on a follow-up date (design §8: "A date the UI surfaces;
   * nothing acts on it"), so the only job here is to make an overdue one
   * impossible to scroll past.
   */
  export function followUpLabel(followUpAt: Date, now: Date): string {
    const startOfDay = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

    const days = Math.round(
      (startOfDay(followUpAt) - startOfDay(now)) / (24 * 60 * 60 * 1000),
    );

    if (days === 0) return "follow up today";
    if (days === 1) return "follow up tomorrow";
    if (days > 1) return `follow up in ${days}d`;
    if (days === -1) return "follow up was yesterday";
    return `follow up was ${Math.abs(days)}d ago`;
  }

  /** True when a follow-up date has arrived or passed. */
  export function followUpDue(followUpAt: Date, now: Date): boolean {
    const startOfDay = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return startOfDay(followUpAt) <= startOfDay(now);
  }
  ```

- [ ] **Step 16.3: Write `src/app/contacts/format.test.ts`.**
  Co-located, matching `src/app/jobs/format.test.ts`.

  ```ts
  /**
   * The contacts screen's pure view logic.
   *
   * These are the only tests in this feature's UI: the repository has no
   * component or E2E harness (no @testing-library, no jsdom, no vitest.config),
   * so the page and its server actions are verified by `npm run typecheck` and
   * a manual browser pass instead. What can be asserted is asserted here.
   */

  import { describe, expect, it } from "vitest";
  import {
    CONFIDENCE_UNKNOWN,
    confidenceBadgeClass,
    confidenceLabel,
    emailStatusBadgeClass,
    followUpDue,
    followUpLabel,
    outreachStatusBadgeClass,
  } from "./format";

  describe("confidenceLabel", () => {
    it("bands the whole 0-100 range", () => {
      expect(confidenceLabel(0)).toBe("guess");
      expect(confidenceLabel(24)).toBe("guess");
      expect(confidenceLabel(25)).toBe("weak");
      expect(confidenceLabel(54)).toBe("weak");
      expect(confidenceLabel(55)).toBe("likely");
      expect(confidenceLabel(79)).toBe("likely");
      expect(confidenceLabel(80)).toBe("strong");
      expect(confidenceLabel(100)).toBe("strong");
    });

    it("never invents a number for a missing score", () => {
      expect(confidenceLabel(Number.NaN)).toBe(CONFIDENCE_UNKNOWN);
    });
  });

  describe("confidenceBadgeClass", () => {
    // Colour is reserved for meaning in this design system (globals.css:958).
    // A guessed address is the normal state of a new contact, not an error,
    // so it must not be red — red belongs to a bounce alone.
    it("never paints a low score as a failure", () => {
      expect(confidenceBadgeClass(0)).toBe("badge badge-closed");
      expect(confidenceBadgeClass(24)).toBe("badge badge-closed");
      expect(confidenceBadgeClass(54)).toBe("badge badge-closed");
    });

    it("escalates only as the evidence does", () => {
      expect(confidenceBadgeClass(55)).toBe("badge badge-ambiguous");
      expect(confidenceBadgeClass(80)).toBe("badge badge-keep");
    });

    it("only uses classes globals.css actually defines", () => {
      const allowed = new Set([
        "badge",
        "badge-keep",
        "badge-ambiguous",
        "badge-reject",
        "badge-closed",
        "badge-outcome",
      ]);
      for (const score of [0, 25, 55, 80, 100, Number.NaN]) {
        for (const token of confidenceBadgeClass(score).split(" ")) {
          expect(allowed.has(token)).toBe(true);
        }
      }
    });
  });

  describe("emailStatusBadgeClass", () => {
    it("reds only the bounce", () => {
      expect(emailStatusBadgeClass("BOUNCED")).toBe("badge badge-reject");
      expect(emailStatusBadgeClass("GUESSED")).toBe("badge badge-closed");
      expect(emailStatusBadgeClass("GRAVATAR_HIT")).toBe("badge badge-ambiguous");
      expect(emailStatusBadgeClass("API_VERIFIED")).toBe("badge badge-ambiguous");
      expect(emailStatusBadgeClass("CONFIRMED")).toBe("badge badge-keep");
    });
  });

  describe("outreachStatusBadgeClass", () => {
    it("distinguishes an action taken from a good outcome", () => {
      expect(outreachStatusBadgeClass("DRAFT")).toBe("badge badge-closed");
      expect(outreachStatusBadgeClass("SENT")).toBe("badge badge-outcome");
      expect(outreachStatusBadgeClass("REPLIED")).toBe("badge badge-keep");
      expect(outreachStatusBadgeClass("BOUNCED")).toBe("badge badge-reject");
    });
  });

  describe("followUpLabel", () => {
    const now = new Date(2026, 8, 19, 14, 0, 0);

    it("reads in days, from either direction", () => {
      expect(followUpLabel(new Date(2026, 8, 19, 8, 0, 0), now)).toBe("follow up today");
      expect(followUpLabel(new Date(2026, 8, 20), now)).toBe("follow up tomorrow");
      expect(followUpLabel(new Date(2026, 8, 23), now)).toBe("follow up in 4d");
      expect(followUpLabel(new Date(2026, 8, 18), now)).toBe("follow up was yesterday");
      expect(followUpLabel(new Date(2026, 8, 12), now)).toBe("follow up was 7d ago");
    });

    // A follow-up set for this morning is due now, not tomorrow. Comparing
    // instants rather than days would hide it until midnight.
    it("treats any time today as due", () => {
      expect(followUpDue(new Date(2026, 8, 19, 23, 59), now)).toBe(true);
      expect(followUpDue(new Date(2026, 8, 20, 0, 1), now)).toBe(false);
    });
  });
  ```

- [ ] **Step 16.4: Run the new test alone and confirm it passes.**
  `npx vitest run src/app/contacts/format.test.ts`
  Expect all assertions green. This is the one automated gate this task has.

- [ ] **Step 16.5: Write `src/app/contacts/copy-button.tsx`.**
  The **only** client component in this task; `page.tsx` stays a server
  component. Note the `<textarea readOnly>` that the page renders beside it
  (Step 16.11) — `navigator.clipboard` needs a secure context and can be
  blocked outright, and a copy path that is "always present" has to survive
  that too.

  ```tsx
  "use client";

  /**
   * Copy one draft to the clipboard.
   *
   * The smallest possible island: everything else on /contacts is a server
   * component, and this exists only because writing to the clipboard needs a
   * click handler in the browser.
   *
   * It is deliberately not the only way to get the text out. The page renders
   * the draft in a readonly textarea next to this button, because
   * navigator.clipboard requires a secure context and can be denied by policy,
   * and the copy path is the fallback that must never itself need a fallback
   * (design §7: "unconditional and always present").
   */

  import { useState } from "react";

  export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
    const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

    async function copy() {
      try {
        await navigator.clipboard.writeText(text);
        setState("copied");
      } catch {
        // No secure context, or the user denied clipboard access. Say so
        // rather than showing "Copied" over a clipboard that did not change.
        setState("failed");
      }
      window.setTimeout(() => setState("idle"), 3000);
    }

    return (
      <button type="button" className="small-button" onClick={copy}>
        {state === "copied" ? "Copied" : state === "failed" ? "Select it below" : label}
      </button>
    );
  }
  ```

- [ ] **Step 16.6: Write the header and helpers of `src/app/contacts/actions.ts`.**
  The `requireAccess()` comment restates the reason documented at
  `src/app/companies/actions.ts:20-23` — it is not decoration, it is why the
  check cannot live in middleware.

  ```ts
  "use server";

  /**
   * The contacts screen's actions (spec §26-27).
   *
   * Nothing here sends mail, and there is no code path that could. The app
   * writes a draft into the candidate's own Drafts folder, or renders it for
   * him to copy; he reads it and sends it himself from his own client. That is
   * the constraint the whole feature is built on (design §"The constraint
   * everything else follows from"), and it is structural rather than
   * procedural: there is no send button to press by accident because there is
   * no send.
   *
   * Simple writes go through `db` directly, matching src/app/companies/actions.ts.
   * Only the three operations with real logic behind them — discovery, draft
   * generation, and IMAP delivery — call into src/lib.
   */

  import { revalidatePath } from "next/cache";
  import { redirect } from "next/navigation";
  import { ContactSource, OutreachStatus } from "@prisma/client";
  import { db } from "@/lib/db";
  import { inboxConfig } from "@/lib/email/inbox";
  import { discoverContactEmails } from "@/lib/contacts/discover";
  import { buildOutreachDraft } from "@/lib/outreach/draft";
  import { composeMime } from "@/lib/outreach/compose";
  import { appendDraft } from "@/lib/outreach/deliver";

  // Next.js dispatches server actions by action ID, not by route, so a POST to any
  // path the middleware skips can still reach the actions below. The check has to
  // live in each action itself; middleware cannot be the boundary for these.
  import { requireAccess } from "@/lib/auth/guard";

  function field(form: FormData, name: string): string {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  }

  function back(params: Record<string, string>): never {
    redirect(`/contacts?${new URLSearchParams(params).toString()}`);
  }

  /**
   * Which address a draft should go to.
   *
   * Highest confidence first, and never a bounced one: a hard bounce is the
   * only ground-truth negative the system has (design §4), so re-drafting to
   * an address that already failed would waste the strongest signal available.
   */
  const BEST_EMAIL = {
    where: { status: { not: "BOUNCED" as const } },
    orderBy: [{ confidence: "desc" as const }, { address: "asc" as const }],
    take: 1,
  };
  ```

- [ ] **Step 16.7: Add `addContactAction` to `src/app/contacts/actions.ts`.**
  The domain-to-company resolution is defensive on purpose — `Company` has **no**
  unique constraint on `domain` (confirmed at `prisma/schema.prisma:508`; dedupe
  is application-code-only at `src/app/companies/actions.ts:49-54`), so more
  than one match means attach nothing.

  ```ts
  /**
   * Add a person worth introducing yourself to.
   *
   * The name is typed or pasted by a human. Nothing in this application ever
   * contacts LinkedIn — the URL field is stored for the candidate's own
   * reference and is never fetched (design §2). The account at risk from
   * automated access belongs to the person this app exists to serve, and
   * trading his professional profile to save some copy-and-paste is the worst
   * trade available anywhere in this codebase.
   */
  export async function addContactAction(form: FormData): Promise<void> {
    await requireAccess();

    const firstName = field(form, "firstName");
    const lastName = field(form, "lastName");
    const title = field(form, "title");
    const linkedinUrl = field(form, "linkedinUrl");
    const domain = field(form, "domain")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");

    if (firstName.length === 0 || lastName.length === 0) {
      back({ error: "A first and last name are both needed to guess an address." });
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      back({
        error: `"${domain}" is not a mail domain. Give the part after the @ — for example acme.com.`,
      });
    }
    if (linkedinUrl.length > 0 && !/^https?:\/\/(www\.)?linkedin\.com\//i.test(linkedinUrl)) {
      back({ error: "That does not look like a LinkedIn URL. Leave it blank if you do not have one." });
    }

    // Company.domain has no unique constraint, so findMany, and when more than
    // one row matches, attach nothing. A contact filed under the wrong
    // duplicate company row would show outreach history for a company he never
    // contacted — worse than showing none. Contact.domain is non-nullable and
    // independent of this join precisely so the pipeline never needs it.
    const matches = await db.company.findMany({ where: { domain }, select: { id: true } });
    const companyId = matches.length === 1 ? matches[0].id : null;

    const contact = await db.contact.create({
      data: {
        firstName,
        lastName,
        title: title.length > 0 ? title : null,
        domain,
        linkedinUrl: linkedinUrl.length > 0 ? linkedinUrl : null,
        companyId,
        source: ContactSource.MANUAL,
      },
    });

    revalidatePath("/contacts");
    back({
      saved:
        `Added ${contact.firstName} ${contact.lastName} at ${domain}. ` +
        "Run discovery to work out the address.",
    });
  }
  ```

- [ ] **Step 16.8: Add `discoverContactAction` to `src/app/contacts/actions.ts`.**

  ```ts
  /**
   * Work out this person's likely address.
   *
   * Everything expensive lives behind discoverContactEmails(); this is the
   * button that calls it and reports what came back. A discovery that finds
   * nothing is an ordinary outcome, not an error — a domain with no MX record
   * accepts no mail, and saying so plainly beats a red banner.
   */
  export async function discoverContactAction(form: FormData): Promise<void> {
    await requireAccess();

    const id = field(form, "id");
    const contact = await db.contact.findUnique({ where: { id } });
    if (!contact) back({ error: "That contact no longer exists." });

    const result = await discoverContactEmails(contact.id);

    if (result.best === null) {
      back({
        saved:
          `No usable address for ${contact.firstName} ${contact.lastName}. ` +
          (result.note ?? `Nothing at ${contact.domain} answered.`),
      });
    }

    revalidatePath("/contacts");
    back({
      saved:
        `${result.generated} candidate${result.generated === 1 ? "" : "s"} for ` +
        `${contact.firstName} ${contact.lastName}; best is ${result.best.address} ` +
        `at ${result.best.confidence}/100.`,
    });
  }
  ```

- [ ] **Step 16.9: Add `draftMessageAction` to `src/app/contacts/actions.ts`.**

  ```ts
  /**
   * Write an introduction, and save it as a draft row.
   *
   * The AI writes prose; rules supply every fact (design §6). Nothing the model
   * returns is parsed back into a fact, and with no AI provider configured the
   * builder falls back to a filled template — a template introduction is worse
   * writing than a generated one and is still a perfectly good email.
   *
   * A second draft for the same contact is allowed and is not a bug: a
   * follow-up is a second message. OutreachMessage has no unique constraint for
   * exactly that reason, which is why the page renders the whole thread.
   */
  export async function draftMessageAction(form: FormData): Promise<void> {
    await requireAccess();

    const id = field(form, "id");
    const contact = await db.contact.findUnique({
      where: { id },
      include: { emails: BEST_EMAIL },
    });
    if (!contact) back({ error: "That contact no longer exists." });

    const email = contact.emails[0];
    if (!email) {
      back({
        error:
          `No address to write to for ${contact.firstName} ${contact.lastName}. ` +
          "Run discovery first.",
      });
    }

    const { subject, body } = await buildOutreachDraft(contact.id, email.id);

    await db.outreachMessage.create({
      data: { contactId: contact.id, emailId: email.id, subject, body },
    });

    revalidatePath("/contacts");
    back({
      saved:
        `Drafted a message to ${email.address}. Read it before it goes anywhere — ` +
        "this app never sends.",
    });
  }
  ```

- [ ] **Step 16.10: Add `pushDraftAction`, `markSentAction` and `setFollowUpAction` to `src/app/contacts/actions.ts`.**

  ```ts
  /**
   * Put the draft in the candidate's own Drafts folder.
   *
   * IMAP APPEND with the credentials the app already holds — no new secret, no
   * new protocol, no SMTP. He opens his mail client and the message is waiting,
   * addressed and written, for him to read and send.
   *
   * Every failure here is reported and then ignored: the copy box on the page
   * is always rendered, so a missing mailbox or a refused APPEND costs a
   * convenience, never the feature.
   */
  export async function pushDraftAction(form: FormData): Promise<void> {
    await requireAccess();

    const id = field(form, "id");
    const message = await db.outreachMessage.findUnique({
      where: { id },
      include: { email: { select: { address: true } } },
    });
    if (!message) back({ error: "That draft no longer exists." });

    const config = inboxConfig();
    if (config === null) {
      back({
        error:
          "No mailbox is configured, so there is nowhere to put a draft. " +
          "Copy the message below into your mail client, or set one up under Preferences → Mailbox.",
      });
    }

    const mime = composeMime({
      from: config.user,
      to: message.email.address,
      subject: message.subject,
      body: message.body,
      date: new Date(),
    });

    const result = await appendDraft(config, mime);
    if (!result.ok) {
      back({ error: `Could not write the draft to your mailbox: ${result.reason}. Copy it below instead.` });
    }

    await db.outreachMessage.update({ where: { id }, data: { draftFolder: result.folder } });

    revalidatePath("/contacts");
    back({ saved: `Draft written to ${result.folder}. Open your mail client, read it, and send it yourself.` });
  }

  /**
   * Record that the candidate sent it.
   *
   * This is the hinge the whole verification story hangs on. The app never
   * sends, so it cannot watch its own outbound mail; it learns that an address
   * is wrong by seeing the bounce arrive in the inbox it already reads. The
   * watcher only looks at mail after sentAt, so an unmarked message is never
   * correlated and its bounce is missed entirely (design §13, listed there as
   * the most likely way this feature quietly underperforms).
   */
  export async function markSentAction(form: FormData): Promise<void> {
    await requireAccess();

    const id = field(form, "id");
    const message = await db.outreachMessage.findUnique({
      where: { id },
      include: { email: { select: { address: true } } },
    });
    if (!message) back({ error: "That message no longer exists." });
    if (message.status !== OutreachStatus.DRAFT) {
      back({ error: "That message is already marked as sent." });
    }

    await db.outreachMessage.update({
      where: { id },
      data: { status: OutreachStatus.SENT, sentAt: new Date() },
    });

    revalidatePath("/contacts");
    back({
      saved:
        `Marked sent to ${message.email.address}. Any bounce that arrives from now on ` +
        "will be matched to it.",
    });
  }

  /**
   * Set a date to come back to this.
   *
   * Nothing acts on it. There is no scheduler, no timed send and no reminder
   * email — the date is surfaced on this page and that is the whole feature
   * (design §8: "A date the UI surfaces; nothing acts on it").
   */
  export async function setFollowUpAction(form: FormData): Promise<void> {
    await requireAccess();

    const id = field(form, "id");
    const raw = field(form, "followUpAt");

    const message = await db.outreachMessage.findUnique({ where: { id } });
    if (!message) back({ error: "That message no longer exists." });

    if (raw.length === 0) {
      await db.outreachMessage.update({ where: { id }, data: { followUpAt: null } });
      revalidatePath("/contacts");
      back({ saved: "Follow-up cleared." });
    }

    // <input type="date"> gives YYYY-MM-DD. Parsed as local midnight rather
    // than via new Date("2026-09-19"), which UTC-parses and lands on the
    // previous day for anyone west of Greenwich.
    const [year, month, day] = raw.split("-").map(Number);
    const when = new Date(year, (month ?? 0) - 1, day ?? 1);
    if (Number.isNaN(when.getTime())) back({ error: "That is not a date." });

    await db.outreachMessage.update({ where: { id }, data: { followUpAt: when } });

    revalidatePath("/contacts");
    back({ saved: `Follow-up set for ${when.toLocaleDateString()}.` });
  }
  ```

- [ ] **Step 16.11: Write `src/app/contacts/page.tsx`.**
  Async server component; `searchParams` is a Promise and is awaited (Next 15);
  data read through a direct `db` call; `?saved=` / `?error=` rendered as
  `notice notice-ok` / `notice notice-error`. Sorted "needs you" first, the same
  shape the `/applications` tracker uses.

  ```tsx
  /**
   * The people, and the messages to them (spec §26-27).
   *
   * The two things this screen exists to make impossible:
   *
   *   1. Introducing yourself to the same person twice. OutreachMessage has no
   *      unique constraint — a follow-up is legitimately a second message — so
   *      the rendered thread is the only guard there is. It is therefore always
   *      visible, never collapsed and never truncated (design §13).
   *   2. Being unable to use the feature without a mailbox. Every draft renders
   *      with a copy button and a selectable box whether or not IMAP is
   *      configured (design §7).
   *
   * Nothing here sends mail. There is no send button anywhere on this page
   * because there is no send anywhere in the application.
   */

  import { db } from "@/lib/db";
  import { formatAge } from "../jobs/format";
  import { CopyButton } from "./copy-button";
  import {
    CONFIDENCE_UNKNOWN,
    confidenceBadgeClass,
    confidenceLabel,
    emailStatusBadgeClass,
    followUpDue,
    followUpLabel,
    outreachStatusBadgeClass,
    type EmailStatusName,
    type OutreachStatusName,
  } from "./format";
  import {
    addContactAction,
    discoverContactAction,
    draftMessageAction,
    markSentAction,
    pushDraftAction,
    setFollowUpAction,
  } from "./actions";

  export const dynamic = "force-dynamic";

  export const metadata = { title: "Contacts — Internship Autopilot" };

  interface ContactsPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }

  function one(params: Record<string, string | string[] | undefined>, key: string) {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  }

  export default async function ContactsPage({ searchParams }: ContactsPageProps) {
    const params = await searchParams;
    const saved = one(params, "saved");
    const error = one(params, "error");
    const now = new Date();

    const contacts = await db.contact.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: {
        company: { select: { name: true } },
        emails: { orderBy: [{ confidence: "desc" }, { address: "asc" }] },
        outreach: {
          orderBy: { draftedAt: "desc" },
          include: { email: { select: { address: true } } },
        },
      },
    });

    // "Needs you" first, the same shape /applications uses: an undrafted
    // contact, a draft nobody has acted on, a follow-up that has come due, or a
    // reply waiting to be read. Everyone else sorts below.
    function outstanding(contact: (typeof contacts)[number]): boolean {
      if (contact.outreach.length === 0) return true;
      return contact.outreach.some(
        (message) =>
          message.status === "DRAFT" ||
          message.status === "REPLIED" ||
          (message.followUpAt !== null && followUpDue(message.followUpAt, now)),
      );
    }

    const needsYou = contacts.filter(outstanding);
    const settled = contacts.filter((contact) => !outstanding(contact));

    const drafts = contacts.reduce(
      (total, contact) => total + contact.outreach.filter((m) => m.status === "DRAFT").length,
      0,
    );
    const replies = contacts.reduce(
      (total, contact) => total + contact.outreach.filter((m) => m.status === "REPLIED").length,
      0,
    );

    return (
      <main className="page page-wide">
        <h1>Contacts</h1>
        <p className="lede">
          People at the companies you are applying to. {contacts.length} tracked,{" "}
          {drafts} draft{drafts === 1 ? "" : "s"} waiting
          {replies > 0 ? `, ${replies} repl${replies === 1 ? "y" : "ies"} in` : ""}.
        </p>

        {saved ? <div className="notice notice-ok">{saved}</div> : null}
        {error ? <div className="notice notice-error">{error}</div> : null}

        <div className="notice">
          <strong>This app never sends mail.</strong> It writes a draft into your own
          Drafts folder, or shows it here for you to copy. You read it and send it
          yourself. Nothing leaves this machine without you pressing send in your own
          mail client.
        </div>

        <details className="filters-panel" open={contacts.length === 0}>
          <summary>Add a contact</summary>
          <form className="filters" action={addContactAction}>
            <label className="filter">
              <span>First name</span>
              <input type="text" name="firstName" placeholder="Jane" required />
            </label>
            <label className="filter">
              <span>Last name</span>
              <input type="text" name="lastName" placeholder="Okafor" required />
            </label>
            <label className="filter">
              <span>Title</span>
              <input type="text" name="title" placeholder="University Recruiter" />
            </label>
            <label className="filter">
              <span>Mail domain</span>
              <input type="text" name="domain" placeholder="acme.com" required />
            </label>
            <label className="filter">
              <span>LinkedIn URL</span>
              <input type="url" name="linkedinUrl" placeholder="https://linkedin.com/in/…" />
            </label>
            <div className="filter-actions">
              <button type="submit">Add</button>
            </div>
          </form>
          <p className="note" style={{ padding: "0 var(--space-3) var(--space-3)" }}>
            Type or paste the name yourself. This app makes no request to LinkedIn,
            authenticated or otherwise — the URL is stored for your reference and never
            fetched. LinkedIn bans accounts for automated access, and the account at risk
            would be yours.
          </p>
        </details>

        {contacts.length === 0 ? (
          <p className="note">
            Nobody yet. Add a recruiter or a hiring manager above, then run discovery to
            work out their address.
          </p>
        ) : null}

        {needsYou.length > 0 ? (
          <section>
            <h2>Needs you</h2>
            {needsYou.map((contact) => (
              <ContactCard contact={contact} now={now} key={contact.id} />
            ))}
          </section>
        ) : null}

        {settled.length > 0 ? (
          <section>
            <h2>Nothing outstanding</h2>
            {settled.map((contact) => (
              <ContactCard contact={contact} now={now} key={contact.id} />
            ))}
          </section>
        ) : null}

        <section>
          <h2>How an address is guessed</h2>
          <p className="note">
            A domain with no MX record accepts no mail, so the pipeline stops there. Past
            that it permutes the name into the ten commonest address patterns, ranks them,
            and checks what it can for free: a Gravatar hit proves an address is real, a
            miss proves nothing at all. Hunter, if you have given it a key under
            Preferences → Contact finder, adds a verified address and the domain&rsquo;s
            known pattern. The first confirmed address at a company turns every later
            contact there from ten guesses into one.
          </p>
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 16.12: Add the `ContactCard` component to the bottom of `src/app/contacts/page.tsx`.**
  Same file, below the default export — the thread renderer and the always-present
  copy path. Not a separate file: it is not reused anywhere and splitting it would
  only add an import.

  ```tsx
  type ContactRow = Awaited<ReturnType<typeof loadContacts>>[number];

  /**
   * Declared so ContactCard can be typed against exactly the shape the page
   * queries, without restating the include block or reaching for Prisma's
   * generated payload types.
   */
  function loadContacts() {
    return db.contact.findMany({
      include: {
        company: { select: { name: true } },
        emails: true,
        outreach: { include: { email: { select: { address: true } } } },
      },
    });
  }

  function ContactCard({ contact, now }: { contact: ContactRow; now: Date }) {
    const best = contact.emails.find((email) => email.status !== "BOUNCED") ?? null;

    return (
      <article className="card">
        <div className="card-status">
          <strong>
            {contact.firstName} {contact.lastName}
          </strong>
          {best ? (
            <span
              className={confidenceBadgeClass(best.confidence)}
              title={`${best.confidence}/100 — how likely this address is to be real`}
            >
              {confidenceLabel(best.confidence)}
            </span>
          ) : (
            <span className="badge badge-closed" title="No address worked out yet">
              {CONFIDENCE_UNKNOWN}
            </span>
          )}
        </div>

        <p className="card-sub">
          {contact.title ?? "—"} · {contact.company?.name ?? contact.domain}
          {contact.linkedinUrl ? (
            <>
              {" · "}
              <a href={contact.linkedinUrl} target="_blank" rel="noreferrer">
                LinkedIn
              </a>
            </>
          ) : null}
        </p>

        {contact.emails.length > 0 ? (
          <ul className="note">
            {contact.emails.slice(0, 5).map((email) => (
              <li key={email.id}>
                <code>{email.address}</code>{" "}
                <span
                  className={emailStatusBadgeClass(email.status as EmailStatusName)}
                  title={
                    email.checkedAt
                      ? `Last checked ${formatAge(email.checkedAt, now)}`
                      : "Never checked"
                  }
                >
                  {email.status.toLowerCase().replace(/_/g, " ")}
                </span>{" "}
                <span className="tabular">{email.confidence}/100</span>
              </li>
            ))}
            {contact.emails.length > 5 ? (
              <li className="note">
                and {contact.emails.length - 5} lower-ranked candidate
                {contact.emails.length - 5 === 1 ? "" : "s"}
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="note">No addresses yet.</p>
        )}

        <div className="card-actions">
          <form action={discoverContactAction}>
            <input type="hidden" name="id" value={contact.id} />
            <button type="submit" className="small-button">
              {contact.emails.length > 0 ? "Re-run discovery" : "Find address"}
            </button>
          </form>
          <form action={draftMessageAction}>
            <input type="hidden" name="id" value={contact.id} />
            <button type="submit" className="small-button" disabled={best === null}>
              {contact.outreach.length > 0 ? "Draft a follow-up" : "Draft an introduction"}
            </button>
          </form>
        </div>

        {/* The whole thread, always. OutreachMessage has no unique constraint —
            a follow-up is deliberately a second row — so this list is the only
            thing standing between the candidate and introducing himself twice
            to the same person. It is not collapsed and it is not truncated. */}
        {contact.outreach.length > 0 ? (
          <div className="stack">
            <p className="note">
              <strong>
                {contact.outreach.length} message
                {contact.outreach.length === 1 ? "" : "s"} to this person
              </strong>{" "}
              — read this before drafting another.
            </p>
            {contact.outreach.map((message) => (
              <details className="card" key={message.id} open={message.status === "DRAFT"}>
                <summary>
                  <span className={outreachStatusBadgeClass(message.status as OutreachStatusName)}>
                    {message.status.toLowerCase()}
                  </span>{" "}
                  {message.subject} · <code>{message.email.address}</code> ·{" "}
                  {formatAge(message.draftedAt, now)}
                  {message.followUpAt ? (
                    <>
                      {" · "}
                      <span
                        className={
                          followUpDue(message.followUpAt, now)
                            ? "badge badge-ambiguous"
                            : "badge badge-closed"
                        }
                      >
                        {followUpLabel(message.followUpAt, now)}
                      </span>
                    </>
                  ) : null}
                </summary>

                <p className="note">
                  {message.draftFolder
                    ? `Written to ${message.draftFolder} in your mailbox.`
                    : "Not in your mailbox — copy it from here."}
                </p>

                {/* The copy path is unconditional. It is rendered whether or
                    not IMAP is configured and whether or not an APPEND ever
                    succeeded, because a candidate with no mailbox at all must
                    still be able to use this feature (design §7). The textarea
                    is the fallback to the fallback: navigator.clipboard needs a
                    secure context and can be blocked outright. */}
                <label className="field field-wide">
                  <span>Subject</span>
                  <input type="text" readOnly value={message.subject} />
                </label>
                <label className="field field-wide">
                  <span>Message</span>
                  <textarea readOnly rows={12} value={message.body} />
                </label>

                <div className="card-actions">
                  <CopyButton text={message.body} label="Copy message" />
                  <CopyButton text={message.subject} label="Copy subject" />
                  <form action={pushDraftAction}>
                    <input type="hidden" name="id" value={message.id} />
                    <button type="submit" className="small-button">
                      Put in Drafts
                    </button>
                  </form>
                  {message.status === "DRAFT" ? (
                    <form action={markSentAction}>
                      <input type="hidden" name="id" value={message.id} />
                      <button type="submit" className="small-button">
                        I sent this
                      </button>
                    </form>
                  ) : null}
                  <form action={setFollowUpAction} className="inline-form">
                    <input type="hidden" name="id" value={message.id} />
                    <input
                      type="date"
                      name="followUpAt"
                      defaultValue={
                        message.followUpAt
                          ? message.followUpAt.toISOString().slice(0, 10)
                          : ""
                      }
                      aria-label={`Follow-up date for "${message.subject}"`}
                    />
                    <button type="submit" className="small-button">
                      Set
                    </button>
                  </form>
                </div>

                <p className="note">
                  &ldquo;I sent this&rdquo; is what lets a bounce be matched back to this
                  message — the watcher only reads mail that arrives after you press it.
                  Forgetting means a wrong address stays scored as merely unproven.
                </p>
              </details>
            ))}
          </div>
        ) : null}
      </article>
    );
  }
  ```

- [ ] **Step 16.13: Write `src/app/contacts/loading.tsx`.**
  Matches `src/app/applications/loading.tsx` and `src/app/jobs/loading.tsx`
  exactly, which are three lines each over the shared `PageLoading`.

  ```tsx
  import { PageLoading } from "../page-loading";

  export default function ContactsLoading() {
    return <PageLoading label="Loading contacts" rows={3} />;
  }
  ```

- [ ] **Step 16.14 [COORDINATOR — SHARED FILE]: Add the `contacts` icon to `src/app/ui-icon.tsx`.**
  Insert one line into the `paths` object (`src/app/ui-icon.tsx:3-23`), directly
  after the `compass` entry on line 21. **Do not assign this to a parallel
  implementation agent** — Codex edits this file.

  ```ts
    contacts: "M13 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0 M2 20v-1.5a7.5 7.5 0 0 1 15 0V20 M17 5.5a3 3 0 0 1 0 6 M19 20v-1.5a5 5 0 0 0-2-4",
  ```

- [ ] **Step 16.15 [COORDINATOR — SHARED FILE]: Add the nav item to `src/app/site-nav.tsx`.**
  One line into the **Workspace** group's `items` array
  (`src/app/site-nav.tsx:28-34`), directly after the `/companies` entry on line
  32. The breadcrumb derives from `GROUPS` automatically, so nothing else
  changes. **Do not assign this to a parallel implementation agent.**

  ```tsx
        { href: "/contacts", label: "People", icon: "contacts" },
  ```

- [ ] **Step 16.16: Type-check.**
  `npm run typecheck`
  Expect zero errors. **Do not run `npm run build` if `npm run dev` is running.**
  Fix any error here rather than in the browser; this is the only static gate
  the page and actions get.

- [ ] **Step 16.17: Run the whole unit suite.**
  `npm test`
  Expect green, including the new `src/app/contacts/format.test.ts`.

- [ ] **Step 16.18: Manual browser check — the exact clicks.**
  `npm run dev`, then in a browser:

  1. Open `http://localhost:3000/contacts`. **Expect:** the page renders, the
     sidebar shows **People** under *Workspace* and it is highlighted, and the
     breadcrumb reads `Workspace / People`.
  2. The "Add a contact" panel is **open** (it auto-opens when the list is
     empty). Fill it as: First name `Jane`, Last name `Okafor`, Title
     `University Recruiter`, Mail domain `https://www.acme.com/careers`,
     LinkedIn URL blank. Submit. **Expect:** a green `notice notice-ok` reading
     `Added Jane Okafor at acme.com…` — the scheme, the `www.` and the trailing
     path are all stripped before the domain is stored.
  3. Submit the form again with the **Mail domain** box set to `acme` (no dot).
     **Expect:** a red `notice notice-error` reading
     `"acme" is not a mail domain. Give the part after the @ — for example acme.com.`
  4. Submit again with a **LinkedIn URL** of `https://example.com/jane`.
     **Expect:** a red notice about it not looking like a LinkedIn URL.
  5. On the new contact's card, click **Find address**. **Expect:** either a
     green notice naming the best candidate and its score, or a green notice
     saying nothing at that domain answered — **never a red one**; a domain with
     no MX is an ordinary outcome.
  6. Click **Draft an introduction**. **Expect:** a green notice, and the card
     now shows `1 message to this person` with the draft expanded (drafts render
     `open`), a `draft` badge in `badge-closed` grey, a readonly subject box and
     a readonly 12-row message box.
  7. Click **Copy message**. **Expect:** the button reads `Copied` for three
     seconds; paste into any editor and confirm the body matches. If the button
     instead reads `Select it below`, clipboard access was denied — confirm the
     textarea still holds the full text and can be selected by hand.
  8. Click **Put in Drafts** with no mailbox configured. **Expect:** a red notice
     pointing at Preferences → Mailbox — **and the copy box is still there**.
     That is the requirement being checked: the copy path is not a failure
     branch.
  9. With a mailbox configured, click **Put in Drafts** again. **Expect:** a
     green notice naming the folder (`[Gmail]/Drafts` on Gmail), the card line
     changes to `Written to … in your mailbox.`, and the message is actually
     present in that folder in your mail client.
  10. Click **Draft a follow-up** on the same contact. **Expect:** the thread now
      lists **two** messages, newest first. This is the §13 guard: both are
      visible, neither is collapsed away.
  11. Click **I sent this** on one. **Expect:** a green notice naming the
      address, the badge flips to `sent` in accent colour, and the **I sent
      this** button disappears for that message. Click it on the same message
      again via the browser back button. **Expect:** a red notice reading
      `That message is already marked as sent.`
  12. Set a follow-up date of **yesterday** and press **Set**. **Expect:** a
      green notice, and the thread summary shows a warning-tinted
      `follow up was yesterday` badge. Set one for **next week**. **Expect:** a
      grey `follow up in 7d` badge.
  13. Clear the date box and press **Set**. **Expect:** `Follow-up cleared.`
  14. Reload with everything settled (all messages `SENT`, no due follow-ups).
      **Expect:** the contact moves from the **Needs you** section to **Nothing
      outstanding**.
  15. Shrink the window to phone width. **Expect:** the table-free card layout
      reflows, no horizontal page scroll, and the mobile menu lists **People**.

- [ ] **Step 16.19: Commit.**
  Prose imperative subject, matching `git log --oneline -10`. Suggested:
  `Reach a person, not just a board` — or, if the coordinator has already
  committed the nav and icon lines separately, `Show every message already sent
  to a contact`.

---

### Task 17: Hunter API key settings screen

**Files:**
- Modify: `src/lib/email/env-file.ts:23-36` (add `WritableEnvVar`, widen the
  `writeEnvVars` parameter type; **`MailboxVar` itself gains no members**)
- Create: `src/lib/outreach/env-file.ts`
- Create: `src/lib/outreach/env-file.test.ts`
- Create: `src/app/settings/outreach/page.tsx`
- Create: `src/app/settings/outreach/actions.ts`
- Modify: `src/app/site-nav.tsx:36-42` — **SHARED, coordinator only**
- Modify: `src/app/ui-icon.tsx:3-23` — **SHARED, coordinator only**
- Test: `src/lib/outreach/env-file.test.ts`

**Interfaces:**
- Consumes: `writeEnvVars(values, path?)` and `ENV_PATH` from
  `@/lib/email/env-file`; `requireAccess()` from `@/lib/auth/guard`;
  `hunterConfigured(env?)` from `@/lib/contacts/hunter` *(for the "have we ever
  actually called Hunter" note only — optional, drop the import if that task
  named it differently)*.
- Produces: `src/lib/outreach/env-file.ts` → `type OutreachVar`,
  `writeOutreachVars`, `hunterStatus`, `interface HunterStatus`;
  `src/app/settings/outreach/actions.ts` → `saveHunterKeyAction`,
  `clearHunterKeyAction`; `src/app/settings/outreach/page.tsx` → default
  `OutreachSettingsPage`, `dynamic`, `metadata`.
  `src/lib/email/env-file.ts` additionally exports `type WritableEnvVar`.

**Decisions to record before writing code:**

1. **Where `OutreachVar` lives: a new `src/lib/outreach/env-file.ts`.**
   Not `src/lib/email/env-file.ts`. The reason is the one the design gives for
   the union existing at all (§1: *"`MailboxVar` gains no members — outreach
   owns a separate `OutreachVar = "HUNTER_API_KEY"` union so the two screens
   cannot write each other's variables"*). A union declared in the mailbox's own
   file is one careless `|` away from being folded into `MailboxVar`, and the
   whole point is that the two are separate. It also puts the accessor beside
   the rest of `src/lib/outreach/`, where a reader looking for outreach config
   will look. Nothing is renamed: `MailboxVar`, `mailboxStatus`, `ENV_PATH` and
   `writeEnvVars` all keep their names and all existing call sites compile
   unchanged.

2. **`writeEnvVars`'s parameter widens from `Partial<Record<MailboxVar, string>>`
   to `Partial<Record<WritableEnvVar, string>>`, where
   `WritableEnvVar = MailboxVar | "HUNTER_API_KEY"`.** It has to widen — it is
   the only function that edits `.env` in place, and duplicating its
   read-rewrite-chmod logic for one more key would be a second implementation of
   the thing that once destroyed the real `.env`. The union is spelled out
   literally rather than importing `OutreachVar` from `src/lib/outreach/`,
   because a type import from the mailbox module into the outreach module and
   back is a cycle for no benefit. The *separation* the spec asks for is then
   enforced one level up by the narrow wrapper `writeOutreachVars`, which the
   outreach screen calls and which cannot express an `IMAP_*` key at all. A
   matching `writeMailboxVars` wrapper would tighten the mailbox side the same
   way; it is deliberately **not** added here, because changing
   `src/app/settings/mailbox/actions.ts` is outside this feature and that file
   is in Codex's lane.

3. **Route: `/settings/outreach`, labelled "Contact finder".** Not
   `/settings/hunter`: the screen is about the feature, not the vendor, and §1
   is explicit that the free path is the default and the fallback rather than a
   degraded mode — a page named after the paid vendor would say the opposite.
   The directory also has somewhere to grow if outreach ever gains a second
   setting.

4. **`hunterStatus()` returns `{ configured: boolean }` and nothing else.** No
   key, no prefix, no length, no masked preview. `mailboxStatus` is the
   precedent (`src/lib/email/env-file.ts:85-99`: *"Never the password itself. A
   settings page that renders a secret into HTML puts it in the browser's
   history, in any screenshot, and in the page source."*). The mailbox status
   returns `host`/`user`/`port` because those are not secrets; an API key has no
   non-secret part, so the object has exactly one field.

---

- [ ] **Step 17.1: Widen `writeEnvVars` in `src/lib/email/env-file.ts`.**
  Two edits inside lines 23-36. `MailboxVar` on line 24 is **unchanged**.

  Insert after line 24 (the `MailboxVar` declaration):

  ```ts
  /**
   * Every variable a settings screen in this app is allowed to write.
   *
   * MailboxVar deliberately gains no members: the outreach screen owns a
   * separate OutreachVar union in src/lib/outreach/env-file.ts, so neither
   * screen's form can write the other's variables. This union exists only so
   * that writeEnvVars — the one function that edits .env in place — has a
   * single allowlist of keys, which is what stops a typo becoming a new line
   * appended to the file holding every other secret in the project.
   */
  export type WritableEnvVar = MailboxVar | "HUNTER_API_KEY";
  ```

  Then change the parameter type on line 33 from
  `values: Partial<Record<MailboxVar, string>>,` to:

  ```ts
    values: Partial<Record<WritableEnvVar, string>>,
  ```

  Nothing else in the file changes. In particular the `NODE_ENV === "test"`
  guard at lines 46-50 stays exactly as written.

- [ ] **Step 17.2: Type-check that the widening broke nothing.**
  `npm run typecheck`
  Expect zero errors — `src/app/settings/mailbox/actions.ts:51` still compiles,
  because `Partial<Record<MailboxVar, string>>` is assignable to the wider type.

- [ ] **Step 17.3: Create `src/lib/outreach/env-file.ts`.**

  ```ts
  /**
   * The Hunter key, and nothing else.
   *
   * Hunter is the optional paid half of a hybrid design: the free path — MX
   * lookup, name permutation, Gravatar, bounce feedback and a learned
   * per-domain pattern — is the default AND the fallback, never a degraded mode
   * that has to be opted into (design §1). A key here buys a verified address
   * and the domain's known pattern when Hunter has them; without one the
   * feature works, just less certainly.
   *
   * The key lives in .env like every other secret in this project, written by
   * the settings screen through writeEnvVars, never in Postgres, and never read
   * back to the browser.
   *
   * OutreachVar is a separate union from MailboxVar on purpose. Two settings
   * screens write to the same .env file, and neither should be able to express
   * the other's variables: this file's writeOutreachVars cannot name IMAP_*,
   * and the mailbox screen's values cannot name HUNTER_API_KEY.
   */

  import { writeEnvVars } from "@/lib/email/env-file";

  /** The variables the outreach screen owns. Nothing else in .env is touched. */
  export type OutreachVar = "HUNTER_API_KEY";

  /**
   * Set the outreach variables, leaving the rest of .env exactly as it was.
   *
   * A thin wrapper over writeEnvVars rather than a second implementation: that
   * function's in-place rewrite is the only code in this project that edits the
   * file holding DATABASE_URL, and a second copy of it is a second chance to
   * get it wrong. Note the explicit `path` pass-through — writeEnvVars throws
   * when NODE_ENV is "test" and the path is the real .env, and a test that
   * calls this must supply a temporary file (see env-file.ts:46-50 for the
   * incident that guard exists because of).
   */
  export function writeOutreachVars(
    values: Partial<Record<OutreachVar, string>>,
    path?: string,
  ): void {
    if (path === undefined) writeEnvVars(values);
    else writeEnvVars(values, path);
  }

  /**
   * What the settings screen is allowed to know about the stored key.
   *
   * One boolean, and deliberately nothing else. mailboxStatus can return a host
   * and an address because those are not secrets; an API key has no non-secret
   * part, so there is nothing here to return but whether one exists. No masked
   * preview, no first four characters, no length — each of those is a real
   * clue, and all of them end up in the page source, the browser history and
   * every screenshot.
   */
  export interface HunterStatus {
    configured: boolean;
  }

  export function hunterStatus(
    env: Record<string, string | undefined> = process.env,
  ): HunterStatus {
    const key = env.HUNTER_API_KEY?.trim();
    // .env.example ships HUNTER_API_KEY="" (line 37). An empty string means the
    // placeholder is still there, which is not a configured key.
    return { configured: Boolean(key && key.length > 0) };
  }
  ```

- [ ] **Step 17.4: Create `src/lib/outreach/env-file.test.ts`.**
  Unit-tests the pure parts only — the union and `hunterStatus` — plus one write
  test against a temporary file. **Every `writeOutreachVars` call passes an
  explicit path**, respecting `src/lib/email/env-file.ts:46-50`. Mirrors the
  structure of `src/lib/email/env-file.test.ts`.

  ```ts
  /**
   * The Hunter key's .env handling.
   *
   * Two things are worth asserting and nothing else is: that the status object
   * cannot leak the key, and that writing it leaves the rest of .env alone.
   *
   * Every write here goes to a temp file created with mkdtempSync. writeEnvVars
   * throws if a test aims at the real .env (env-file.ts:46-50), and that guard
   * exists because an earlier test did exactly that and replaced the project's
   * .env with two lines, destroying DATABASE_URL. Do not remove the explicit
   * path arguments below.
   */

  import { describe, expect, it, beforeEach, afterEach } from "vitest";
  import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { hunterStatus, writeOutreachVars } from "./env-file";

  describe("hunterStatus", () => {
    it("is unconfigured when the variable is absent", () => {
      expect(hunterStatus({}).configured).toBe(false);
    });

    // .env.example ships HUNTER_API_KEY="" — dotenv loads that as an empty
    // string, which is the placeholder still sitting there, not a key.
    it("is unconfigured when the variable is the empty placeholder", () => {
      expect(hunterStatus({ HUNTER_API_KEY: "" }).configured).toBe(false);
      expect(hunterStatus({ HUNTER_API_KEY: "   " }).configured).toBe(false);
    });

    it("is configured when a key is present", () => {
      expect(hunterStatus({ HUNTER_API_KEY: "abc123" }).configured).toBe(true);
    });

    // The key must never be part of what this returns. A settings page that
    // renders a secret puts it in the browser history and in every screenshot.
    it("never returns the key, in any field", () => {
      const status = hunterStatus({ HUNTER_API_KEY: "super-secret-hunter-key" });
      expect(status.configured).toBe(true);
      expect(JSON.stringify(status)).not.toContain("super-secret-hunter-key");
      expect(Object.keys(status)).toEqual(["configured"]);
    });
  });

  describe("writeOutreachVars", () => {
    let dir: string;
    let path: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "outreach-env-"));
      path = join(dir, ".env");
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("leaves every other secret and comment in the file untouched", () => {
      writeFileSync(
        path,
        [
          "# Database",
          "DATABASE_URL=postgres://localhost/autopilot",
          "",
          "# Mailbox",
          "IMAP_HOST=imap.gmail.com",
          "IMAP_PASSWORD=app-password",
          "",
          "# Contact finder",
          'HUNTER_API_KEY=""',
        ].join("\n"),
        "utf8",
      );

      writeOutreachVars({ HUNTER_API_KEY: "new-key" }, path);

      const after = readFileSync(path, "utf8");
      expect(after).toContain("DATABASE_URL=postgres://localhost/autopilot");
      expect(after).toContain("IMAP_PASSWORD=app-password");
      expect(after).toContain("# Contact finder");
      expect(after).toContain("HUNTER_API_KEY=new-key");
      expect(after).not.toContain('HUNTER_API_KEY=""');
    });

    it("appends the key when the file does not mention it yet", () => {
      writeFileSync(path, "DATABASE_URL=postgres://localhost/autopilot\n", "utf8");
      writeOutreachVars({ HUNTER_API_KEY: "k" }, path);
      const after = readFileSync(path, "utf8");
      expect(after).toContain("DATABASE_URL=postgres://localhost/autopilot");
      expect(after).toContain("HUNTER_API_KEY=k");
    });
  });
  ```

- [ ] **Step 17.5: Run the new test.**
  `npx vitest run src/lib/outreach/env-file.test.ts`
  Expect green. If it fails with *"writeEnvVars refused: a test tried to write
  to the real .env"*, a `path` argument was dropped — restore it; do not relax
  the guard.

- [ ] **Step 17.6: Create `src/app/settings/outreach/actions.ts`.**

  ```ts
  "use server";

  /**
   * Saving the Hunter API key.
   *
   * Writes to .env rather than the database, matching how every other secret in
   * this project is held: .env is gitignored, a database dump is not.
   *
   * Nothing here ever sends the key back to the browser. The screen learns
   * whether one is set — never its value.
   */

  import { revalidatePath } from "next/cache";
  import { redirect } from "next/navigation";
  import { writeOutreachVars } from "@/lib/outreach/env-file";

  // Next.js dispatches server actions by action ID, not by route, so a POST to any
  // path the middleware skips can still reach the actions below. The check has to
  // live in each action itself; middleware cannot be the boundary for these.
  import { requireAccess } from "@/lib/auth/guard";

  function back(params: Record<string, string>): never {
    redirect(`/settings/outreach?${new URLSearchParams(params).toString()}`);
  }

  function text(form: FormData, field: string): string {
    return String(form.get(field) ?? "").trim();
  }

  export async function saveHunterKeyAction(form: FormData): Promise<void> {
    await requireAccess();

    // Whitespace only, not the /\s+/g strip the mailbox screen applies to
    // Google app passwords: those are displayed in groups of four and pasted
    // with spaces in them, whereas a Hunter key is one opaque token and an
    // internal space in it would be a real character we must not silently eat.
    const key = text(form, "key");

    if (key.length === 0) {
      // An empty box means "leave the stored key alone", not "erase it" — the
      // field renders blank every time precisely because the value is never
      // sent to the browser, so treating blank as a deletion would wipe the key
      // any time this form was submitted for any other reason. Clearing it is
      // its own button.
      back({ saved: "Nothing changed — the box was blank, so the stored key was kept." });
    }

    writeOutreachVars({ HUNTER_API_KEY: key });

    // The running process keeps its own copy of the environment, and .env is
    // only read at startup. Updating it in place here means the very next
    // discovery run uses the key just saved rather than whatever was loaded
    // when the server booted.
    process.env.HUNTER_API_KEY = key;

    revalidatePath("/settings/outreach");
    back({ saved: "Key saved to .env. Discovery will use Hunter from the next run." });
  }

  /**
   * Remove the key.
   *
   * Its own button rather than a blank submit, because blank has to mean "keep"
   * for the reason above. Removing it is not a failure state: the free path is
   * the default and the fallback, and the feature keeps working without Hunter.
   */
  export async function clearHunterKeyAction(): Promise<void> {
    await requireAccess();

    writeOutreachVars({ HUNTER_API_KEY: "" });
    process.env.HUNTER_API_KEY = "";

    revalidatePath("/settings/outreach");
    back({
      saved:
        "Key removed. Discovery falls back to the free path — MX, name permutation, " +
        "Gravatar and bounce feedback.",
    });
  }
  ```

- [ ] **Step 17.7: Create `src/app/settings/outreach/page.tsx`.**
  Mirrors `src/app/settings/mailbox/page.tsx` structurally: `force-dynamic`,
  `metadata`, `searchParams` awaited, a status notice, an `import-panel` section
  with an `entry-form`, and a password field that is **always rendered blank**.
  No `loading.tsx` — neither `settings/mailbox` nor `settings/ai` has one.

  ```tsx
  /**
   * Contact finder settings.
   *
   * One optional key. Hunter returns verified addresses and a domain's known
   * address pattern; without it the contact finder falls back to MX lookup,
   * name permutation, Gravatar and bounce feedback, which is the default path
   * rather than a degraded one (design §1).
   *
   * The key goes into .env, not the database — every other secret in this
   * project lives there, .env is gitignored, and a database dump is not.
   */

  import { hunterStatus } from "@/lib/outreach/env-file";
  import { clearHunterKeyAction, saveHunterKeyAction } from "./actions";

  export const dynamic = "force-dynamic";

  export const metadata = {
    title: "Contact finder — Internship Autopilot",
  };

  interface PageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }

  function one(params: Record<string, string | string[] | undefined>, key: string) {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  }

  export default async function OutreachSettingsPage({ searchParams }: PageProps) {
    const params = await searchParams;
    const saved = one(params, "saved");
    const error = one(params, "error");

    const status = hunterStatus();

    return (
      <main className="page">
        <h1>Contact finder</h1>
        <p className="lede">
          An optional key that buys verified addresses instead of ranked guesses.
          Everything on <a href="/contacts">Contacts</a> works without it.
        </p>

        {saved ? <div className="notice notice-ok">{saved}</div> : null}
        {error ? <div className="notice notice-error">{error}</div> : null}

        <div className={status.configured ? "notice notice-ok" : "notice"}>
          {status.configured ? (
            <>
              <strong>Configured.</strong> A key is stored in .env. That means one is
              present — not that it works or has quota left; the first discovery run that
              uses it will say.
            </>
          ) : (
            <>
              <strong>Not configured, and that is a supported way to run.</strong>{" "}
              Discovery uses the free path: a domain&rsquo;s MX record, the ten commonest
              name patterns ranked by how often each is used, a Gravatar probe, and what
              the bounces teach. The first confirmed address at a company makes every
              later contact there nearly free.
            </>
          )}
        </div>

        <section className="import-panel">
          <h2>API key</h2>
          <p className="note">
            Get one at{" "}
            <a href="https://hunter.io/api-keys" target="_blank" rel="noreferrer">
              hunter.io/api-keys
            </a>
            . The free tier is small, so the app never spends a call on a question it has
            already answered: a domain&rsquo;s pattern is looked up once and stored, and an
            address that has already been confirmed or has already bounced is never
            re-verified.
          </p>

          <form action={saveHunterKeyAction} className="entry-form">
            <label className="field">
              <span>Hunter API key</span>
              <input
                type="password"
                name="key"
                autoComplete="off"
                placeholder={status.configured ? "•••••••• (leave blank to keep)" : ""}
              />
              <small>
                {status.configured
                  ? "One is already stored. This box is blank because the key is never sent to your browser — leave it empty to keep it."
                  : "Stored in .env, which is gitignored."}
              </small>
            </label>
            <button type="submit" className="small-button">
              Save
            </button>
          </form>
        </section>

        <section className="import-panel">
          <h2>Remove it</h2>
          <p className="note">
            Clearing the key is not breaking anything — the contact finder keeps working on
            the free path. Leaving the box above blank <em>keeps</em> the stored key, so
            removing it needs its own button.
          </p>
          <form action={clearHunterKeyAction}>
            <button type="submit" className="small-button" disabled={!status.configured}>
              Remove stored key
            </button>
          </form>
        </section>

        <section className="import-panel">
          <h2>What the key is used for</h2>
          <ul className="note">
            <li>
              <strong>The domain&rsquo;s address pattern</strong>, looked up once per domain
              and stored, so the next person at that company costs nothing.
            </li>
            <li>
              <strong>A known address</strong>, when Hunter has one for that name at that
              domain — used in place of the top-ranked guess.
            </li>
            <li>
              <strong>Verification</strong> of one candidate address, skipped entirely for
              any address already confirmed by a reply or ruled out by a bounce.
            </li>
          </ul>
          <p className="note">
            LinkedIn is never contacted, with or without this key. Names enter the system
            because a human typed or pasted them.
          </p>
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 17.8 [COORDINATOR — SHARED FILE]: Add the `find` icon to `src/app/ui-icon.tsx`.**
  One more line in the `paths` object (`src/app/ui-icon.tsx:3-23`), after the
  `contacts` entry added in Step 16.14. **Do not assign to a parallel agent.**

  ```ts
    find: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 3v3 M12 18v3 M3 12h3 M18 12h3 M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  ```

- [ ] **Step 17.9 [COORDINATOR — SHARED FILE]: Add the nav item to `src/app/site-nav.tsx`.**
  One line into the **Preferences** group's `items` array
  (`src/app/site-nav.tsx:36-42`), directly after the `/settings/mailbox` entry on
  line 40. **Do not assign to a parallel agent.**

  ```tsx
        { href: "/settings/outreach", label: "Contact finder", icon: "find" },
  ```

  Note the ordering hazard: the `Preferences` group's first entry is
  `{ href: "/settings", …, exact: true }`. `active()` at
  `src/app/site-nav.tsx:45-47` only prefix-matches non-`exact` items, so
  `/settings/outreach` will not light up `/settings` — this works because the
  `exact: true` flag is already there. Do not remove it.

- [ ] **Step 17.10: Type-check.**
  `npm run typecheck` — expect zero errors. Again: not `npm run build` while
  `npm run dev` is up.

- [ ] **Step 17.11: Run the whole unit suite.**
  `npm test` — expect green, including `src/lib/outreach/env-file.test.ts` and
  the existing `src/lib/email/env-file.test.ts` (the widening in Step 17.1 must
  not have disturbed it).

- [ ] **Step 17.12: Confirm the real `.env` was not touched by the test run.**
  `git status --short .env` — expect **no output** (`.env` is gitignored, so also
  confirm by eye that `DATABASE_URL` is still in it:
  `grep -c DATABASE_URL .env` should print `1`). This check exists because the
  guard it is checking exists because this went wrong once.

- [ ] **Step 17.13: Manual browser check — the exact clicks.**
  `npm run dev`, then:

  1. Open `http://localhost:3000/settings/outreach`. **Expect:** sidebar shows
     **Contact finder** under *Preferences*, highlighted; breadcrumb reads
     `Preferences / Contact finder`; **Auto-apply** (`/settings`) is **not**
     also highlighted.
  2. With no key set. **Expect:** a neutral (not green, not red) `notice` headed
     *"Not configured, and that is a supported way to run."*, and the **Remove
     stored key** button is disabled.
  3. Type a fake key `test-key-123` into the **Hunter API key** box and **Save**.
     **Expect:** a green notice *"Key saved to .env…"*; the status notice turns
     green and reads *"Configured."*; the input is **blank again** with the
     placeholder `•••••••• (leave blank to keep)`; **Remove stored key** is now
     enabled.
  4. View source on the page (Ctrl+U) and search for `test-key-123`. **Expect:
     zero matches.** This is the requirement, not a nicety: the key must never
     reach the browser.
  5. `grep -n HUNTER_API_KEY .env` in a terminal. **Expect:** exactly one line,
     `HUNTER_API_KEY=test-key-123`, and every other line of `.env` unchanged
     (`git diff` is useless here since `.env` is gitignored — compare against a
     copy you took first, or just confirm `DATABASE_URL` and `IMAP_*` are all
     still present).
  6. Press **Save** with the box **blank**. **Expect:** a green notice
     *"Nothing changed — the box was blank, so the stored key was kept."*, and
     `grep HUNTER_API_KEY .env` still shows `test-key-123`. This is the
     regression that matters most on this screen: a blank submit must never wipe
     the stored secret.
  7. Press **Remove stored key**. **Expect:** a green notice about falling back
     to the free path; the status notice returns to neutral; `.env` now reads
     `HUNTER_API_KEY=` (empty), and the button is disabled again.
  8. Save a real key if you have one, then go to `/contacts` and run **Find
     address** on a contact at a domain Hunter knows. **Expect:** the discovery
     notice reports a higher-confidence best candidate than the same run without
     a key. Without a real key, skip this step rather than faking it.
  9. Shrink the window to phone width. **Expect:** the form stacks, no
     horizontal page scroll, and the mobile menu lists **Contact finder**.

- [ ] **Step 17.14: Commit.**
  Prose imperative subject. Suggested: `Let Hunter help without letting it be
  required`.

---

## Section F verification summary

| What | How | Automated? |
|---|---|---|
| `src/app/contacts/format.ts` | `npx vitest run src/app/contacts/format.test.ts` | yes |
| `src/lib/outreach/env-file.ts` | `npx vitest run src/lib/outreach/env-file.test.ts` | yes |
| `writeEnvVars` widening broke nothing | `npm test` (existing `src/lib/email/env-file.test.ts`) | yes |
| Every page, action and the copy button | `npm run typecheck` + Steps 16.18 and 17.13 | **no — manual** |
| The real `.env` survived the test run | Step 17.12 | manual, one command |

There is no component test and no E2E test in this section, because there is no
harness for either in this repository and adding one is not this feature's
decision to make.

---

## Phase 6 — Wiring the watcher

> **Why this task exists.** Task 15 specifies `watchOnce` completely and tests it
> against a stubbed `WatchDeps`. Nothing else in the plan implements those stubs.
> Two of the six members — `listAwaitingMessages` and `promoteNextBest` — are
> exported by no store, and there is no `liveWatchDeps` factory and no runner, so
> the watcher as planned could be built, fully tested, and still never run. Task 12
> has its `liveDeps(db)`; this is the same seam for Task 15.
>
> Found during plan self-review, not during drafting — it is exactly the kind of
> gap that opens when two authors each build to an agreed interface and neither
> owns the join.

### Task 18: Wire the bounce watcher to the real stores

**Files:**
- Modify: `src/lib/outreach/store.ts` — add `listAwaitingMessages`
- Modify: `src/lib/contacts/store.ts` — add `promoteNextBest`
- Modify: `src/lib/outreach/watch.ts` — add `liveWatchDeps`
- Create: `scripts/watch-outreach.ts`
- Modify: `package.json` — add the `outreach:watch` script
- Test: `src/lib/outreach/store.test.ts`, `src/lib/contacts/store.test.ts` (both extended)

**Interfaces:**

- **Consumes:**
  - From Task 11: `recordBounce(db, messageId, { hard }, at?)`, `recordReply(db, messageId, at?)`
  - From Task 10: `confirmEmailPattern(db, domain, pattern)`, `updateEmailStatus(db, emailId, status, confidence?)`
  - From Task 15: `WatchDeps`, `WatchedMessage`, `IncomingMessage`, `watchOnce(config, deps)`
  - From `src/lib/email/inbox.ts`: `type InboxConfig`, `inboxConfig(env?)`
- **Produces:**
  ```ts
  // src/lib/outreach/store.ts
  export type AwaitingMessage = OutreachMessage & { contact: Contact; email: ContactEmail };
  export async function listAwaitingMessages(db: PrismaClient): Promise<AwaitingMessage[]>;

  // src/lib/contacts/store.ts
  export async function promoteNextBest(
    db: PrismaClient, contactId: string, bouncedEmailId: string,
  ): Promise<string | null>;

  // src/lib/outreach/watch.ts
  export function liveWatchDeps(db: PrismaClient): WatchDeps;
  ```

**Import direction — decide it here so it cannot drift.** `listAwaitingMessages`
returns Prisma rows, *not* `WatchedMessage`. The mapping to `WatchedMessage`
happens in `liveWatchDeps` inside `watch.ts`. If the store returned
`WatchedMessage` it would have to import `watch.ts`, and `watch.ts` already
imports the store — a cycle for no gain. Data flows one way: `watch.ts → store.ts`.

- [ ] **Step 1: Write the failing test for `listAwaitingMessages`.**

  Append to `src/lib/outreach/store.test.ts`:

  ```ts
  describe("listAwaitingMessages", () => {
    it("returns only messages the person actually marked sent", async () => {
      const calls: unknown[] = [];
      const db = {
        outreachMessage: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [];
          },
        },
      } as unknown as PrismaClient;

      await listAwaitingMessages(db);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        where: { status: OutreachStatus.SENT, sentAt: { not: null } },
        include: { contact: true, email: true },
      });
    });
  });
  ```

  The assertion is on the *query*, not on returned rows: the rule being protected
  is that an unsent draft is never correlated, and that rule lives entirely in the
  `where` clause.

- [ ] **Step 2: Run it and watch it fail.**

  Run: `npx vitest run src/lib/outreach/store.test.ts`
  Expected: FAIL — `listAwaitingMessages is not a function` (it is not exported yet).

- [ ] **Step 3: Implement `listAwaitingMessages`.**

  Add to `src/lib/outreach/store.ts`:

  ```ts
  /**
   * Messages waiting on a verdict: sent by the person, not yet bounced or replied.
   *
   * `sentAt: { not: null }` is redundant against `status: SENT` today and is kept
   * anyway. The watcher writes ContactEmail.status from what this returns, and a
   * row with no sent instant has no window to measure against — belt and braces,
   * in the manner of inbox.ts re-checking SINCE in JS.
   */
  export type AwaitingMessage = OutreachMessage & { contact: Contact; email: ContactEmail };

  export async function listAwaitingMessages(db: PrismaClient): Promise<AwaitingMessage[]> {
    return db.outreachMessage.findMany({
      where: { status: OutreachStatus.SENT, sentAt: { not: null } },
      include: { contact: true, email: true },
    }) as unknown as Promise<AwaitingMessage[]>;
  }
  ```

  Add `type ContactEmail` to the existing `@prisma/client` type import at the top
  of the file.

- [ ] **Step 4: Run it and watch it pass.**

  Run: `npx vitest run src/lib/outreach/store.test.ts`
  Expected: PASS, with the earlier Task 11 tests still green.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/lib/outreach/store.ts src/lib/outreach/store.test.ts
  git commit -m "Find the messages still waiting on a verdict"
  ```

- [ ] **Step 6: Write the failing test for `promoteNextBest`.**

  Append to `src/lib/contacts/store.test.ts`:

  ```ts
  describe("promoteNextBest", () => {
    it("condemns the bounced address and returns the next one worth trying", async () => {
      const updates: Array<{ where: unknown; data: unknown }> = [];
      const db = {
        contactEmail: {
          update: async (args: { where: unknown; data: unknown }) => {
            updates.push(args);
            return {};
          },
          findFirst: async () => ({ id: "e2", address: "j.okafor@acme.com" }),
        },
      } as unknown as PrismaClient;

      const next = await promoteNextBest(db, "c1", "e1");

      expect(next).toBe("j.okafor@acme.com");
      expect(updates[0]).toMatchObject({
        where: { id: "e1" },
        data: { status: ContactEmailStatus.BOUNCED, confidence: 0 },
      });
    });

    it("returns null when every address for the contact is exhausted", async () => {
      const db = {
        contactEmail: {
          update: async () => ({}),
          findFirst: async () => null,
        },
      } as unknown as PrismaClient;

      expect(await promoteNextBest(db, "c1", "e1")).toBeNull();
    });
  });
  ```

- [ ] **Step 7: Run it and watch it fail.**

  Run: `npx vitest run src/lib/contacts/store.test.ts`
  Expected: FAIL — `promoteNextBest is not a function`.

- [ ] **Step 8: Implement `promoteNextBest`.**

  Add to `src/lib/contacts/store.ts`:

  ```ts
  /**
   * A hard bounce ends the argument about one address. Mark it dead and hand back
   * the best of what is left.
   *
   * Ordered by confidence then by creation, so the result is deterministic when
   * two candidates score the same — an arbitrary pick here would make the bounce
   * loop untestable and would look like flakiness in the run log.
   *
   * Returns null when nothing is left, which is a real outcome: the domain's
   * pattern is not one of the ten we model, and a human has to find the address.
   */
  export async function promoteNextBest(
    db: PrismaClient,
    contactId: string,
    bouncedEmailId: string,
  ): Promise<string | null> {
    await db.contactEmail.update({
      where: { id: bouncedEmailId },
      data: { status: ContactEmailStatus.BOUNCED, confidence: 0 },
    });

    const next = await db.contactEmail.findFirst({
      where: {
        contactId,
        id: { not: bouncedEmailId },
        status: { notIn: [ContactEmailStatus.BOUNCED] },
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    });

    return next?.address ?? null;
  }
  ```

- [ ] **Step 9: Run it and watch it pass.**

  Run: `npx vitest run src/lib/contacts/store.test.ts`
  Expected: PASS, Task 10's tests still green.

- [ ] **Step 10: Commit.**

  ```bash
  git add src/lib/contacts/store.ts src/lib/contacts/store.test.ts
  git commit -m "Move on to the next address when one is proven dead"
  ```

- [ ] **Step 11: Add `liveWatchDeps`.**

  Add to the bottom of `src/lib/outreach/watch.ts`:

  ```ts
  import { promoteNextBest, confirmEmailPattern } from "../contacts/store";
  import {
    listAwaitingMessages,
    recordBounce,
    recordReply as recordReplyRow,
  } from "./store";

  /**
   * The real wiring. Every test builds its own WatchDeps, so this factory is the
   * only place the watcher meets Prisma — and the only place that has to change
   * if a store signature moves.
   *
   * `recordHardBounce` ignores its emailId: Task 11's recordBounce already writes
   * both the message and the ContactEmail it named. The field stays in the
   * interface because the tests assert on it and it documents what is condemned.
   */
  export function liveWatchDeps(db: PrismaClient): WatchDeps {
    return {
      async listAwaitingMessages() {
        const rows = await listAwaitingMessages(db);
        return rows.map((row) => ({
          messageId: row.id,
          contactId: row.contactId,
          emailId: row.emailId,
          address: row.email.address,
          domain: row.contact.domain,
          contactName: { first: row.contact.firstName, last: row.contact.lastName },
          sentAt: row.sentAt,
        }));
      },
      async recordHardBounce({ messageId, at }) {
        await recordBounce(db, messageId, { hard: true }, at);
      },
      async recordReply({ messageId, at }) {
        await recordReplyRow(db, messageId, at);
      },
      promoteNextBest: (contactId, bouncedEmailId) =>
        promoteNextBest(db, contactId, bouncedEmailId),
      async learnPattern(domain, pattern) {
        await confirmEmailPattern(db, domain, pattern);
      },
      fetchSince,
    };
  }
  ```

  `fetchSince` is the IMAP reader already defined in Task 15.

- [ ] **Step 12: Type check the wiring.**

  Run: `npm run typecheck`
  Expected: clean. This step is the actual verification for Step 11 — the factory
  has no logic of its own worth a unit test, and the compiler is what proves the
  six members line up with the stores. If a store signature drifted, it fails here.

- [ ] **Step 13: Add the runner script.**

  Create `scripts/watch-outreach.ts`, styled on `scripts/check-mailbox.ts`:

  ```ts
  /**
   * One pass of the bounce and reply watcher.
   *
   * Read-mostly: it opens INBOX read-only and marks nothing. The only writes are
   * to our own rows, and only when a DSN was actually parsed.
   *
   * Run it on a schedule, or by hand after sending a batch of introductions.
   */
  import { PrismaClient } from "@prisma/client";
  import { inboxConfig } from "../src/lib/email/inbox";
  import { liveWatchDeps, watchOnce } from "../src/lib/outreach/watch";

  async function main(): Promise<void> {
    const config = inboxConfig();
    if (!config) {
      console.log("No mailbox configured. Set IMAP_* in .env, or use Settings -> Mailbox.");
      return;
    }

    const db = new PrismaClient();
    try {
      const result = await watchOnce(config, liveWatchDeps(db));
      console.log(`Scanned ${result.scanned} message(s).`);
      for (const outcome of result.outcomes) {
        console.log(`  ${outcome.kind}: ${outcome.address}`);
      }
      for (const address of result.promoted) {
        console.log(`  promoted: ${address}`);
      }
      if (result.outcomes.length === 0) {
        console.log("  nothing to correlate.");
      }
    } finally {
      await db.$disconnect();
    }
  }

  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
  ```

- [ ] **Step 14: Register the script.**

  In `package.json`, beside the other `tsx` scripts, add:

  ```json
  "//outreach:watch": "One pass of the bounce/reply watcher over the inbox (spec §26-27)",
  "outreach:watch": "tsx scripts/watch-outreach.ts",
  ```

- [ ] **Step 15: Run it against the real mailbox.**

  Run: `npm run outreach:watch`
  Expected with no mailbox configured: the "No mailbox configured" line, exit 0.
  Expected with a mailbox and no sent outreach: `Scanned 0 message(s). nothing to correlate.`

  This is a live check, not a test. It never runs in CI.

- [ ] **Step 16: Full suite and commit.**

  Run: `npm test` then `npm run typecheck`
  Expected: both clean.

  ```bash
  git add src/lib/outreach/watch.ts scripts/watch-outreach.ts package.json
  git commit -m "Let the watcher actually reach the database"
  ```

---

## Appendix: judgment calls for Tasks 1, 10 and 11


Flagged for the assembling editor and for review:

1. **Store tests use an injected fake `db`, not Postgres.** There is no DB-touching test
   in the repo to copy, and building the first one is a bigger decision than this feature
   should make. See the note at the top.
2. **`patternConfidence` curve is invented.** The design says only "rises with
   `confirmedCount`" and "a Hunter-sourced pattern starts high". `min(95, 40 + 20n)` has
   the two properties the design names and nothing more; the test asserts the properties,
   not the numbers, so replacing the curve does not break it.
3. **`confirmEmailPattern` vs `saveEmailPattern` is a split the design does not make.**
   The design has one `EmailPattern` table and two ways evidence arrives (Hunter asserts a
   pattern; a confirmation proves one). One function doing both would have to guess which
   kind of evidence it was handed, and the guess would decide whether `confirmedCount`
   moves — which the design explicitly cares about. Two functions, one per kind.
4. **`listFollowUpsDue` filters to `status = SENT`.** The design says the UI surfaces
   follow-ups due but does not define the predicate. DRAFT is waiting on the person to
   send, and REPLIED/BOUNCED are finished, so SENT is the only status where a follow-up
   is the next action.
5. **`setFollowUp` was added.** The parent task list names "list messages due for
   follow-up" but nothing that sets the date; the design's UI section lists "set a
   follow-up date" as an action, so the setter belongs in the store.
6. **`upsertContactEmails` never writes `status` on update, and never writes a null
   `pattern` over a known one.** The design does not spell this out, but "re-running
   discovery must not lose evidence" follows directly from `@@unique([contactId, address])`
   existing so that "the pipeline re-runs and must not duplicate what it already knows".
7. **Domains are normalised (trim + lowercase) on the way into `Contact.domain`,
   `ContactEmail.address` and `EmailPattern.domain`.** The design does not mention it, but
   `EmailPattern.domain` is `@unique` and `ACME.com` and `acme.com` must not be two rows.
8. **`Application.recruiterContact`'s doc comment is updated (Task 1, Step 4).** The
   design asks for it in section 8; the parent task description scoped Task 1 to the
   back-relations. It is a comment-only change to the same file and the same commit — drop
   Step 4 if the assembling editor wants Task 1 strictly limited to structure.
9. **The outreach store does not import the contacts store** for its two `ContactEmail`
   writes. Both are one-field updates on a row this module already holds the id of;
   importing across would couple the two modules for no gain. Noted because a reviewer
   might reasonably expect the opposite.
