/**
 * The people, and the messages to them (spec Â§26-27).
 *
 * The two things this screen exists to make impossible:
 *
 *   1. Introducing yourself to the same person twice. OutreachMessage has no
 *      unique constraint â€” a follow-up is legitimately a second message â€” so
 *      the rendered thread is the only guard there is. It is therefore always
 *      visible, never collapsed and never truncated (design Â§13).
 *   2. Being unable to use the feature without a mailbox. Every draft renders
 *      with a copy button and a selectable box whether or not IMAP is
 *      configured (design Â§7).
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
  recordReplyAction,
  setFollowUpAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Contacts â€” Internship Autopilot" };

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

  const applications = await db.application.findMany({
    orderBy: { discoveredAt: "desc" },
    select: { id: true, job: { select: { title: true, companyId: true,
      company: { select: { name: true } } } } },
  });

  const contacts = await db.contact.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      company: { select: { name: true } },
      emails: { orderBy: [{ confidence: "desc" }, { address: "asc" }] },
      outreach: {
        orderBy: { draftedAt: "desc" },
        include: { email: { select: { address: true } },
            application: { select: { job: { select: { title: true } } } } },
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
        (message.status === "SENT" && message.followUpAt !== null && followUpDue(message.followUpAt, now)),
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
            <input type="url" name="linkedinUrl" placeholder="https://linkedin.com/in/â€¦" />
          </label>
          <div className="filter-actions">
            <button type="submit">Add</button>
          </div>
        </form>
        <p className="note" style={{ padding: "0 var(--space-3) var(--space-3)" }}>
          Type or paste the name yourself. This app makes no request to LinkedIn,
          authenticated or otherwise â€” the URL is stored for your reference and never
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
            <ContactCard contact={contact} now={now} applications={applications.filter((a) => a.job.companyId === contact.companyId)} key={contact.id} />
          ))}
        </section>
      ) : null}

      {settled.length > 0 ? (
        <section>
          <h2>Nothing outstanding</h2>
          {settled.map((contact) => (
            <ContactCard contact={contact} now={now} applications={applications.filter((a) => a.job.companyId === contact.companyId)} key={contact.id} />
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
          Preferences â†’ Contact finder, adds a verified address and the domain&rsquo;s
          known pattern. The first confirmed address at a company turns every later
          contact there from ten guesses into one.
        </p>
      </section>
    </main>
  );
}

type ContactRow = Awaited<ReturnType<typeof loadContacts>>[number];
type ApplicationChoice = { id: string; job: { title: string; companyId: string; company: { name: string } } };

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
      outreach: { include: { email: { select: { address: true } },
          application: { select: { job: { select: { title: true } } } } } },
    },
  });
}

function ContactCard({ contact, now, applications }: { contact: ContactRow; now: Date; applications: ApplicationChoice[] }) {
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
            title={`${best.confidence}/100 â€” how likely this address is to be real`}
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
        {contact.title ?? "â€”"} Â· {contact.company?.name ?? contact.domain}
        {contact.linkedinUrl ? (
          <>
            {" Â· "}
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
          {applications.length > 0 ? (
            <label className="field">
              <span>Application (optional)</span>
              <select name="applicationId" defaultValue="">
                <option value="">General introduction</option>
                {applications.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.job.title} at {application.job.company.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="submit" className="small-button" disabled={best === null}>
            {contact.outreach.length > 0 ? "Draft a follow-up" : "Draft an introduction"}
          </button>
        </form>
      </div>

      {/* The whole thread, always. OutreachMessage has no unique constraint â€”
          a follow-up is deliberately a second row â€” so this list is the only
          thing standing between the candidate and introducing himself twice
          to the same person. It is not collapsed and it is not truncated. */}
      {contact.outreach.length > 0 ? (
        <div className="stack">
          <p className="note">
            <strong>
              {contact.outreach.length} message
              {contact.outreach.length === 1 ? "" : "s"} to this person
            </strong>{" "}
            â€” read this before drafting another.
          </p>
          {contact.outreach.map((message) => (
            <details className="card" key={message.id} open={message.status === "DRAFT"}>
              <summary>
                <span className={outreachStatusBadgeClass(message.status as OutreachStatusName)}>
                  {message.status.toLowerCase()}
                </span>{" "}
                {message.subject} Â· <code>{message.email.address}</code> Â·{" "}
                {formatAge(message.draftedAt, now)}
                {message.status === "SENT" && message.followUpAt ? (
                  <>
                    {" Â· "}
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

              {message.application ? (
                <p className="note">Linked application: {message.application.job.title}</p>
              ) : null}
              <p className="note">
                {message.draftFolder
                  ? `Written to ${message.draftFolder} in your mailbox.`
                  : "Not in your mailbox â€” copy it from here."}
              </p>

              {/* The copy path is unconditional. It is rendered whether or
                  not IMAP is configured and whether or not an APPEND ever
                  succeeded, because a candidate with no mailbox at all must
                  still be able to use this feature (design Â§7). The textarea
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
                  <button type="submit" className="small-button" disabled={message.status !== "DRAFT"}>
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
                {message.status === "SENT" ? (
                  <form action={recordReplyAction}>
                    <input type="hidden" name="id" value={message.id} />
                    <button type="submit" className="small-button">I received a reply</button>
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
                message â€” the watcher only reads mail that arrives after you press it.
                Forgetting means a wrong address stays scored as merely unproven.
              </p>
            </details>
          ))}
        </div>
      ) : null}
    </article>
  );
}
