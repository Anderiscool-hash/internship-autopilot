"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Internship Autopilot route failed", error);
  }, [error]);

  return (
    <main className="page state-page">
      <p className="eyebrow">Something interrupted this view</p>
      <h1>We couldn&apos;t load this page.</h1>
      <p className="lede">
        Your saved data has not been changed. Try the request again, or return to
        the overview and check the workspace status.
      </p>
      <div className="state-actions">
        <button className="button button-primary" type="button" onClick={reset}>
          Try again
        </button>
        <a className="button" href="/">
          Back to overview
        </a>
      </div>
    </main>
  );
}
