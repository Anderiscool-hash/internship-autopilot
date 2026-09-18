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

// The threshold for "how many years of experience can a posting demand and
// still plausibly be a student role". Imported rather than written as a bare
// 2 here so that this file and the eligibility engine can never drift apart:
// if someone retunes the engine's idea of a student-sized job, this classifier
// follows automatically. (engine.ts imports only ./requirements, which imports
// nothing, so this does not create an import cycle.)
import { DEFAULT_MAX_EXPERIENCE_YEARS } from "../eligibility/engine";

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
 * Return every term from a list that actually appears in the text, using the
 * same whole-word rule as hasTermWithBoundary.
 *
 * hasTermWithBoundary answers "did anything match?"; this answers "which
 * ones?", so a reason string can name the exact words that drove the verdict.
 *
 * @param text - String to search in (case-insensitive)
 * @param terms - Array of terms to match against
 * @returns The subset of terms that matched, in list order
 */
function matchedTerms(text: string, terms: string[]): string[] {
  return terms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(text));
}

/**
 * Evidence pulled from the body of a posting, used to second-guess a weak
 * title signal. Optional everywhere: a caller that has only a title keeps the
 * old behavior exactly.
 */
export interface PostingEvidence {
  /**
   * The smallest number of years of experience the posting demands, or null
   * when the posting never said. null means "no evidence", NOT "zero years".
   */
  minimumExperienceYears: number | null;
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
 * JUDGMENT CALL — the years-of-experience arbiter on rule (d):
 *
 * "ambiguous" was never meant to be a final answer. It means "a title alone
 * cannot settle this, so hand it to something that can look closer," and the
 * plan was for that something to be an AI call. That AI call does not exist
 * and never has. Meanwhile the alerting layer treats ambiguous as keep, so in
 * practice rule (d) has been a second keep list — which is how a "Financial
 * Data Analyst" wanting four years, and a "University Recruiter" wanting
 * five, ended up in a student's job feed.
 *
 * The fix is not to shorten EARLY_CAREER_SIGNALS. "Investment Banking
 * Analyst" and "Summer Associate" are real new-grad titles; dropping those
 * words would hide genuine internships, and a hidden internship is the one
 * mistake the candidate can never notice or undo. So the words stay and we
 * give the verdict better evidence instead.
 *
 * A posting that demands more years of experience than a student could
 * possibly have is direct, employer-written evidence that the title's student
 * flavor was a coincidence — "analyst" is simply what that company calls the
 * job, not a signal that they are hiring from campus. That is a real arbiter:
 * cheap, deterministic, and grounded in what the posting itself says.
 *
 * Three limits keep this honest:
 *
 * 1. It applies to rule (d) ONLY. Rules (a) and (b) turn on an explicit
 *    student keyword in the title — "Intern", "Co-op", "New Grad". A title
 *    that says "Intern" is the employer stating the role is for students, and
 *    that outranks anything the description says; long-experience language in
 *    a body often belongs to a boilerplate block, a parent job family, or the
 *    full-time role the internship converts into. So "Software Engineer
 *    Intern" stays keep even if the body asks for eight years, and "Senior
 *    Software Engineer Intern" stays ambiguous — a genuine contradiction is
 *    still a contradiction, and still deserves a human look.
 *
 * 2. Silence is not evidence. minimumExperienceYears === null means the
 *    posting never stated a number, which leaves the title exactly as
 *    ambiguous as it was.
 *
 * 3. Only a demand ABOVE the threshold rejects. At or under it, the posting
 *    is still plausibly open to a student, so the verdict is unchanged — an
 *    entry-level role asking for "1-2 years" is not ruled out.
 *
 * @param title - Job title string
 * @param posting - Optional evidence from the posting body. Omit it (or pass
 *   null) to get the historical title-only behavior, unchanged.
 * @returns Classification result with verdict and reasoning
 */
export function classifyStudentRole(
  title: string,
  posting?: PostingEvidence | null,
): ClassificationResult {
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
    const signals = matchedTerms(title, EARLY_CAREER_SIGNALS);

    // The arbiter described above. Note the ?? null: a caller may pass no
    // posting at all, so treat a missing object and a missing number the same
    // way — as no evidence.
    const yearsDemanded = posting?.minimumExperienceYears ?? null;

    if (yearsDemanded !== null && yearsDemanded > DEFAULT_MAX_EXPERIENCE_YEARS) {
      // Say both halves out loud: the weak word we matched on, and the number
      // that overrules it. Someone reading this verdict later should be able
      // to check our work without reopening the posting.
      const signalList = signals.map((s) => `"${s}"`).join(", ");
      const signalPhrase =
        signals.length === 1
          ? `Title's only student signal is ${signalList}`
          : `Title's only student signals are ${signalList}`;

      return {
        verdict: "reject",
        reason: `${signalPhrase}, but the posting asks for ${yearsDemanded} years of experience — more than the ${DEFAULT_MAX_EXPERIENCE_YEARS} typical of a student role.`,
      };
    }

    return {
      verdict: "ambiguous",
      reason: `Title contains early-career signal(s): ${signals.join(", ")}. Needs AI review to determine if this is a student-appropriate role.`,
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
