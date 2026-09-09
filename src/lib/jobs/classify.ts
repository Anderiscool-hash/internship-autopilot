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
 *
 * Seniority signals observed in real internship data:
 * - lead, head, architect, specialist: suggest mid-to-senior individual contributor
 * - executive, chief, president: company leadership
 * - counsel, partner, consultant: advisory/consulting roles
 * - advisor, officer: organizational roles
 * - supervisor: management
 * - II, III, IV: seniority roman numerals (as standalone words)
 *
 * Note: "sr" (without period) matches "Sr" in "Sr. Software Engineer" due to
 * case-insensitive word boundary matching.
 */
const REJECT_TERMS = [
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "experienced hire",
  "lead",         // Individual contributor + leader level
  "head",         // Department/team head
  "architect",    // Senior design role
  "specialist",   // Deep expertise signal
  "executive",    // Executive level
  "counsel",      // Legal/advisory counsel
  "partner",      // Partner-level role
  "consultant",   // Consulting role
  "supervisor",   // Supervisory role
  "advisor",      // Advisory role
  "officer",      // C-suite and other officers
  "chief",        // Chief-level roles (CTO, CIO, etc.)
  "president",    // President-level
  "sr",           // Senior abbreviation (matches "Sr" in "Sr. Engineer")
  "ii",           // Roman numeral II
  "iii",          // Roman numeral III
  "iv",           // Roman numeral IV
];

/**
 * Job title terms that suggest a student or entry-level role WITHOUT an
 * explicit intern keyword. These titles are genuinely ambiguous — they might
 * be student roles in a rotational program or entry-level hiring, or they
 * might be mid-career. Worth escalating to AI for a closer look.
 * See spec section 9: Early-Career Signals.
 *
 * Note: "junior" and "jr" are both included because they can appear in titles
 * as "Junior Software Engineer" (whole word) or "Jr." (abbreviation). Word
 * boundary matching will catch "junior" but "jr." with the period is trickier
 * — we include "jr" which matches "Jr" in "Jr. Engineer" due to case-insensitive
 * word boundary matching.
 */
const EARLY_CAREER_SIGNALS = [
  "campus",
  "university",
  "entry level",
  "entry-level",
  "rotational",
  "rotation",
  "program",
  "trainee",
  "junior",
  "jr",           // Matches "Jr" in "Jr. Developer"
  "new college",
  "college grad",
  "residency",
  "fellowship",
  "early career",
  "early-career",
  "associate",
  "analyst",
  "fellow",
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
 * - Early-career signals (AMBIGUOUS — worth an AI call)
 * - Nothing (REJECT — no student signal detected)
 *
 * Logic (in precedence order):
 *
 * a. keep-list AND reject-list both match
 *    → ambiguous (e.g., "Senior Intern" is contradictory)
 *
 * b. keep-list matches only
 *    → keep (explicit student/internship signal)
 *
 * c. reject-list matches only
 *    → reject (title shows seniority/experience)
 *
 * d. no keep/reject, but early-career signal matches
 *    → ambiguous (might be student role in rotational/entry-level program)
 *
 * e. nothing matches at all
 *    → reject (no student signal present)
 *
 * Why the default changed from ambiguous to reject:
 * Employers label internships explicitly — they're competing for student
 * talent and must advertise as such. A title with zero student signals is
 * strong evidence of "not a student role," not genuine uncertainty.
 *
 * This change is safe because the discovery system stores EVERY job
 * regardless of classifier verdict, so a wrongly-rejected title stays in
 * the database and can be re-classified later with an improved classifier.
 *
 * @param title - Job title string
 * @returns Classification result with verdict and reasoning
 */
export function classifyStudentRole(title: string): ClassificationResult {
  const matchesKeep = hasTermWithBoundary(title, KEEP_TERMS);
  const matchesReject = hasTermWithBoundary(title, REJECT_TERMS);
  const matchesEarlyCareer = hasTermWithBoundary(title, EARLY_CAREER_SIGNALS);

  // Rule (a): Both keep and reject match → ambiguous
  if (matchesKeep && matchesReject) {
    return {
      verdict: "ambiguous",
      reason: `Title matches both student terms ("${KEEP_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join('", "')}") and senior terms ("${REJECT_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join('", "')}"). Needs AI review.`,
    };
  }

  // Rule (b): Keep-list matches only → keep
  if (matchesKeep) {
    return {
      verdict: "keep",
      reason: `Title contains student/internship keyword(s): ${KEEP_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join(", ")}`,
    };
  }

  // Rule (c): Reject-list matches only → reject
  if (matchesReject) {
    return {
      verdict: "reject",
      reason: `Title contains senior/experienced keyword(s): ${REJECT_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join(", ")}`,
    };
  }

  // Rule (d): Early-career signal matches → ambiguous (narrow band worth AI call)
  if (matchesEarlyCareer) {
    return {
      verdict: "ambiguous",
      reason: `Title contains early-career signal(s): ${EARLY_CAREER_SIGNALS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(title)).join(", ")}. Needs AI review to determine if this is a student-appropriate role.`,
    };
  }

  // Rule (e): Nothing matches → reject (no student signal detected)
  // This is safe because all discovered jobs are stored regardless, allowing
  // re-classification later if the classifier improves.
  return {
    verdict: "reject",
    reason: `Title shows no student or early-career signal. Not matching any internship, entry-level, or student-focused keywords suggests this is a general professional role not targeted at students.`,
  };
}
