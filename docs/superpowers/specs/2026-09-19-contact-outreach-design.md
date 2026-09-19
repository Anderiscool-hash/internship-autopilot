# Contact Finder and Recruiter Outreach — Design (spec §26–27)

**Date:** 2026-09-19
**Status:** Design. Not implemented.
**Covers:** spec §26 (contact finder) and §27 (recruiter outreach).

---

## The problem

Every path into a company this app knows about runs through that company's ATS
board. The scanner finds a posting, the apply worker fills the form, and the
application lands in the same queue as everyone else's.

Nothing in the repository can reach a *person*. `Application.recruiterContact`
is a single nullable string, and its own schema comment
(`prisma/schema.prisma:728-731`) admits what it is: a placeholder for "the
recruiter finder/CRM (spec §26-27)", which is this document.

So the candidate cannot do the thing that most reliably moves an internship
application — introduce himself to a human who works there.

## The constraint everything else follows from

**This app must never send mail.**

That is a decision, not a limitation, and it was made by the person whose
mailbox and professional reputation are at stake. Spec §27 already said
"sending should initially remain user-controlled"; this design holds to it
literally. No SMTP dependency is introduced. No code path transmits a message
to a third party.

Two things follow, and they shape everything below:

- Everything the system produces is a **draft** a human reads before it goes
  anywhere. The review gate is structural, not procedural — there is no send
  button to press by accident, because there is no send.
- Verification cannot come from watching our own outbound mail, because there
  is none. It has to come from the candidate's **inbox**, which the app already
  reads over IMAP (`src/lib/email/inbox.ts`). That turns out to be enough; see
  section 5.

## Non-goals

**Local and small-employer job sources are out of scope.** They were raised in
the same conversation and belong in their own spec, because they are not a
variation on anything here — they are a second ingestion shape:

- `AtsJobFetcher` (`src/lib/ats/index.ts:26`) is
  `(boardIdentifier, companyName) => Promise<CanonicalJob[]>`. It is
  one-board-per-company by construction. A local-jobs source returns postings
  from *many unrelated employers*, which the contract cannot express.
- `shouldTrustForRemoval` (`src/lib/scan/diff.ts:31`) is
  `return fetchedCount > 0`, and the scanner then closes every open job for
  that company absent from the fetch. Forcing a many-employer source through
  the existing scan path would close jobs en masse on the first cycle.

Also out:

- **Sending, scheduling and sequencing.** No SMTP, no timed follow-up sends. A
  follow-up *date* is tracked and surfaced; acting on it is the human's.
- **People Data Labs.** §26 lists it as a possibility. Hunter covers the same
  need and one paid dependency is enough; `Contact.source` leaves room.
- **Any automated access to LinkedIn.** See section 2.
- **Resume and cover-letter generation** (§14–15, still unbuilt). Outreach
  drafts reference documents that exist; they do not create them.

---

## 1. Decision: hybrid sourcing

Contact data has a free path and a paid path, and the free path is the default
**and** the fallback — never a degraded mode that has to be opted into.

| | Free path | With `HUNTER_API_KEY` |
|---|---|---|
| Names | pasted by the candidate | pasted by the candidate |
| Domain pattern | inferred from confirmations | Hunter lookup, then inferred |
| Address | permuted and ranked | Hunter's known address when it has one |
| Verification | Gravatar + bounce feedback | Hunter verification + the above |

Rejected alternatives, for the record:

- **Paid-only.** Simplest code by a wide margin — Hunter returns verified
  addresses and the entire permutation and scoring subsystem disappears.
  Rejected because the free tier is small enough that the app would stop
  working partway through a week of searching, and a job-hunting tool that
  fails closed on the 26th lookup is worse than one that is merely uncertain.
- **Free-only.** No dependency, no cost, no key management. Rejected because
  `.env.example:37-39` already reserves `HUNTER_API_KEY`, and refusing to use a
  verified address when one is available means burning a real send on a guess
  for no reason.

The key follows the existing secret convention exactly: it lives in `.env`,
written by the settings screen through `writeEnvVars`
(`src/lib/email/env-file.ts:32`), never in Postgres, and never read back to the
browser. `MailboxVar` gains no members — outreach owns a separate
`OutreachVar = "HUNTER_API_KEY"` union so the two screens cannot write each
other's variables.

## 2. LinkedIn is never touched by the app

Names enter the system because a human typed or pasted them. The application
makes no request to LinkedIn, authenticated or otherwise.

