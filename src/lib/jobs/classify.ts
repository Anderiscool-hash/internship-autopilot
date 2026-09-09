/**
 * Student role classifier.
 *
 * A fast, cheap pre-filter that categorizes job titles before running
 * expensive AI analysis. This runs on every discovered job and returns
 * verdicts that guide downstream processing.
 *
 * Goals:
 * - KEEP obvious student/internship roles (low cost, high signal)
 * - REJECT obvious senior/experienced roles (save compute)
 * - AMBIGUOUS for titles matching both keep and reject lists (AI decides)
 * - AMBIGUOUS for unmatched titles (never silently lose real jobs)
 *
 * See spec section 9: Student Role Classifier.
 */

/**
 * Classification result.
 * Guides whether a job should be kept, rejected, or escalated to AI analysis.
 */
export interface ClassificationResult {
  /** Verdict: keep, reject, or ambiguous (needs AI) */
  verdict: "keep" | "reject" | "ambiguous";

  /** Explanation of why this verdict was returned */
  reason: string;
}

/**
 * Job title terms that indicate a student/early-career role.
 * Matches whole words only (word-boundary matching).
 * See spec section 9: Keep.
 */
const KEEP_TERMS = [
  "internship",
  "intern",
  "co-op",
  "coop", // Variations of co-op
  "student",
  "apprentice",
  "summer analyst",
  "summer associate",
  "new grad",
  // "new grad" will NOT match "New Graduate Software Engineer": the \b after
  // "grad" fails against the "u" that follows. Both spellings are common in
  // real postings, so both are listed.
  "new graduate",
  "graduate program",
];

/**
 * Job title terms that indicate an experienced/senior role.
 * Matches whole words only (word-boundary matching).
 * These roles are typically not suitable for students or new graduates.
 * See spec section 9: Reject.
 */
const REJECT_TERMS = [
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "experienced hire",
];

/**
 * Test whether a string matches any term in a list using word boundaries.
 *
 * Word boundary matching ensures:
 * - "intern" matches "software intern" but NOT "internal auditor"
 * - "principal" does NOT match inside "principle" or "principality"
 * - "staff" does NOT match inside "understaffed"
 *
 * The regex uses word boundaries (\b) to ensure whole-word matching only.
 *
 * @param text - String to search in (case-insensitive)
 * @param terms - Array of terms to match against
 * @returns true if any term matches with word boundaries
 */
function hasTermWithBoundary(text: string, terms: string[]): boolean {
  const lowerText = text.toLowerCase();

  for (const term of terms) {
    // Create a regex that matches the term at word boundaries
    const regex = new RegExp(`\\b${term}\\b`, "i");
    if (regex.test(lowerText)) {
      return true;
    }
  }

  return false;
}

/**
 * Classify a job title as suitable for students or not.
 *
 * This is a fast, heuristic-based filter that runs on every discovered job.
 * It looks for keywords in the title that clearly indicate:
 * - Student/internship roles (KEEP)
 * - Senior/experienced roles (REJECT)
 * - Both (AMBIGUOUS — let AI decide)
 * - Neither (AMBIGUOUS — don't silently drop it)
 *
 * Why ambiguous for unmatched titles:
 * Some legitimate student roles have non-obvious titles like "Associate" or
 * "Technical Program Manager" (rotational program). Returning "reject" would
 * silently lose these jobs forever. Instead, we mark them "ambiguous" so the
 * AI can make the final call.
 *
 * @param title - Job title string
 * @returns Classification result with verdict and reasoning
 */
export function classifyStudentRole(title: string): ClassificationResult {
  const matchesKeep = hasTermWithBoundary(title, KEEP_TERMS);
  const matchesReject = hasTermWithBoundary(title, REJECT_TERMS);

  // Both lists match → ambiguous (e.g., "Senior Intern" is contradictory)
  if (matchesKeep && matchesReject) {
    return {
      verdict: "ambiguous",
      reason: `Title matches both student terms ("${KEEP_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join('", "')}") and senior terms ("${REJECT_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join('", "')}"). Needs AI review.`,
    };
  }

  // Only keep-list matches → keep
  if (matchesKeep) {
    return {
      verdict: "keep",
      reason: `Title contains student/internship keyword(s): ${KEEP_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join(", ")}`,
    };
  }

  // Only reject-list matches → reject
  if (matchesReject) {
    return {
      verdict: "reject",
      reason: `Title contains senior/experienced keyword(s): ${REJECT_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join(", ")}`,
    };
  }

  // No matches at all → ambiguous (don't silently discard)
  return {
    verdict: "ambiguous",
    reason: `Title does not match known student or senior keywords. Needs AI review to determine if this is a student-appropriate role.`,
  };
}
