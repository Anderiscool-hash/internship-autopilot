/**
 * The job fit engine (spec §12).
 *
 * Spec §12 suggests seven weighted components. Every one of them turns out to
 * be computable by rule — token overlap, string matching, arithmetic on dates
 * — so none of this asks a language model anything. That matters beyond cost:
 * a rule-based score can explain itself exactly, and "why is this an 82?" has
 * a real answer rather than a plausible-sounding one.
 *
 * The design decision that shapes the file: a component with nothing to work
 * from returns null, not zero. If the profile lists no desired roles, role
 * similarity is unknown — scoring it zero would drag the total down and make a
 * good job look bad because of a blank form field. Unknown components are
 * dropped and the remaining weights renormalized, and the result reports how
 * much of the scoring weight it was actually able to use.
 *
 * That renormalization has a floor: see MIN_COVERAGE. Below it the engine
 * returns no score rather than a confident-looking number resting on almost
 * nothing, because the scores in this app are read side by side in a sorted
 * column, and two numbers that look the same have to mean roughly the same
 * thing.
 *
 * Everything here is pure. Spec §12's rule that only eligible jobs get scored
 * is enforced by the caller, not here.
 */

import type { JobRequirements } from "../eligibility/requirements";
import { educationRank, type EducationLevel } from "../eligibility/requirements";
import { inferEducationLevel } from "../eligibility/engine";

/** Weights from spec §12, as fractions of the total score. */
export const WEIGHTS = {
  roleSimilarity: 0.25,
  skillAlignment: 0.25,
  experienceAlignment: 0.15,
  projectRelevance: 0.1,
  educationAlignment: 0.1,
  location: 0.1,
  freshness: 0.05,
} as const;

/**
 * The least scoring weight a published score is allowed to rest on, 0-1.
 *
 * Skipped components are dropped from the total and the survivors are
 * renormalized, which is the right thing to do for one or two blanks but
 * quietly stops being right when most of the weight is missing. A profile with
 * nothing filled in but a posting date renormalizes freshness alone — five
 * percent of the weight — into a confident-looking "97% fit" that means only
 * "this was posted yesterday". Put that in a sorted column beside a 97% built
 * from the full seven components and the two numbers look identical while
 * saying completely different things.
 *
 * So below this line the engine declines to publish a number at all. Every
 * component and its explanation still come back, so the reader sees exactly
 * which blanks to fill in to earn a score.
 *
 * JUDGMENT CALL — why 0.6: it is the smallest threshold that still forces at
 * least one of the two 25% components (role similarity, skill alignment) to
 * have been scored, because everything else put together only adds up to 0.5.
 * Those two are the ones that actually compare the candidate to the work; a
 * score computed without either is a score about dates and geography.
 *
 * What it trades away: jobs that would previously have shown a renormalized
 * number now show "—" until the profile is filled in further. That is a real
 * loss of coverage in the job table, and it is the intended trade — a missing
 * number sends the reader to fix their profile, whereas a confident wrong
 * number sends them to apply.
 */
export const MIN_COVERAGE = 0.6;

export type FitComponentName = keyof typeof WEIGHTS;

/** One component's contribution. */
export interface FitComponent {
  name: FitComponentName;
  /** 0-1, or null when there was nothing to judge it on. */
  score: number | null;
  /** Plain-language explanation, shown next to the score. */
  detail: string;
}

/** The scored result (spec §12's "FIT SCORE: 92%"). */
export interface FitResult {
  /**
   * 0-100, rounded. Null when `coverage` came in below MIN_COVERAGE — either
   * nothing could be scored at all, or so little could that the renormalized
   * number would not be comparable with the other jobs in the list.
   */
  score: number | null;
  components: FitComponent[];
  /**
   * How much of spec §12's weight was actually scored, 0-1.
   *
   * A score built from a third of the weights is a much weaker claim than one
   * built from all of them, and the reader deserves to see which they are
   * looking at.
   */
  coverage: number;
}

/** The candidate side of the comparison. */
export interface FitProfile {
  desiredRoles: string[];
  skills: string[];
  preferredLocations: string[];
  remotePreference: "ON_SITE" | "REMOTE" | "HYBRID" | "ANY";
  degree: string | null;
  /** Technologies named in PROJECT facts from the Truth Ledger (spec §3). */
  projectTechnologies: string[];
}