§26 says "avoid scraping private data", which settles it on its own. The
concrete reason is worth writing down anyway: LinkedIn detects automated access
and bans accounts permanently, and the account at risk belongs to the person
whose internship search this entire application exists to serve. Trading his
professional profile to save some copy-and-paste is the worst trade available
anywhere in this codebase.

`Contact.source` is an enum rather than a boolean so a licensed API source can
be added later without a migration. `MANUAL` is the only value the first
implementation writes, alongside `HUNTER` when an address came from there.

---

## 3. The guessing pipeline

`src/lib/contacts/discover.ts` orchestrates four steps. Each is a separate
module so the pure ones can be tested exhaustively without a network.

### Step 1 — MX lookup

```ts
// src/lib/contacts/mx.ts
export type MailProvider = "google" | "microsoft" | "other" | "none";

export interface MxResult {
  hasMx: boolean;
  provider: MailProvider;
  hosts: string[];
}

export async function lookupMx(domain: string): Promise<MxResult>;
```

`dns.promises.resolveMx`. Free, no terms of service to violate, no rate limit
worth modelling, and it answers a question that short-circuits everything after
it: **a domain with no MX record accepts no mail, so every candidate address
under it is dead.** Returning `hasMx: false` stops the pipeline before a single
HTTP request is made.

It also identifies the provider from the MX hostnames (`*.google.com` /
`*.googlemail.com` for Google Workspace, `*.outlook.com` /
`*.protection.outlook.com` for Microsoft 365). That is recorded for diagnostics
and for the catch-all caveat in section 10, not used to change the guess.

### Step 2 — Permutation

```ts
// src/lib/contacts/permute.ts
export interface NameParts {
  first: string;
  last: string;
  middle?: string;
}

export interface AddressCandidate {
  address: string;
  pattern: PatternId;
  /** Population frequency of this pattern, 0–1. See the table below. */
  prior: number;
}

export function permuteAddresses(name: NameParts, domain: string): AddressCandidate[];
```

Pure. Normalises each part (lowercase, strip accents to ASCII, drop apostrophes
and internal spaces in compound surnames) and emits one candidate per known
pattern, ordered by prior.

> **These priors are estimates, not measurements.** They come from commonly
> cited industry breakdowns and are good enough to order a list on day one.
> They live in one exported constant so that once this app has confirmed a few
> dozen real addresses, they can be replaced with numbers measured from
> `EmailPattern` rows — the only honest source for them.

| `PatternId` | Example for Jane Okafor at `acme.com` | Estimated prior |
|---|---|---|
| `first.last` | `jane.okafor@acme.com` | 0.34 |
| `first` | `jane@acme.com` | 0.12 |
| `flast` | `jokafor@acme.com` | 0.11 |
| `firstlast` | `janeokafor@acme.com` | 0.07 |
| `first_last` | `jane_okafor@acme.com` | 0.05 |
| `f.last` | `j.okafor@acme.com` | 0.05 |
| `last.first` | `okafor.jane@acme.com` | 0.03 |
| `firstl` | `janeo@acme.com` | 0.02 |
| `lastf` | `okaforj@acme.com` | 0.02 |
| `first-last` | `jane-okafor@acme.com` | 0.01 |

The priors do not sum to 1, and should not be made to. The remainder is mass
held by patterns this list does not model (initials-only, employee numbers,
`first.m.last`), and pretending it is zero would overstate confidence in the
ten we do generate.

### Step 3 — Scoring

```ts
// src/lib/contacts/score.ts
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
export function scoreAddress(signals: AddressSignals): number;
```

Pure, synchronous and total. The ordering it must respect is ground-truth
first:

```
replied > hunterVerified > gravatarHit > daysSinceSentClean > prior
hardBounced overrides everything and floors the score at 0
```

### Step 4 — Pattern learning

```ts
// src/lib/contacts/pattern.ts
export type PatternId =
  | "first.last" | "first" | "flast" | "firstlast" | "first_last"
  | "f.last" | "last.first" | "firstl" | "lastf" | "first-last";

/** Which pattern would have produced this address for this person? */
export function inferPattern(address: string, name: NameParts): PatternId | null;

/** Build the address this pattern implies. Null when the name lacks a part. */
export function applyPattern(
  pattern: PatternId,
  name: NameParts,
  domain: string,
): string | null;
```

This is the part that compounds, and it is why the free path is viable at all.
The first confirmed address at a domain collapses the next contact there from
ten guesses to one high-confidence address. A company the candidate contacts
repeatedly — which is exactly what he will do — costs a guess once.

