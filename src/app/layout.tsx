import type { Metadata } from "next";
import "./globals.css";

// Metadata shows up in the browser tab and in link previews.
export const metadata: Metadata = {
  title: "Internship Autopilot",
  description:
    "Continuously discovers internships, checks eligibility, scores fit, and applies.",
};

// The root layout wraps EVERY page in the app. Anything that should appear on
// all screens (nav bar, theme provider, fonts) belongs here.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* Plain links rather than a client-side nav component: every screen in
            this app is server-rendered, so there is nothing for JavaScript to
            do here. */}
        <nav className="site-nav">
          <a href="/jobs">Jobs</a>
          <a href="/applications">Applications</a>
          <a href="/answers">Answers</a>
          <a href="/profile">Profile</a>
          <a href="/analytics">Analytics</a>
          <a href="/settings">Auto-apply</a>
          <a href="/settings/ai">AI</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
