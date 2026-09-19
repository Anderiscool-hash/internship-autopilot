import { LegalPage } from "../legal-content";

export const metadata = { title: "Terms | Internship Autopilot" };

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Use Autopilot with your judgment."
      intro="These are plain-language product terms for review. They are not a substitute for terms drafted for your business, jurisdiction, and deployment."
    >
      <p className="legal-updated">Draft for review ? Last updated September 18, 2026</p>
      <h2>What the product does</h2>
      <p>Internship Autopilot helps you discover, organize, evaluate, prepare, and track internship applications. It is a productivity tool. It is not an employer, recruiter, staffing agency, lawyer, immigration adviser, or employment guarantee.</p>
      <h2>Your responsibilities</h2>
      <p>You are responsible for the accuracy of your profile and documents, the accounts and credentials you connect, the jobs you choose, and the final contents of every application. Review every generated or filled field. Do not allow an application to be submitted without your authorization.</p>
      <h2>Acceptable use</h2>
      <p>Use the app only where automation is permitted and only with accounts and information you are authorized to use. Do not bypass captchas, access controls, rate limits, or a job board?s terms. Do not use the app to misrepresent your identity, qualifications, work authorization, or experience.</p>
      <h2>No promises about outcomes</h2>
      <p>Job listings can be incomplete, stale, duplicated, or incorrectly classified. Fit and eligibility results are estimates based on the information available. We do not promise that a listing is accurate, that an employer will respond, or that an application will be accepted.</p>
      <h2>Third-party services</h2>
      <p>Job boards, email services, AI providers, and browser targets are operated by others. Their availability, policies, content, and decisions are outside Autopilot?s control. Your use of those services remains subject to their terms.</p>
      <h2>Contact</h2>
      <p>Before publishing, identify the legal operator, governing law, limitation language, support contact, and an effective way to report abuse or security issues: <a href="mailto:[support-contact@example.com]">[support-contact@example.com]</a>.</p>
    </LegalPage>
  );
}
