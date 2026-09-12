/**
 * Mailbox settings.
 *
 * Some application portals will not let you past the first page until you
 * confirm your email address. With a mailbox here, an apply run reads the code
 * out of it instead of sending you to a mail client mid-application.
 *
 * The credentials go into .env, not the database — every other secret in this
 * project lives there, .env is gitignored, and a database dump is not.
 */

import { mailboxStatus } from "@/lib/email/env-file";
import { saveMailboxAction, testMailboxAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Mailbox — Internship Autopilot",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function MailboxSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const saved = one(params, "saved");
  const error = one(params, "error");
  const tested = one(params, "tested");

  const status = mailboxStatus();

  return (
    <main className="page">
      <h1>Mailbox</h1>
      <p className="lede">
        For the application portals that email you a code before they will show you the
        form. Optional — without it, a code is simply one more thing the in-page panel
        asks you for.
      </p>

      {saved ? <div className="notice notice-ok">Saved to .env.</div> : null}
      {tested ? <div className="notice notice-ok">{tested}</div> : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className={status.configured ? "notice notice-ok" : "notice"}>
        {status.configured ? (
          <>
            <strong>Configured.</strong> {status.user} at {status.host}:{status.port}
            {status.tls ? " over TLS" : " WITHOUT TLS"}.
          </>
        ) : (
          <>
            <strong>Not configured.</strong> Nothing connects to any mailbox until a server,
            an address and a password are all set here.
          </>
        )}
      </div>

      <section className="import-panel">
        <h2>Credentials</h2>
        <p className="note">
          Gmail needs an <strong>app password</strong>, not your account password — Google
          blocks IMAP with the latter. Generate one at{" "}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
            myaccount.google.com/apppasswords
          </a>{" "}
          (2-Step Verification must be on). Paste it with or without the spaces Google shows;
          they are stripped either way.
        </p>

        <form action={saveMailboxAction} className="entry-form">
          <label className="field">
            <span>Mail server</span>
            <input type="text" name="host" defaultValue={status.host ?? "imap.gmail.com"} required />
          </label>
          <label className="field">
            <span>Email address</span>
            <input type="email" name="user" defaultValue={status.user ?? ""} required />
          </label>
          <label className="field">
            <span>Port</span>
            <input type="text" name="port" defaultValue={String(status.port)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>App password</span>
            <input
              type="password"
              name="password"
              autoComplete="off"
              placeholder={status.hasPassword ? "•••••••• (leave blank to keep)" : ""}
            />
            <small>
              {status.hasPassword
                ? "One is already stored. This box is blank because the password is never sent to your browser — leave it empty to keep it."
                : "Stored in .env, which is gitignored."}
            </small>
          </label>
          <label className="field field-check">
            <input type="checkbox" name="tls" defaultChecked={status.tls} />
            <span>Use TLS</span>
          </label>
          <button type="submit" className="small-button">
            Save
          </button>
        </form>
      </section>

      <section className="import-panel">
        <h2>Test it</h2>
        <p className="note">
          Connects, opens the INBOX read-only, counts the last day&rsquo;s mail, and
          disconnects. Nothing is read, marked as read, or stored. Finding out the password
          is wrong here beats finding out halfway through an application.
        </p>
        <form action={testMailboxAction}>
          <button type="submit" className="small-button" disabled={!status.configured}>
            Test connection
          </button>
        </form>
      </section>

      <section className="import-panel">
        <h2>What a run is allowed to read</h2>
        <p className="note">
          Enforced in code, not by intention — see <code>src/lib/email/inbox.ts</code>:
        </p>
        <ul className="note">
          <li>The INBOX only, opened read-only, so nothing is marked read by being looked at.</li>
          <li>
            Only mail that arrives <strong>after a run starts</strong>. Older mail is never
            fetched.
          </li>
          <li>Nothing is stored. The code is used and the connection closes.</li>
          <li>
            Opt-in twice: these settings <em>and</em> <code>--verify</code> on the run.
            Without the flag no mailbox is contacted at all.
          </li>
        </ul>
        <p className="note">
          One limitation worth knowing: asking a portal to send a code is a POST, and the
          submit guard blocks every POST while the bot drives the page. So this does useful
          work in <code>--handoff</code>, where you press &ldquo;send me a code&rdquo;
          yourself and the digits are already in the box when you look.
        </p>
      </section>
    </main>
  );
}
