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
      <body>{children}</body>
    </html>
  );
}