`inferPattern` returns null when two patterns both explain the address (a
one-letter first name makes `first.last` and `f.last` identical). Ambiguous
evidence updates nothing: `EmailPattern.confirmedCount` rises only on an
unambiguous match.

---

## 4. Verification, and the asymmetry that governs it

| Signal | Cost | Proves it is real | Proves it is wrong |
|---|---|---|---|
| Reply received | free | **yes** | — |
| Hard bounce (5.x.x) | free | — | **yes** |
| Hunter verified | quota | strongly | weakly (`invalid`) |
| Gravatar hit | free | **yes** | **no** |
| No bounce after N days | free | weakly | no |
| Soft bounce (4.x.x) | free | no | **no** |

**Gravatar is positive-only, and this must be enforced in code rather than
remembered.** `https://www.gravatar.com/avatar/<md5(lowercased address)>?d=404`
returns 200 when an avatar exists and 404 when none does. A 200 means a human
registered that exact address with Gravatar, so the address is real. A 404 means
nothing whatsoever — most corporate addresses have never been near Gravatar.

This is the rule the repository already enforces elsewhere under the name
**silence is never a yes**. `hasGravatar` therefore returns a `boolean` whose
`false` is scored as *absence of evidence*, and `ContactEmailStatus` has a
`GRAVATAR_HIT` member with no `GRAVATAR_MISS` counterpart — there is no such
state to record.

```ts
// src/lib/contacts/gravatar.ts
/** True when an avatar exists. False means unknown, never "not real". */
export async function hasGravatar(address: string): Promise<boolean>;
```

### Hunter client

Follows the ATS client convention exactly (`src/lib/ats/greenhouse.ts`): a typed
error carrying `retryable`, a Zod schema declaring only the fields used,
`AbortSignal.timeout(15_000)`, and the shared user-agent string.

```ts
// src/lib/contacts/hunter.ts
export class HunterApiError extends Error {
  readonly retryable: boolean;   // 429/5xx/network → true; 401/404 → false
  readonly statusCode?: number;
}

export function hunterConfigured(env?: Record<string, string | undefined>): boolean;

export async function hunterDomainPattern(domain: string): Promise<PatternId | null>;
export async function hunterFindEmail(domain: string, name: NameParts): Promise<string | null>;
export async function hunterVerify(address: string): Promise<boolean | null>;
```

Each returns null rather than throwing when Hunter is simply unconfigured. An
unconfigured optional dependency is an ordinary state, the same way
`inboxConfig()` returns null for an unconfigured mailbox
(`src/lib/email/inbox.ts:49`) — it is not an error and must not read like one.

---

## 5. Bounce detection

The app never sends, yet it still gets ground truth, because **a bounce is
delivered to the sender's inbox and the app already reads that inbox.**

1. The candidate opens a draft, sends it from his own mail client, and marks it
   sent in the app — one click, setting `OutreachMessage.status = SENT` and
   `sentAt`.
2. A watcher polls IMAP for mail arriving after `sentAt`, reusing the connection
   discipline of `src/lib/email/inbox.ts`: open per pass, `INBOX` read-only,
   nothing marked, nothing moved, nothing stored beyond what is extracted.
3. A delivery status notification is recognised and parsed.
4. A hard bounce marks that `ContactEmail` `BOUNCED`, and the next-best
   candidate for the contact is promoted and re-drafted.

```ts
// src/lib/outreach/bounce.ts  (pure)
export interface BounceReport {
  /** The address that failed, from the DSN's Final-Recipient field. */
  failedRecipient: string;
  /** RFC 3463 status, e.g. "5.1.1". */
  status: string;
  /** True for 5.x.x. Only a hard bounce is evidence the address is wrong. */
  hard: boolean;
  diagnostic?: string;
}

export function parseDsn(raw: string): BounceReport | null;
export function isHardStatus(status: string): boolean;
```

Recognition, in order of reliability:

1. `Content-Type: multipart/report; report-type=delivery-status` with a
   `message/delivery-status` part — the RFC 3464 machine-readable form. Parse
   `Final-Recipient`, `Action: failed` and `Status`.
2. Failing that, a sender of `MAILER-DAEMON@…` or `postmaster@…` combined with a
   recognisable recipient address in the body.

Heuristic 2 is a fallback and is scored as one: it may mark a message `BOUNCED`
for display, but it may **not** set `ContactEmail.status = BOUNCED` without a
parsed `5.x.x`. Misreading an out-of-office as a bounce would discard a correct
address.

