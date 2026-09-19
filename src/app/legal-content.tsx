import Link from "next/link";

export function LegalPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="page page-narrow legal-page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="lede">{intro}</p>
      <div className="legal-content">{children}</div>
      <p className="legal-back"><Link href="/">Back to your workspace</Link></p>
    </main>
  );
}

export function LegalFooter() {
  return (
    <footer className="legal-footer">
      <span>Internship Autopilot</span>
      <nav aria-label="Legal">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/automation-disclosure">How automation works</Link>
        <Link href="/accessibility">Accessibility</Link>
      </nav>
    </footer>
  );
}
