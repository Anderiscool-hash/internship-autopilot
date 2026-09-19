import { LegalPage } from "../legal-content";

export const metadata = { title: "How automation works | Internship Autopilot" };

export default function AutomationDisclosurePage() {
  return (
    <LegalPage
      eyebrow="Transparency"
      title="What the assistant can?and cannot?do."
      intro="Automation is useful only when you can see where it acts. This page makes the boundaries explicit."
    >
      <h2>Discovery and scoring</h2>
      <p>The app may collect public job postings from configured company boards, normalize them, classify likely student roles, and compare stated requirements with the profile facts you entered. These results are suggestions for your review, not hiring decisions.</p>
      <h2>Documents and AI</h2>
      <p>If you enable an AI provider, it may help extract resume fields or draft application materials from information you authorize. Review suggestions before saving them. The app should never invent a qualification, answer, employer, degree, work authorization status, or other personal fact on your behalf.</p>
      <h2>Browser assistance</h2>
      <p>The apply worker can open a browser and fill supported fields. It may stop for missing information, a login, a captcha, an ambiguous question, or a required review. A human should review the completed form and make the final submission decision.</p>
      <h2>What the system does not promise</h2>
      <p>Automation can miss fields, misunderstand wording, encounter changed forms, or report incomplete information. It does not guarantee a complete application, a compliant submission, an interview, or an offer. Check the employer?s requirements and the target site?s rules each time.</p>
      <h2>Your control</h2>
      <p>You can disable AI, stop the daemon, remove connected services, edit saved facts, and decline any application. Keep the review step enabled until you have tested the workflow and understand the risks.</p>
    </LegalPage>
  );
}
