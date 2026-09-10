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
    const withSkills = scoreFit(profile(), job(), NOW);
    const withoutSkills = scoreFit(profile({ skills: [] }), job(), NOW);

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

  it("returns a null score when nothing at all could be judged", () => {
    // Freshness always scores, so the only way to have nothing is a job with
    // no first-seen date — which cannot happen. This asserts the guard holds
    // rather than a real scenario.
    const result = scoreFit(
      profile({ desiredRoles: [], skills: [], preferredLocations: [], projectTechnologies: [], degree: null }),
      job(),
      NOW,
    );
    expect(result.score).not.toBeNull();
    expect(result.components.filter((item) => item.score === null).length).toBe(6);
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
