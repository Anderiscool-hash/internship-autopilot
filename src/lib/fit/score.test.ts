/**
 * Tests for the fit engine (spec §12).
 *
 * The behaviour worth protecting: a blank profile field makes a component
 * unknown, not zero. Scoring silence as zero would punish a good job for a
 * form the candidate has not finished filling in — and would make the total
 * meaningless as a way to rank jobs against each other.
 */

import { describe, it, expect } from "vitest";
import { NO_REQUIREMENTS, type JobRequirements } from "../eligibility/requirements";
import {
  mentions,
  MIN_COVERAGE,
  scoreFit,
  WEIGHTS,
  wordsMatch,
  type FitJob,
  type FitProfile,
} from "./score";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function profile(overrides: Partial<FitProfile> = {}): FitProfile {
  return {
    desiredRoles: ["Software Engineering Intern"],
    skills: ["Python", "TypeScript", "SQL", "React"],
    preferredLocations: ["New York"],
    remotePreference: "ANY",
    degree: "BS Computer Science",
    projectTechnologies: ["TypeScript"],
    ...overrides,
  };
}

function job(overrides: Partial<FitJob> = {}): FitJob {
  return {
    title: "Software Engineering Intern",
    location: "New York, NY",
    remoteType: "ON_SITE",
    description: "You will write Python and SQL. Experience with React is a plus.",
    firstSeenAt: new Date(NOW.getTime() - DAY),
    requirements: { ...NO_REQUIREMENTS } as JobRequirements,
    ...overrides,
  };
}

/** Pull one component out of a result. */
function component(result: ReturnType<typeof scoreFit>, name: string) {
  const found = result.components.find((item) => item.name === name);
  if (!found) throw new Error(`no component ${name}`);
  return found;
}

describe("mentions", () => {
  it("matches on word boundaries", () => {
    expect(mentions("We use Go and Rust", "Go")).toBe(true);
    expect(mentions("We use Google Cloud", "Go")).toBe(false);
    expect(mentions("Strong R skills", "R")).toBe(true);
    expect(mentions("Strong Ruby skills", "R")).toBe(false);
  });

  it("handles skills with punctuation in them", () => {
    expect(mentions("Experience with C++ required", "C++")).toBe(true);
    expect(mentions("Experience with C# required", "C#")).toBe(true);
    expect(mentions("Built on .NET", ".NET")).toBe(true);
    expect(mentions("Experience with C required", "C++")).toBe(false);
  });

  it("is case insensitive and ignores blank skills", () => {
    expect(mentions("we use PYTHON", "python")).toBe(true);
    expect(mentions("anything", "  ")).toBe(false);
  });
});

describe("wordsMatch", () => {
  it("matches the same word in different grammatical forms", () => {
    expect(wordsMatch("engineering", "engineer")).toBe(true);
    expect(wordsMatch("engineer", "engineers")).toBe(true);
    expect(wordsMatch("science", "scientist")).toBe(true);
    expect(wordsMatch("analyst", "analytics")).toBe(true);
  });

  it("does not match words that merely start alike", () => {
    expect(wordsMatch("data", "database")).toBe(false);
    expect(wordsMatch("machine", "mac")).toBe(false);
  });

  it("does not match unrelated words", () => {
    expect(wordsMatch("software", "hardware")).toBe(false);
    expect(wordsMatch("python", "java")).toBe(false);
  });
});