/** The job side of the comparison. */
export interface FitJob {
  title: string;
  location: string | null;
  remoteType: "ON_SITE" | "REMOTE" | "HYBRID" | "UNKNOWN";
  /** Plain text, not HTML — callers strip tags first. */
  description: string;
  firstSeenAt: Date;
  requirements: JobRequirements;
}

/** Words too common to carry meaning when comparing a title to a wanted role. */
const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "for", "in", "at", "to", "with", "or",
  "intern", "internship", "summer", "fall", "winter", "spring", "program",
  "i", "ii", "iii", "senior", "junior", "new", "grad", "graduate", "student",
]);

/**
 * Do two words refer to the same thing?
 *
 * Needed because job titles and the roles people say they want are the same
 * words in different grammatical forms — "Software Engineering Intern" against
 * "Software Engineer, Intern" should not score half marks for a suffix.
 *
 * Two cheap rules, no stemming library: strip the common suffixes down to a
 * stem and compare, then fall back to a five-character shared prefix, which
 * catches "science"/"scientist" where suffix-stripping does not. Five rather
 * than four on purpose — four would match "data" to "database".
 */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (stem(a) === stem(b)) return true;

  const shared = sharedPrefixLength(a, b);
  return shared >= 5;
}

/** Repeatedly strip common suffixes while a real word remains. */
function stem(word: string): string {
  const suffixes = ["ings", "ing", "ers", "er", "ist", "ists", "s"];
  let current = word;

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (current.endsWith(suffix) && current.length - suffix.length >= 4) {
        current = current.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return current;
}

/** How many leading characters two words share. */
function sharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared;
}

/** Split text into comparable lowercase words. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Does this skill appear in the text?
 *
 * Matched on word boundaries so "R" does not match every word containing an r,
 * and "Go" does not match "Google". Skills with regex-significant characters
 * (C++, C#, .NET) are escaped rather than excluded — they are real skills and
 * dropping them would quietly under-score the people who have them.
 */
export function mentions(text: string, skill: string): boolean {
  const trimmed = skill.trim();
  if (trimmed.length === 0) return false;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b does not work against a trailing "+" or "#", so the boundary is only
  // asserted on the side where the term actually ends in a word character.
  const leading = /^\w/.test(trimmed) ? "\\b" : "";
  const trailing = /\w$/.test(trimmed) ? "\\b" : "";
  return new RegExp(`${leading}${escaped}${trailing}`, "i").test(text);
}

/**
 * Fraction of the candidate's wanted roles that overlap the job title.
 *
 * This is the only component that reads the job title at all, which makes its
 * behaviour when the profile is thin more important than it looks. Desired
 * roles are a field somebody has to type by hand — nothing fills them in the
 * way skills get filled in from an imported resume — so on a real profile they
 * are very often empty. When this component skipped in that case, its 25%
 * dropped out of the total and the job title stopped influencing the score by
 * any route whatsoever: "Software Engineering Intern" and "Warehouse
 * Operations Associate" with the same description came out identical.
 *
 * So when there are no desired roles, the title is compared against the
 * skills and project technologies the profile does have. That is a weaker
 * question than the one this component normally asks — "is this the job you
 * said you wanted" becomes "does the title name something you can do" — and
 * the detail line says so, because a reader comparing two scores deserves to
 * know which question was answered.
 *
 * Null is still returned when there is nothing on either side to compare, so
 * "unknown" never quietly becomes "zero".
 */
function roleSimilarity(profile: FitProfile, job: FitJob): FitComponent {
  const name: FitComponentName = "roleSimilarity";
  const titleWords = tokenize(job.title);

  if (profile.desiredRoles.length === 0) {
    return roleSimilarityFromSkills(profile, titleWords);
  }

  let best = 0;
  let bestRole = "";

  for (const role of profile.desiredRoles) {
    const roleWords = tokenize(role);
    if (roleWords.length === 0) continue;
    const overlap = roleWords.filter((word) =>
      titleWords.some((titleWord) => wordsMatch(word, titleWord)),
    ).length;
    const ratio = overlap / roleWords.length;
    if (ratio > best) {
      best = ratio;
      bestRole = role;
    }
  }

  return {
    name,
    score: best,
    detail:
      best === 0
        ? "The title matches none of your desired roles."
        : `Closest desired role: "${bestRole}" (${Math.round(best * 100)}% of its words in the title).`,
  };
}

