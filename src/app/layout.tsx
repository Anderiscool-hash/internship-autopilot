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
import { SiteNav } from "./site-nav";
import { LegalFooter } from "./legal-content";
import "./globals.css";
import "./workspace.css";

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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try { const theme = localStorage.getItem("autopilot-theme"); if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme; } catch {}` }} />
      </head>
      <body className={signedIn ? "workspace-shell" : undefined}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {signedIn ? (
          <SiteNav pendingRuns={pendingRuns} remote={remote} />
        ) : null}
        <div id="main-content">{children}</div>
        <LegalFooter />
      </body>
    </html>
  );
}
