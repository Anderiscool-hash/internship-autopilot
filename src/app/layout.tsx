import type { Metadata } from "next";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import {
  configuredPassword,
  isLocalHost,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth/session";
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
