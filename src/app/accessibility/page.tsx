import { LegalPage } from "../legal-content";

export const metadata = { title: "Accessibility | Internship Autopilot" };

export default function AccessibilityPage() {
  return (
    <LegalPage
      eyebrow="Accessibility"
      title="The workspace should work for you."
      intro="We design for keyboard navigation, readable contrast, responsive layouts, visible focus, and reduced motion."
    >
      <h2>Our approach</h2>
      <p>We use semantic headings, labeled controls, keyboard-accessible navigation, text cues alongside color, responsive layouts, and a reduced-motion mode. We use WCAG as a practical guide and test both manually and with automated checks.</p>
      <h2>Need help?</h2>
      <p>If something prevents you from using the workspace, tell us what happened, which page you were on, and how you prefer to be contacted: <a href="mailto:[accessibility-contact@example.com]">[accessibility-contact@example.com]</a>. We will use that report to improve the product. Replace this placeholder before publishing.</p>
      <h2>Known limits</h2>
      <p>Third-party job boards and application forms may not meet the same accessibility standard. When a target site is difficult to use, the app should pause and let you continue there directly.</p>
    </LegalPage>
  );
}
