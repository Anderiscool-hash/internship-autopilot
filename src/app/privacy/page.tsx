import { LegalPage } from "../legal-content";

export const metadata = { title: "Privacy | Internship Autopilot" };

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Your application data stays yours."
      intro="This draft explains the local-first data practices the product is designed around. Replace the bracketed contact details and have counsel review it before publishing."
    >
      <p className="legal-updated">Draft for review ? Last updated September 18, 2026</p>
      <h2>What we collect</h2>
      <p>You may choose to provide your name, contact details, education, work history, resume, answer-bank responses, job saves, application notes, mailbox connection details, and application outcomes. The app also records jobs it discovers and technical run history so it can show your workspace.</p>
      <h2>Why we use it</h2>
      <p>We use this information to search and organize opportunities, check the profile information you provide against job requirements, prepare application materials, fill forms at your direction, and track outcomes. We do not use your information to make employment decisions for employers.</p>
      <h2>Where it is stored</h2>
      <p>In the local development setup, profile data, documents, browser sessions, and application records are stored on your computer in the app?s configured data and storage locations. If you deploy a hosted version, this section must be rewritten to name the infrastructure, processors, regions, retention periods, and security controls actually used.</p>
      <h2>Third parties</h2>
      <p>The app may connect to job boards, email providers, browser automation targets, and an AI provider only when you configure and authorize those connections. Their own privacy policies and terms apply. Do not connect a service unless you understand what data it shares.</p>
      <h2>Retention and deletion</h2>
      <p>You can remove profile facts, documents, answers, saved jobs, and local records from the app or its configured storage. Before launch, publish the exact deletion steps and a contact for requests: <a href="mailto:[privacy-contact@example.com]">[privacy-contact@example.com]</a>.</p>
      <h2>Your choices</h2>
      <p>You can decline optional fields, disable AI features, disconnect a mailbox, stop the apply worker, and review an application before submission. We do not sell personal information. If your deployment is subject to a privacy law with additional rights, add the required request and appeal process here.</p>
      <h2>Questions</h2>
      <p>For privacy questions or a request to access, correct, or delete information, contact <a href="mailto:[privacy-contact@example.com]">[privacy-contact@example.com]</a>. Replace this placeholder before publishing.</p>
    </LegalPage>
  );
}