describe("scoreFit", () => {
  it("does not penalise a title for grammatical form", () => {
    const result = scoreFit(
      profile({ desiredRoles: ["Software Engineering Intern"] }),
      job({ title: "Software Engineer, Intern (Summer or Winter)" }),
      NOW,
    );
    const role = result.components.find((item) => item.name === "roleSimilarity");
    expect(role?.score).toBe(1);
  });

  it("scores a well-matched job highly", () => {
    const result = scoreFit(profile(), job(), NOW);
    expect(result.score).not.toBeNull();
    expect(result.score as number).toBeGreaterThan(70);
  });

  it("scores an unrelated job low", () => {
    const result = scoreFit(
      profile(),
      job({
        title: "Warehouse Operations Associate",
        location: "Reno, NV",
        description: "Lift boxes and operate a forklift.",
        firstSeenAt: new Date(NOW.getTime() - 40 * DAY),
      }),
      NOW,
    );
    expect(result.score as number).toBeLessThan(20);
  });

  it("treats a blank profile field as unknown, not as zero", () => {
    // The job is fully specified (experience and education stated) so that
    // dropping skills still leaves 75% of the weight scored — comfortably
    // above MIN_COVERAGE. This test is about one blank field being survivable;
    // the separate coverage-floor tests below are about a profile so thin that
    // the number stops being comparable.
    const specified = job({
      requirements: {
        ...NO_REQUIREMENTS,
        minimumExperienceYears: 0,
        educationLevel: "bachelors",
      } as JobRequirements,
    });
    const withSkills = scoreFit(profile(), specified, NOW);
    const withoutSkills = scoreFit(profile({ skills: [] }), specified, NOW);

    expect(component(withoutSkills, "skillAlignment").score).toBeNull();
    // Dropping a component the job scored well on should not raise the score;
    // the point is that it does not crater it either.
    expect(withoutSkills.score as number).toBeGreaterThan(50);
    expect(withoutSkills.coverage).toBeLessThan(withSkills.coverage);
  });

  it("reports how much of the weight it could actually use", () => {
    const full = scoreFit(profile(), job({ requirements: { ...NO_REQUIREMENTS, minimumExperienceYears: 0, educationLevel: "bachelors" } }), NOW);
    expect(full.coverage).toBeCloseTo(1, 5);

    const sparse = scoreFit(
      profile({ desiredRoles: [], skills: [], preferredLocations: [], projectTechnologies: [] }),
      job(),
      NOW,
    );
    expect(sparse.coverage).toBeCloseTo(WEIGHTS.freshness, 5);
  });

  it("publishes no score when almost nothing could be judged", () => {
    // Freshness always scores, so a profile this empty leaves exactly 5% of
    // the weight in play. Renormalizing that into a number would produce a
    // "97% fit" that means nothing but "posted yesterday" — so no number is
    // published. The components still come back, blanks and all, because the
    // list of skipped components IS the useful output here: it is the
    // to-do list for the profile.
    const result = scoreFit(
      profile({ desiredRoles: [], skills: [], preferredLocations: [], projectTechnologies: [], degree: null }),
      job(),
      NOW,
    );
    expect(result.score).toBeNull();
    expect(result.coverage).toBeCloseTo(WEIGHTS.freshness, 5);
    expect(result.components.filter((item) => item.score === null).length).toBe(6);
    expect(result.components).toHaveLength(7);
    for (const item of result.components) {
      expect(item.detail.length, item.name).toBeGreaterThan(0);
    }
  });

  it("gives full marks for skills the posting names and none for those it does not", () => {
    const all = scoreFit(
      profile({ skills: ["Python"] }),
      job({ description: "Python all day." }),
      NOW,
    );
    expect(component(all, "skillAlignment").score).toBe(1);

    const none = scoreFit(
      profile({ skills: ["Haskell"] }),
      job({ description: "Python all day." }),
      NOW,
    );
    expect(component(none, "skillAlignment").score).toBe(0);
  });

  it("scores a remote job against the remote preference, not the city list", () => {
    const wanted = scoreFit(
      profile({ remotePreference: "REMOTE", preferredLocations: ["New York"] }),
      job({ remoteType: "REMOTE", location: "Anywhere" }),
      NOW,
    );
    expect(component(wanted, "location").score).toBe(1);

    const unwanted = scoreFit(
      profile({ remotePreference: "ON_SITE", preferredLocations: ["New York"] }),
      job({ remoteType: "REMOTE", location: "Anywhere" }),
      NOW,
    );
    expect(component(unwanted, "location").score).toBe(0.5);
  });

  it("decays freshness over the horizon", () => {
    const today = scoreFit(profile(), job({ firstSeenAt: NOW }), NOW);
    const old = scoreFit(
      profile(),
      job({ firstSeenAt: new Date(NOW.getTime() - 60 * DAY) }),
      NOW,
    );
    expect(component(today, "freshness").score).toBe(1);
    expect(component(old, "freshness").score).toBe(0);
  });

  it("penalises experience demands without hard-failing them", () => {
    const none = scoreFit(
      profile(),
      job({ requirements: { ...NO_REQUIREMENTS, minimumExperienceYears: 0 } }),
      NOW,
    );
    const some = scoreFit(
      profile(),
      job({ requirements: { ...NO_REQUIREMENTS, minimumExperienceYears: 2 } }),
      NOW,
    );
    expect(component(none, "experienceAlignment").score).toBe(1);
    expect(component(some, "experienceAlignment").score).toBeCloseTo(0.6, 5);
  });

  it("scores education alignment best at exactly the level asked for", () => {
    const exact = scoreFit(
      profile({ degree: "BS Computer Science" }),
      job({ requirements: { ...NO_REQUIREMENTS, educationLevel: "bachelors" } }),
      NOW,
    );
    const over = scoreFit(
      profile({ degree: "MS Computer Science" }),
      job({ requirements: { ...NO_REQUIREMENTS, educationLevel: "bachelors" } }),
      NOW,
    );
    const under = scoreFit(
      profile({ degree: "BS Computer Science" }),
      job({ requirements: { ...NO_REQUIREMENTS, educationLevel: "masters" } }),
      NOW,
    );
    expect(component(exact, "educationAlignment").score).toBe(1);
    expect(component(over, "educationAlignment").score).toBe(0.8);
    expect(component(under, "educationAlignment").score).toBe(0);
  });

  it("every component carries an explanation", () => {
    const result = scoreFit(profile(), job(), NOW);
    for (const item of result.components) {
      expect(item.detail.length, item.name).toBeGreaterThan(0);
    }
  });

  it("uses exactly spec §12's weights, summing to 1", () => {
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(WEIGHTS.roleSimilarity).toBe(0.25);
    expect(WEIGHTS.skillAlignment).toBe(0.25);
    expect(WEIGHTS.experienceAlignment).toBe(0.15);
    expect(WEIGHTS.projectRelevance).toBe(0.1);
    expect(WEIGHTS.educationAlignment).toBe(0.1);
    expect(WEIGHTS.location).toBe(0.1);
    expect(WEIGHTS.freshness).toBe(0.05);
  });
});

