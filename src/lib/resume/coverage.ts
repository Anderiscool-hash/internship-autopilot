/** Evidence-only resume coverage scoring (spec 13). */
export type ResumeCoverageCandidate = string | { text?: string | null } | null | undefined;

export interface ResumeCoverageRequirements {
  required?: readonly string[];
  preferred?: readonly string[];
}

export type ResumeCoveragePriority = "required" | "preferred";
export type ResumeCoverageStatus = "matched" | "missing" | "unknown";

export interface ResumeCoverageItem {
  requirement: string;
  priority: ResumeCoveragePriority;
  status: ResumeCoverageStatus;
  /** Verbatim resume lines that explicitly support a match. */
  evidence: string[];
}

export interface ResumeCoverageResult {
  /** 0-100, or null when text or requirements are unavailable. */
  score: number | null;
  items: ResumeCoverageItem[];
}

interface NormalizedRequirement {
  requirement: string;
  normalized: string;
  priority: ResumeCoveragePriority;
}

const PRIORITIES: readonly ResumeCoveragePriority[] = ["required", "preferred"];
const WEIGHTS: Record<ResumeCoveragePriority, number> = { required: 0.8, preferred: 0.2 };

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Preserve input order within each priority, dedupe normalized phrases, and
 * give a required duplicate priority over its preferred occurrence.
 */
function normalizedRequirements(
  requirements: ResumeCoverageRequirements,
): NormalizedRequirement[] {
  const found = new Map<string, NormalizedRequirement>();
  for (const priority of PRIORITIES) {
    for (const raw of requirements[priority] ?? []) {
      const phrase = normalize(raw);
      if (phrase.length === 0) continue;
      const existing = found.get(phrase);
      if (!existing) {
        found.set(phrase, { requirement: raw.trim(), normalized: phrase, priority });
      } else if (priority === "required") {
        existing.priority = "required";
      }
    }
  }
  return [...found.values()].sort(
    (left, right) => PRIORITIES.indexOf(left.priority) - PRIORITIES.indexOf(right.priority),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

/**
 * Letter/digit lookarounds, rather than a normal word boundary, support C++,
 * C#, and .NET while rejecting Go in Google and R in Ruby.
 */
function matchesLine(line: string, phrase: string): boolean {
  const expression = escapeRegExp(phrase).replace(/\\ /g, "\\s+");
  return new RegExp("(?<![A-Za-z0-9])" + expression + "(?![A-Za-z0-9])", "i").test(line);
}

function textOf(candidate: ResumeCoverageCandidate): { known: boolean; text: string } {
  if (typeof candidate === "string") return { known: true, text: candidate };
  if (candidate?.text === undefined || candidate.text === null) return { known: false, text: "" };
  return { known: true, text: candidate.text };
}

/**
 * Score how well a resume communicates the posting's requirements. Required
 * and preferred items weigh 80/20, renormalized if only one class is supplied.
 */
export function scoreResumeCoverage(
  candidate: ResumeCoverageCandidate,
  requirements: ResumeCoverageRequirements,
): ResumeCoverageResult {
  const requirementsList = normalizedRequirements(requirements);
  const candidateText = textOf(candidate);

  if (!candidateText.known) {
    return {
      score: null,
      items: requirementsList.map((item) => ({
        requirement: item.requirement,
        priority: item.priority,
        status: "unknown",
        evidence: [],
      })),
    };
  }

  const lines = candidateText.text.split(/\r?\n/);
  const items = requirementsList.map((item) => {
    const evidence = lines.filter((line) => matchesLine(line, item.normalized));
    return {
      requirement: item.requirement,
      priority: item.priority,
      status: evidence.length > 0 ? "matched" : "missing",
      evidence,
    } satisfies ResumeCoverageItem;
  });
  const classes = PRIORITIES.filter((priority) => items.some((item) => item.priority === priority));
  if (classes.length === 0) return { score: null, items };

  const usedWeight = classes.reduce((sum, priority) => sum + WEIGHTS[priority], 0);
  const score = classes.reduce((sum, priority) => {
    const group = items.filter((item) => item.priority === priority);
    return sum + (group.filter((item) => item.status === "matched").length / group.length) * WEIGHTS[priority];
  }, 0);
  return { score: Math.round((score / usedWeight) * 100), items };
}