/**
 * The no-desired-roles fallback: score the title against what the profile can do.
 *
 * The vocabulary is skills plus project technologies, run through the same
 * `tokenize` the normal path uses so that both sides are compared as the same
 * kind of thing, and matched with the same `wordsMatch`. No new matching rule
 * is introduced here on purpose — a second, subtly different notion of "these
 * two words mean the same thing" living in the same file is how scores start
 * disagreeing with their own explanations.
 *
 * JUDGMENT CALL — the fraction is of the TITLE's words, not of the profile's.
 * Dividing by the profile's word count would punish people for listing a lot
 * of skills: one perfect hit out of thirty listed technologies would read as
 * 3%. Dividing by the title's words asks the question that actually matters —
 * how much of what this job calls itself is something you have done.
 */
function roleSimilarityFromSkills(
  profile: FitProfile,
  titleWords: string[],
): FitComponent {
  const name: FitComponentName = "roleSimilarity";

  const vocabulary = [...profile.skills, ...profile.projectTechnologies].flatMap(
    (entry) => tokenize(entry),
  );

  // Nothing on the profile side at all. Unknown, not zero — the whole point of
  // this file's design is that a blank form does not look like a bad match.
  if (vocabulary.length === 0) {
    return {
      name,
      score: null,
      detail:
        "No desired roles set, and no skills or project technologies to compare the title against instead.",
    };
  }

  // Nothing on the job side either: a title like "Intern" is entirely stop
  // words, so there is genuinely nothing to judge.
  if (titleWords.length === 0) {
    return {
      name,
      score: null,
      detail: "The job title has no words specific enough to compare with your profile.",
    };
  }

  const matched = titleWords.filter((titleWord) =>
    vocabulary.some((word) => wordsMatch(word, titleWord)),
  );

  return {
    name,
    score: matched.length / titleWords.length,
    detail:
      matched.length === 0
        ? "No desired roles set — matched the title against your skills instead, and it names none of them."
        : `No desired roles set — matched the title against your skills instead: ${matched.slice(0, 6).join(", ")}.`,
  };
}

/** Fraction of the candidate's skills the description actually names. */
function skillAlignment(profile: FitProfile, job: FitJob): FitComponent {
  const name: FitComponentName = "skillAlignment";
  if (profile.skills.length === 0) {
    return { name, score: null, detail: "Your profile lists no skills." };
  }

  const matched = profile.skills.filter((skill) => mentions(job.description, skill));

  return {
    name,
    score: matched.length / profile.skills.length,
    detail:
      matched.length === 0
        ? "The posting names none of your skills."
        : `Names ${matched.length} of your ${profile.skills.length} skills: ${matched.slice(0, 6).join(", ")}.`,
  };
}

/**
 * How close the posting's experience demand is to what a student has.
 *
 * Full marks for a posting asking nothing, tapering to zero at five years.
 * The hard cut-off lives in the eligibility engine; this is the softer
 * question of how comfortable the fit is below that line.
 */
function experienceAlignment(job: FitJob): FitComponent {
  const name: FitComponentName = "experienceAlignment";
  const years = job.requirements.minimumExperienceYears;

  if (years === null) {
    return { name, score: null, detail: "The posting states no experience minimum." };
  }
  const score = Math.max(0, 1 - years / 5);
  return {
    name,
    score,
    detail:
      years === 0
        ? "Asks for no prior experience."
        : `Asks for ${years} year${years === 1 ? "" : "s"} of experience.`,
  };
}

/** Fraction of the candidate's project technologies the posting names. */
function projectRelevance(profile: FitProfile, job: FitJob): FitComponent {
  const name: FitComponentName = "projectRelevance";
  if (profile.projectTechnologies.length === 0) {
    return {
      name,
      score: null,
      detail: "No project technologies recorded in your Truth Ledger.",
    };
  }

  const matched = profile.projectTechnologies.filter((technology) =>
    mentions(job.description, technology),
  );

  return {
    name,
    score: matched.length / profile.projectTechnologies.length,
    detail:
      matched.length === 0
        ? "The posting names none of your project technologies."
        : `Overlaps your projects on: ${matched.slice(0, 6).join(", ")}.`,
  };
}