/**
 * The no-desired-roles fallback.
 *
 * Desired roles are typed by hand and nothing prefills them, so on a profile
 * built by seeding and importing they are simply empty — which used to make
 * roleSimilarity skip, take its 25% out of the total with it, and leave the
 * job title influencing the score by no route at all.
 */
describe("roleSimilarity with no desired roles set", () => {
  it("still lets the job title move the score", () => {
    // Everything but the title is identical between the two jobs, so any
    // difference in the total is the title's doing and nothing else.
    const thin = profile({
      desiredRoles: [],
      skills: ["Python", "TypeScript", "Software Development"],
    });
    const relevant = scoreFit(thin, job({ title: "Software Engineering Intern" }), NOW);
    const irrelevant = scoreFit(thin, job({ title: "Warehouse Operations Associate" }), NOW);

    expect(relevant.score).not.toBeNull();
    expect(irrelevant.score).not.toBeNull();
    expect(relevant.score as number).toBeGreaterThan(irrelevant.score as number);
  });

  it("says in the detail which question it actually answered", () => {
    const result = scoreFit(
      profile({ desiredRoles: [], skills: ["Python", "Software Development"] }),
      job({ title: "Software Engineering Intern" }),
      NOW,
    );
    const role = component(result, "roleSimilarity");
    expect(role.score).not.toBeNull();
    // The reader must be able to tell a title scored against wanted roles from
    // a title scored against skills; they are different claims.
    expect(role.detail).toContain("No desired roles set");
  });

  /**
   * KNOWN LIMITATION, asserted so it is visible rather than folklore.
   *
   * The fallback compares words, and "software"/"engineering" share no word
   * with "python"/"typescript". Nothing in this file knows that Python is a
   * software-engineering skill — that is domain knowledge, and supplying it
   * would mean adding a role-family vocabulary, which is a bigger decision
   * than this fix. So a profile whose skills are only bare technology names
   * still cannot tell those two titles apart. It scores them both 0 rather
   * than skipping the component, which at least keeps the 25% in the
   * denominator where the other components can be seen through it.
   *
   * If a role-family vocabulary is ever added, this test should fail. That is
   * the point of it.
   */
  it("cannot separate two titles that share no words with the profile", () => {
    const thin = profile({ desiredRoles: [], skills: ["Python", "TypeScript"] });
    const relevant = scoreFit(thin, job({ title: "Software Engineering Intern" }), NOW);
    const irrelevant = scoreFit(thin, job({ title: "Warehouse Operations Associate" }), NOW);

    expect(component(relevant, "roleSimilarity").score).toBe(0);
    expect(component(irrelevant, "roleSimilarity").score).toBe(0);
    expect(relevant.score).toBe(irrelevant.score);
  });

  it("still returns unknown when there is nothing at all to compare with", () => {
    const result = scoreFit(
      profile({ desiredRoles: [], skills: [], projectTechnologies: [] }),
      job(),
      NOW,
    );
    expect(component(result, "roleSimilarity").score).toBeNull();
  });

  it("falls back to project technologies when skills are empty", () => {
    const result = scoreFit(
      profile({ desiredRoles: [], skills: [], projectTechnologies: ["React"] }),
      job({ title: "React Developer Intern" }),
      NOW,
    );
    expect(component(result, "roleSimilarity").score).toBeGreaterThan(0);
  });
});