**Hard versus soft is load-bearing.** A `4.x.x` status is a full mailbox,
greylisting, or a server having a bad hour. It says nothing about whether the
address is right, and treating it as a negative would discard correct addresses
at exactly the companies whose mail servers are busiest. Only `5.x.x` is a
negative, and `5.2.2` (mailbox full, occasionally issued as permanent) is
explicitly excluded from the hard set.

A reply that is not a bounce sets `status = REPLIED` and `repliedAt`, and marks
the address `CONFIRMED` — the strongest signal available, and the one that
teaches `EmailPattern` for free.

---

## 6. Draft generation

**The AI writes prose. Rules supply every fact.**

This is not a new principle; it is the Truth Ledger guarantee the repository
already enforces (`TruthFactCategory`, `prisma/schema.prisma:97-104`) and the
same division already agreed for the local model. It matters more here than
anywhere else in the app, because the failure mode is a fluent, confident, false
claim about the candidate sent to somebody who could hire him — and unlike a
form field, nobody validates it on the way out.

The draft builder assembles a fact block from stored data only:

- candidate name, school, degree, graduation date — `Candidate`
- the posting, its title and company — `Job`, when an application is linked
- claims about experience — `TruthFact` rows exclusively, never
  `WorkExperience` free text

and hands the model those facts plus the contact's name and title, instructed to
write only from what it was given. Nothing the model returns is parsed back into
a fact: the output is prose, reviewed by a human before it moves.

When no AI provider is configured (`getProvider` returns null,
`src/lib/ai/index.ts:67`) the builder falls back to a filled template. A template
introduction is worse writing than a generated one and is still a perfectly good
email; the feature does not require an AI provider to function.

---

## 7. Draft delivery

### Decision: IMAP `APPEND`, with an in-app copy fallback

```ts
// src/lib/outreach/deliver.ts
export type DeliveryResult =
  | { ok: true; folder: string }
  | { ok: false; reason: string };

export async function appendDraft(
  config: InboxConfig,
  mime: string,
): Promise<DeliveryResult>;

/** Locate the drafts mailbox by \Drafts special-use, falling back to name. */
export async function findDraftsFolder(client: ImapFlow): Promise<string | null>;
```

The app writes a real draft into the candidate's Drafts folder using the IMAP
connection and credentials it already holds. He opens his mail client and the
message is waiting, addressed and written, for him to read and send. No new
secret, no new protocol, no new dependency — `imapflow` already supports
`append()`.

Folder discovery uses the `\Drafts` special-use flag from `LIST` rather than a
hardcoded name, because the name varies (`[Gmail]/Drafts`, `Drafts`,
`INBOX.Drafts`). A missing flag falls back to a small candidate list, and failing
that, to the copy path below.

MIME construction is pure and therefore testable:

```ts
// src/lib/outreach/compose.ts
export function composeMime(message: {
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
}): string;
```

RFC 5322 with a `text/plain; charset=utf-8` body, RFC 2047 encoded-words for
non-ASCII in the subject, and CRLF line endings — IMAP is strict about the last
one, and a bare LF produces a draft some clients refuse to open.

**Fallback:** when IMAP is unconfigured or `appendDraft` returns `ok: false`,
`/contacts` renders the subject and body with a copy button. This path is
unconditional and always present. It also has to exist regardless, because a
candidate with no mailbox configured must still be able to use the feature.

**Rejected: `mailto:` links.** Prefills the compose window of whatever handles
the protocol. Rejected on three counts: practical URL length limits truncate a
real introduction, attachments are impossible so a resume can never ride along,
and it depends on the OS mail handler being the client the candidate actually
uses — which for a Gmail-in-a-browser user it typically is not.

---

## 8. Data model

Four models and four enums, following the conventions in `prisma/schema.prisma`
(`///` comments explaining *why*, nullable only where null has a distinct
meaning, indexes for the queries actually issued).

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

### Back-relations on existing models

Prisma requires both sides of every relation, so two existing models gain one
field each. They are listed separately because they are edits to code this
feature does not otherwise own:

```prisma
model Company     { contacts Contact[] }          // Contact.company
model Application { outreach OutreachMessage[] }  // OutreachMessage.application
```

`Contact` and `ContactEmail` already declare their own back-relations within the
block above.

### `Company.domain` has no unique constraint

