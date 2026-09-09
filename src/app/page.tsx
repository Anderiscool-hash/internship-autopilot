// The dashboard home page.
//
// Right now this is a placeholder that states where the build is. It gets
// replaced in Phase 2 by the real job dashboard (spec section 40), which lists
// discovered internships with their eligibility verdict and fit score.

export default function HomePage() {
  return (
    <main className="page">
      <h1>Internship Autopilot</h1>
      <p className="lede">
        Continuous discovery → eligibility → fit scoring → tailored documents →
        preflight → apply → tracking.
      </p>

      <section>
        <h2>Status</h2>
        <p>
          <strong>Phase 1 — Foundation.</strong> Database, profile, truth
          ledger, and company registry are being built. The job dashboard
          arrives in Phase 2.
        </p>
      </section>
    </main>
  );
}
