interface PageLoadingProps {
  label?: string;
  rows?: number;
}

export function PageLoading({
  label = "Loading workspace",
  rows = 4,
}: PageLoadingProps) {
  return (
    <main className="page page-wide state-page" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skeleton skeleton-eyebrow" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-lede" />
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton skeleton-panel" key={index} />
        ))}
      </div>
    </main>
  );
}
