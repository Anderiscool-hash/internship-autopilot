/**
 * The eligibility table from spec §11, rendered.
 *
 * The spec draws it as a checklist ending in ELIGIBLE or FAIL. This keeps that
 * shape and adds the third state the engine produces — a check nobody stated
 * enough facts to settle — because presenting an unknown as a tick would be
 * claiming something neither the posting nor the profile ever said.
 */

import type { EligibilityResult, CheckVerdict } from "@/lib/eligibility/engine";
import type { JobRequirements } from "@/lib/eligibility/requirements";

/** The mark shown against each check. */
const MARKS: Record<CheckVerdict, string> = {
  pass: "✓",
  fail: "✗",
  unknown: "?",
};

/** What the overall verdict should say, in the spec's own vocabulary. */
const VERDICT_TEXT = {
  eligible: "ELIGIBLE ✓",
  ineligible: "ELIGIBILITY = FAIL → DO NOT APPLY",
  unconfirmed: "NOT CONFIRMED — some facts are missing",
} as const;

/** Requirements worth restating, so the reader can see what was read out of the posting. */
function requirementLines(requirements: JobRequirements): string[] {
  const lines: string[] = [];
  if (requirements.educationLevel) lines.push(`Degree: ${requirements.educationLevel}`);
  if (requirements.graduationWindow) {
    const { from, to } = requirements.graduationWindow;
    lines.push(`Graduation: ${from === to ? from : `${from}–${to}`}`);
  }
  if (requirements.minimumExperienceYears !== null) {
    lines.push(`Experience: ${requirements.minimumExperienceYears} years`);
  }
  if (requirements.sponsorship !== "unknown") {
    lines.push(`Sponsorship: ${requirements.sponsorship}`);
  }
  if (requirements.citizenshipRequired) {
    lines.push(`Citizenship: ${requirements.citizenshipRequired}`);
  }
  if (requirements.clearanceRequired) lines.push("Security clearance required");
  return lines;
}

export function EligibilityTable({
  eligibility,
  requirements,
  hasProfile,
}: {
  eligibility: EligibilityResult | null;
  requirements: JobRequirements;
  hasProfile: boolean;
}) {
  const stated = requirementLines(requirements);

  return (
    <section>
      <h2>Eligibility</h2>

      <p className="note">
        Hard requirements only — this is not a match score. Read straight out of
        the posting text by rule, with no AI involved, so anything the posting
        phrased unusually may simply not have been picked up.
      </p>

      {stated.length > 0 ? (
        <p className="requirements">
          <strong>Stated by this posting:</strong> {stated.join(" · ")}
        </p>
      ) : (
        <p className="requirements">
          This posting states none of the hard requirements we know how to read.
        </p>
      )}

      {!hasProfile || eligibility === null ? (
        <div className="notice">
          Nothing to check against yet — <a href="/profile">fill in your profile</a> and
          this becomes a real answer.
        </div>
      ) : (
        <>
          <table className="checks">
            <tbody>
              {eligibility.checks.map((check) => (
                <tr key={check.label} className={`check-${check.verdict}`}>
                  <th scope="row">{check.label}</th>
                  <td className="mark">{MARKS[check.verdict]}</td>
                  <td>{check.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className={`verdict verdict-${eligibility.verdict}`}>
            {VERDICT_TEXT[eligibility.verdict]}
          </p>
        </>
      )}
    </section>
  );
}