Confirmed against the current schema: `Company` (`prisma/schema.prisma:508`) has
**no** unique constraint of any kind — not on `name`, not on `domain`, not on
`(atsType, atsIdentifier)`. Deduplication is enforced only in application code
(`src/app/companies/actions.ts:49-54`).

Domain-to-company resolution must therefore be defensive: `findMany` on domain,
and when it returns more than one row, attach nothing — let the contact stand
with `companyId: null` and its own `domain`. A contact quietly filed under the
wrong duplicate company row would show the candidate outreach history for a
company he never contacted. `Contact.domain` being non-nullable and independent
of the join is what makes that safe: the pipeline never needs the Company row to
do its work.

> **ASSUMPTION — not confirmed with the user.** Adding `@@unique([domain])` to
> `Company` would be the cleaner fix, but it is a migration against existing rows
> that may already violate it, and it is not this feature's business to decide.
> Noted for whoever specs the local-employer sources, which will hit the same
> problem harder.

### `Application.recruiterContact` stays

It is a nullable free-text string holding, at most, a name or address typed by
hand. **Recommendation: leave it exactly as it is.** Two reasons:

- It may already hold data, and nothing in this design needs its column.
  Migrating it would mean parsing free text into a `Contact` — inventing a first
  and last name from an arbitrary string — and a wrong guess writes a fabricated
  person into the contact list.
- Its schema comment correctly describes it as a stand-in for §26–27. Once
  `OutreachMessage.applicationId` is in use and `/contacts` is the real record,
  the field can be deprecated in a later pass with evidence about what is
  actually in it.

Update its doc comment to name `OutreachMessage` as the successor, and stop
writing to it.

---

## 9. Module layout

Pure logic is separated from anything doing I/O, because this repository unit
tests pure logic heavily and those are the pieces worth testing exhaustively.
Every module below marked *pure* ships with a co-located `.test.ts`.

```
src/lib/contacts/
  permute.ts      pure   name + domain -> ranked AddressCandidate[]
  pattern.ts      pure   infer a PatternId from a confirmation; apply one
  score.ts        pure   AddressSignals -> 0-100 confidence
  mx.ts           I/O    dns.resolveMx, provider identification
  gravatar.ts     I/O    avatar probe (positive-only)
  hunter.ts       I/O    Hunter client: typed error, Zod, 15s timeout
  store.ts        I/O    Contact / ContactEmail / EmailPattern persistence
  discover.ts     orch   runs the four-step pipeline over one contact

src/lib/outreach/
  compose.ts      pure   RFC 5322 MIME construction
  bounce.ts       pure   DSN parsing, hard vs soft classification
  draft.ts        orch   fact block + AI prose (or template) -> subject/body
  deliver.ts      I/O    IMAP APPEND to Drafts, folder discovery
  watch.ts        I/O    IMAP poll for bounces and replies
  store.ts        I/O    OutreachMessage persistence
```

`discover.ts` and `draft.ts` are the only modules that know the order of
operations; everything else answers one question and has no opinion about when
it is asked.

## 10. UI

A new `/contacts` route following the established convention
(`src/app/companies/`):

- `src/app/contacts/page.tsx` — async server component, `export const dynamic =
  "force-dynamic"`, `export const metadata`, data read through a direct `db`
  call, `searchParams` awaited as a promise (Next 15).
- `src/app/contacts/actions.ts` — `"use server"`, every action opening with
  `await requireAccess()`, the `field(form, name)` trimmer, and a `back()`
  helper redirecting with `?saved=` / `?error=` rendered as
  `notice notice-ok` / `notice notice-error`.
- `src/app/site-nav.tsx` — a `NavItem` added to the **Workspace** group,
  alongside `/companies`. The breadcrumb derives from `GROUPS` automatically.
- `src/app/ui-icon.tsx` — a new name in `IconName`.

Actions: add a contact (name, title, domain, optional LinkedIn URL), run
discovery, generate a draft, push the draft to Drafts or copy it, mark sent, set
a follow-up date, record a reply.

The index view groups by what needs the human: drafts waiting, follow-ups due,
and replies received. Ordinary contacts with nothing outstanding sort below —
the same "needs you" shape the `/applications` tracker already uses, for the
same reason.

## 11. Rate limiting and politeness

The repository has no shared HTTP wrapper: each client duplicates a user-agent,
a 15-second timeout, and a typed error carrying `retryable`. Follow that
convention rather than inventing a framework for two new callers.

