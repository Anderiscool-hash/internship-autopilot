/**
 * The fit score, with its working shown (spec §12).
 *
 * A single "82%" is not much use on its own — the reason to show the
 * breakdown is that the score is only as good as the profile behind it, and
 * seeing "skill alignment: your profile lists no skills" tells the reader
 * exactly what to go and fix.
 */

import { WEIGHTS, type FitResult } from "@/lib/fit/score";

/** Human labels for the component names. */
const LABELS: Record<keyof typeof WEIGHTS, string> = {
  roleSimilarity: "Role similarity",
  skillAlignment: "Skill alignment",
  experienceAlignment: "Experience alignment",
  projectRelevance: "Project relevance",
  educationAlignment: "Education alignment",
  location: "Location",
  freshness: "Posting freshness",
};

export function FitBreakdown({
  fit,
  reason,
}: {
  fit: FitResult | null;
  /** Why there is no score, when there is none. */
  reason: string;
}) {
  return (
    <section>
      <h2>Fit</h2>

      {fit === null ? (
        <p className="note">{reason}</p>
      ) : (
        <>
          {/*
            A missing score is not a missing answer. The breakdown below is
            what explains WHY there is no number, so it renders either way —
            the reader can see which rows say "skipped" and go fill those
            gaps in. Hiding the table here would leave them with a dash and
            no way to act on it.
          */}
          {fit.score === null ? (
            <>
              <p className="fit-headline">FIT SCORE: not enough to judge</p>
              <p className="note">
                {reason} Too little of your profile could be compared against
                this posting to stand behind a percentage — only{" "}
                {Math.round(fit.coverage * 100)}% of the weights below were
                scored. The skipped rows are the ones to fill in.
              </p>
            </>
          ) : (
            <>
              <p className="fit-headline">FIT SCORE: {fit.score}%</p>
              <p className="note">
                Computed by rule, not by a model — every line below is a number
                this app can show you the arithmetic for. Scored on{" "}
                {Math.round(fit.coverage * 100)}% of the weights; components
                neither the posting nor your profile said enough about are
                skipped rather than counted as zero.
              </p>
            </>
          )}

          <div
            className="table-scroll"
            role="region"
            aria-label="Fit score breakdown"
            tabIndex={0}
          >
            <table className="fit">
              <tbody>
                {fit.components.map((component) => (
                  <tr key={component.name}>
                    <th scope="row">{LABELS[component.name]}</th>
                    <td className="weight">
                      {Math.round(WEIGHTS[component.name] * 100)}%
                    </td>
                    <td className="points">
                      {component.score === null
                        ? "skipped"
                        : `${Math.round(component.score * 100)}`}
                    </td>
                    <td>{component.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