/** Whether the candidate's degree level matches what the posting wants. */
function educationAlignment(profile: FitProfile, job: FitJob): FitComponent {
  const name: FitComponentName = "educationAlignment";
  const required = job.requirements.educationLevel;
  const held = inferEducationLevel(profile.degree);

  if (required === null) {
    return { name, score: null, detail: "The posting states no degree requirement." };
  }
  if (held === null) {
    return { name, score: null, detail: "Your profile does not say what you are studying." };
  }

  const gap = educationRank(held) - educationRank(required as EducationLevel);
  // Exactly the level asked for is the best fit. Over-qualification is not a
  // problem for an internship but is not a better match either, so it tapers
  // gently rather than scoring full marks.
  const score = gap === 0 ? 1 : gap > 0 ? Math.max(0.6, 1 - gap * 0.2) : 0;
  return {
    name,
    score,
    detail: `Wants ${required}; you have ${held}.`,
  };
}

/** Location and remote preference together (spec §12 lists them as one 10%). */
function locationFit(profile: FitProfile, job: FitJob): FitComponent {
  const name: FitComponentName = "location";

  // A remote job satisfies any location preference, so it is judged on the
  // remote preference alone.
  if (job.remoteType === "REMOTE") {
    const wanted =
      profile.remotePreference === "REMOTE" || profile.remotePreference === "ANY";
    return {
      name,
      score: wanted ? 1 : 0.5,
      detail: wanted ? "Remote, which you want." : "Remote; you prefer on-site or hybrid.",
    };
  }

  if (profile.preferredLocations.length === 0) {
    return { name, score: null, detail: "Your profile lists no preferred locations." };
  }
  if (job.location === null) {
    return { name, score: null, detail: "The posting does not say where the job is." };
  }

  const matched = profile.preferredLocations.find((preferred) =>
    mentions(job.location as string, preferred),
  );

  return {
    name,
    score: matched ? 1 : 0,
    detail: matched
      ? `In ${matched}, which you want.`
      : `In ${job.location}, which is not on your list.`,
  };
}

/** Days after which a posting has lost all its freshness points. */
export const FRESHNESS_HORIZON_DAYS = 30;

/** How recently the posting turned up (spec §12's 5%). */
function freshness(job: FitJob, now: Date): FitComponent {
  const name: FitComponentName = "freshness";
  const days = (now.getTime() - job.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000);
  const score = Math.max(0, Math.min(1, 1 - days / FRESHNESS_HORIZON_DAYS));

  return {
    name,
    score,
    detail:
      days < 1
        ? "Found today."
        : `First seen ${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago.`,
  };
}

/**
 * Score one job against one profile.
 *
 * Only call this for jobs that passed the hard eligibility gate — spec §12 is
 * explicit that fit scoring comes second, and a fit score on a job the
 * candidate legally cannot take is a number that can only mislead.
 */
export function scoreFit(profile: FitProfile, job: FitJob, now: Date): FitResult {
  const components: FitComponent[] = [
    roleSimilarity(profile, job),
    skillAlignment(profile, job),
    experienceAlignment(job),
    projectRelevance(profile, job),
    educationAlignment(profile, job),
    locationFit(profile, job),
    freshness(job, now),
  ];

  let weighted = 0;
  let usedWeight = 0;
  for (const component of components) {
    if (component.score === null) continue;
    const weight = WEIGHTS[component.name];
    weighted += component.score * weight;
    usedWeight += weight;
  }

  // Too little of the weight was scorable for the renormalized number to mean
  // anything, so no number is published. Note what this deliberately is NOT:
  // it is not `weighted / Math.max(usedWeight, MIN_COVERAGE)`. That version
  // would keep producing a score by treating the missing weight as if it had
  // been scored zero — the exact "silence counts as a bad match" behaviour this
  // whole file is built to avoid. Refusing to answer is the honest option; the
  // components and their explanations still come back so the reader can see
  // which blanks to fill in.
  if (usedWeight < MIN_COVERAGE) {
    return { score: null, components, coverage: usedWeight };
  }

  return {
    score: Math.round((weighted / usedWeight) * 100),
    components,
    coverage: usedWeight,
  };
}