- **Gravatar** — one request per address, sequential with a short delay between
  candidates, modelled on the hand-rolled `DETAIL_REQUEST_DELAY_MS` in
  `src/lib/ats/smartrecruiters.ts:116`. Ten candidates is ten requests; there is
  no need for concurrency.
- **Hunter** — the free tier is small, so the rule is: never spend a call on a
  question already answered. `hunterDomainPattern` is consulted once per domain
  and the answer persisted to `EmailPattern`. `hunterVerify` is never called for
  an address already `CONFIRMED` or `BOUNCED`. A 429 raises
  `HunterApiError { retryable: true }` and the pipeline continues on the free
  signals rather than failing the discovery.
- **MX** — cached per domain for the life of a discovery run. The resolver has
  its own cache below us; adding a persistent one would be premature.

## 12. Testing

Pure, unit-tested exhaustively, no network:

- `permute` — accents, hyphenated and compound surnames, one-letter first names,
  a missing middle name, and ordering by prior.
- `pattern` — `inferPattern` round-trips every `PatternId` from `applyPattern`,
  and returns null for the genuinely ambiguous cases.
- `score` — the ordering property itself is the test: a table of signal sets
  asserting the documented ranking holds, plus `hardBounced` flooring the score
  from every starting point.
- `bounce` — the largest fixture set. Real DSN bodies from Gmail, Outlook and
  Postfix; a hard 5.1.1; a soft 4.2.2; the `5.2.2` exclusion; an out-of-office
  that must **not** parse as a bounce; a `MAILER-DAEMON` message with no
  machine-readable part, asserting it is reported but does not set `BOUNCED`.
- `compose` — CRLF endings, RFC 2047 subject encoding, header ordering.

Fixture-backed, mocked transport:

- `hunter` — recorded JSON for a hit, a miss, a 401 and a 429, asserting the
  `retryable` classification matches the ATS-client convention.
- `gravatar` — a 200 and a 404, asserting the 404 changes no state.
- `deliver` — `findDraftsFolder` against recorded `LIST` responses for Gmail,
  Outlook and a generic IMAP server.

Live only, and never in CI:

- an actual `APPEND` against a real mailbox, run by hand from a script in the
  style of `scripts/check-mailbox.ts`.

**No test ever sends mail**, consistent with the apply workers' rule that no
test submits to a real employer's form. There is no send path, so this is cheap
to guarantee — but it should be stated, because the fallback copy path makes it
tempting to add a "just this once" SMTP helper to a test.

## 13. Risks and open questions

- **Gravatar coverage on corporate domains is low.** It is the only free
  pre-send signal, and most of the time it will return nothing. The free path
  therefore leans heavily on bounce feedback, which means the first email to a
  new company really is a coin flip. Accepted: the alternative is not sending.
- **Catch-all domains make "no bounce" meaningless.** A domain that accepts all
  mail never bounces, so `daysSinceSentClean` is evidence of nothing there.
  Detecting catch-all without sending is not possible from our side. Mitigation:
  score `daysSinceSentClean` weakly everywhere, and treat a reply — not a
  non-bounce — as the confirmation that teaches `EmailPattern`.
- **The whole correlation depends on the person marking a draft as sent.** If he
  forgets, `sentAt` stays null, the watcher never looks, and a bounce is missed
  entirely — leaving a wrong address scored as though it were merely unproven.
  Partially mitigable by reading the Sent folder over IMAP to detect it
  automatically; deliberately deferred, and listed here because it is the most
  likely way this feature quietly underperforms.
- **Hunter's free tier may be too small to matter.** If it is exhausted in the
  first afternoon, the paid path is decorative and the design is effectively
  free-only. This is only measurable in use. The hybrid structure means finding
  that out costs nothing but the key.
- **Soft-bounce classification is a judgment call.** The `5.2.2` exclusion is
  based on providers issuing it for a full mailbox, but `5.x.x` handling varies
  between mail servers and the fixture set will be smaller than reality.
- **`OutreachMessage` has no unique constraint.** Drafting twice for the same
  contact and address creates two rows, which is intentional — a follow-up is a
  second message — but it means the UI must make the existing thread visible so
  the person does not introduce himself twice by accident.

## 14. Out of scope

- Local and small-employer job sources (see Non-goals; separate spec).
- SMTP, scheduled sends, automated follow-up sequences.
- People Data Labs and any second enrichment provider.
- Any automated LinkedIn access.
- Reading the Sent folder to auto-detect that a draft was sent.
- Resume and cover-letter generation (§14–15).
- Migrating `Application.recruiterContact` into `Contact`.
