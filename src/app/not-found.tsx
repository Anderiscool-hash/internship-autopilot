export default function NotFound() {
  return (
    <main className="page state-page">
      <p className="eyebrow">404 · Not found</p>
      <h1>That page isn&apos;t in this workspace.</h1>
      <p className="lede">
        The link may be outdated, or the record may have been removed.
      </p>
      <div className="state-actions">
        <a className="button button-primary" href="/">
          Open overview
        </a>
        <a className="button" href="/jobs">
          Browse jobs
        </a>
      </div>
    </main>
  );
}
