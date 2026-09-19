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
import { createDraft, markSent, recordReply, setFollowUp } from "@/lib/outreach/store";
import { confirmEmailPattern } from "@/lib/contacts/store";
import { inferPattern } from "@/lib/contacts/pattern";
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
  const companyId = matches.length === 1 ? matches[0]!.id : null;

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
      `${contact.firstName} ${contact.lastName}; best is ${result.best} ` +
      `as the strongest address.`,
  });
}

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

  const applicationId = field(form, "applicationId");
  if (applicationId) {
    const application = await db.application.findUnique({
      where: { id: applicationId },
      include: { job: { select: { companyId: true } } },
    });
    if (!application || !contact.companyId || application.job.companyId !== contact.companyId) {
      back({ error: "Choose an application at this contact's company." });
    }
  }

  const draft = await buildOutreachDraft(contact.id, email.id, applicationId || null);
  const { subject, body } = draft;
  await createDraft(db, { contactId: contact.id, emailId: email.id,
    applicationId: applicationId || null, subject, body });

  revalidatePath("/contacts");
  back({
    saved:
      `Drafted a message to ${email.address}. Read it before it goes anywhere — ` +
      `this app never sends.${draft.fallbackReason ? " AI was unavailable, so a filled template was used." : ""}`,
  });
}

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
  if (message.status !== OutreachStatus.DRAFT) {
    back({ error: "Only an unsent draft can be put in Drafts." });
  }
  const target = await db.contactEmail.findUnique({ where: { id: message.emailId } });
  if (!target || target.status === "BOUNCED") {
    back({ error: "That address has bounced. Choose a new address before drafting again." });
  }

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

  await markSent(db, id);

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
    await setFollowUp(db, id, null);
    revalidatePath("/contacts");
    back({ saved: "Follow-up cleared." });
  }

  // <input type="date"> gives YYYY-MM-DD. Parsed as local midnight rather
  // than via new Date("2026-09-19"), which UTC-parses and lands on the
  // previous day for anyone west of Greenwich.
  const [year, month, day] = raw.split("-").map(Number);
  const when = new Date(year ?? 0, (month ?? 0) - 1, day ?? 1);
  if (Number.isNaN(when.getTime())) back({ error: "That is not a date." });

  await setFollowUp(db, id, when);

  revalidatePath("/contacts");
  back({ saved: `Follow-up set for ${when.toLocaleDateString()}.` });
}

/** A human confirms a reply seen in their own mailbox. */
export async function recordReplyAction(form: FormData): Promise<void> {
  await requireAccess();

  const id = field(form, "id");
  const message = await db.outreachMessage.findUnique({
    where: { id },
    include: { contact: true, email: true },
  });
  if (!message) back({ error: "That message no longer exists." });
  if (message.status !== OutreachStatus.SENT) {
    back({ error: "Only a sent message can be marked as replied to." });
  }

  await recordReply(db, id);
  const pattern = inferPattern(message.email.address, {
    first: message.contact.firstName,
    last: message.contact.lastName,
  });
  if (pattern) await confirmEmailPattern(db, message.contact.domain, pattern);

  revalidatePath("/contacts");
  back({ saved: `Reply recorded from ${message.email.address}. That address is now confirmed.` });
}
