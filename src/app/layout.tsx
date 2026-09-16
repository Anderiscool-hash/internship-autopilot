import type { Metadata } from "next";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import {
  configuredPassword,
  isLocalHost,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth/session";
import { db } from "@/lib/db";
import { verificationProgress } from "@/lib/shadow/verdicts";
import { logoutAction } from "./login/actions";
import "./globals.css";

// Metadata shows up in the browser tab and in link previews.
export const metadata: Metadata = {
  title: "Internship Autopilot",
  description:
    "Continuously discovers internships, checks eligibility, scores fit, and applies.",
};

// The root layout wraps EVERY page in the app. Anything that should appear on
// all screens (nav bar, theme provider, fonts) belongs here.
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The nav belongs to people who are actually in the app. On the login screen
  // it was rendering a full set of links that all bounce straight back to
  // login, plus a Sign out button for a session that does not exist yet.
  const remote = !isLocalHost((await headers()).get("host"));
  const password = configuredPassword();
  const signedIn =
    !remote ||
    (password !== null &&
      (await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, password)));

  // The only database work the root layout does, and it is wrapped because of
  // where it sits: this layout renders on EVERY page, so an unhandled throw
  // here takes down the whole app rather than one screen. A missing badge is a
  // fair trade for that. Skipped entirely when signed out, where no nav renders.
  let pendingRuns: number | null = null;
  if (signedIn) {
    try {
      pendingRuns = (await verificationProgress(db)).pending;
    } catch {
      pendingRuns = null;
    }
  }

  return (
    <html lang="en">
      <body>
        {/* Plain links rather than a client-side nav component: every screen in
            this app is server-rendered, so there is nothing for JavaScript to
            do here. */}
        {signedIn ? (
        <nav className="site-nav">
          <a href="/jobs">Jobs</a>
          <a href="/companies">Companies</a>
          <a href="/applications">Applications</a>
          <a href="/shadow-runs">
            Review
            {pendingRuns !== null && pendingRuns > 0 ? (
              // The count is the whole reason this link carries a badge: an
              // unverified run is worth nothing to the trust ladder, so a
              // backlog is invisible progress loss unless something says so.
              <span className="nav-count" aria-label={`${pendingRuns} runs awaiting review`}>
                {pendingRuns}
              </span>
            ) : null}
          </a>
          <a href="/answers">Answers</a>
          <a href="/profile">Profile</a>
          <a href="/analytics">Analytics</a>
          <a href="/settings">Auto-apply</a>
          <a href="/settings/ai">AI</a>
          <a href="/settings/mailbox">Mailbox</a>
          {remote ? (
            <form action={logoutAction} className="nav-signout">
              <button type="submit" className="link-button">
                Sign out
              </button>
            </form>
          ) : null}
        </nav>
        ) : null}
        {children}
      </body>
    </html>
  );
}