/**
 * The coverage floor.
 *
 * Renormalizing over the surviving weight is right for one or two blanks and
 * wrong when most of the weight is gone: 5% of the weight renormalized into
 * "97%" sits in the same sorted column as a 97% built from everything, and the
 * reader cannot tell them apart.
 */
describe("the coverage floor", () => {
  /** A profile and job that together leave exactly MIN_COVERAGE scorable. */
  function atTheFloor() {
    return scoreFit(
      // Skills blank drops 0.25; the posting states a degree but no experience
      // minimum, which drops another 0.15. Left: role 0.25, project 0.1,
      // education 0.1, location 0.1, freshness 0.05 = exactly 0.6.
      profile({ skills: [] }),
      job({
        requirements: { ...NO_REQUIREMENTS, educationLevel: "bachelors" } as JobRequirements,
      }),
      NOW,
    );
  }

  /** The next rung down on the weight grid: 0.55. */
  function belowTheFloor() {
    return scoreFit(
      // Role 0.25 and skills 0.25 survive; project, education, experience and
      // location are all unknown. 0.55, just under the line.
      profile({ projectTechnologies: [], preferredLocations: [], degree: null }),
      job(),
      NOW,
    );
  }

  it("publishes a score at exactly the floor", () => {
    const result = atTheFloor();
    expect(result.coverage).toBeCloseTo(MIN_COVERAGE, 5);
    expect(result.score).not.toBeNull();
  });

  it("refuses to publish one just below the floor", () => {
    const result = belowTheFloor();
    expect(result.coverage).toBeCloseTo(0.55, 5);
    expect(result.coverage).toBeLessThan(MIN_COVERAGE);
    expect(result.score).toBeNull();
  });

  it("still returns every component and explanation when it refuses", () => {
    const result = belowTheFloor();
    expect(result.components).toHaveLength(Object.keys(WEIGHTS).length);
    for (const item of result.components) {
      expect(item.detail.length, item.name).toBeGreaterThan(0);
    }
    // The blanks are the actionable part: these are the fields to go and fill.
    expect(result.components.filter((item) => item.score === null).length).toBeGreaterThan(0);
  });

  it("does not floor the denominator instead", () => {
    // Flooring the denominator (weighted / max(usedWeight, MIN_COVERAGE))
    // would have produced a number here, and that number would have been the
    // missing weight counted as zero. The contract is a refusal, not a
    // deflated score.
    const result = belowTheFloor();
    expect(result.score).not.toBe(0);
    expect(result.score).toBeNull();
  });

  /**
   * Property: a published score always rests on at least MIN_COVERAGE.
   *
   * Swept rather than randomized — every combination of blank and filled
   * profile fields against two kinds of posting, which is the whole input
   * space that matters here and runs in milliseconds.
   */
  it("never publishes a score below MIN_COVERAGE, over every profile shape", () => {
    const requirementVariants: JobRequirements[] = [
      { ...NO_REQUIREMENTS } as JobRequirements,
      {
        ...NO_REQUIREMENTS,
        minimumExperienceYears: 1,
        educationLevel: "bachelors",
      } as JobRequirements,
    ];
    const titles = ["Software Engineering Intern", "Warehouse Operations Associate"];

    let published = 0;
    let refused = 0;

    // Five independent blank/filled switches = 32 profile shapes.
    for (let bits = 0; bits < 32; bits += 1) {
      const candidate = profile({
        desiredRoles: bits & 1 ? ["Software Engineering Intern"] : [],
        skills: bits & 2 ? ["Python", "TypeScript"] : [],
        preferredLocations: bits & 4 ? ["New York"] : [],
        projectTechnologies: bits & 8 ? ["TypeScript"] : [],
        degree: bits & 16 ? "BS Computer Science" : null,
      });

      for (const requirements of requirementVariants) {
        for (const title of titles) {
          const result = scoreFit(candidate, job({ title, requirements }), NOW);
          const label = `bits=${bits} title=${title} reqs=${requirements.educationLevel}`;

          expect(result.components, label).toHaveLength(Object.keys(WEIGHTS).length);
          if (result.score === null) {
            refused += 1;
            expect(result.coverage, label).toBeLessThan(MIN_COVERAGE);
          } else {
            published += 1;
            expect(result.coverage, label).toBeGreaterThanOrEqual(MIN_COVERAGE);
            expect(result.score, label).toBeGreaterThanOrEqual(0);
            expect(result.score, label).toBeLessThanOrEqual(100);
          }
        }
      }
    }

    // Guard against the sweep silently testing nothing: both outcomes must
    // actually occur in it.
    expect(published).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
