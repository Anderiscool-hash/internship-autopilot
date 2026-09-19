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
