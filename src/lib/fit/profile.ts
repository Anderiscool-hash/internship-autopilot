/**
 * Turning the stored candidate profile into what the fit engine compares
 * against.
 *
 * The one non-obvious part is project technologies. They do not live on the
 * Candidate row — they come out of the Truth Ledger (spec §3), which is the
 * only place this app is allowed to learn what the candidate has actually
 * built. Reading them from anywhere else would mean scoring "project
 * relevance" against claims nobody vouched for.
 */

import { TruthFactCategory } from "@prisma/client";
import type { ProfileWithFacts } from "../candidate/store";
import type { EligibilityProfile } from "../eligibility/engine";
import type { FitProfile } from "./score";

/** The eligibility-critical subset of a stored profile (spec §11). */
export function toEligibilityProfile(profile: ProfileWithFacts): EligibilityProfile {
  return {
    degree: profile.degree,
    graduationDate: profile.graduationDate,
    needsSponsorship: profile.needsSponsorship,
    citizenship: profile.citizenship,
    workAuthorization: profile.workAuthorization,
    certifications: profile.certifications,
  };
}

/** The fit-scoring subset of a stored profile (spec §12). */
export function toFitProfile(profile: ProfileWithFacts): FitProfile {
  // Technologies named on PROJECT facts, deduplicated. A skill listed on the
  // profile and a technology used in a project are scored separately on
  // purpose: spec §12 weights "skill alignment" and "project relevance" as
  // different things.
  const projectTechnologies = [
    ...new Set(
      profile.truthFacts
        .filter(
          (fact) =>
            fact.category === TruthFactCategory.PROJECT && fact.technology !== null,
        )
        .map((fact) => (fact.technology as string).trim())
        .filter((technology) => technology.length > 0),
    ),
  ];

  return {
    desiredRoles: profile.desiredRoles,
    skills: profile.skills,
    preferredLocations: profile.preferredLocations,
    remotePreference: profile.remotePreference,
    degree: profile.degree,
    projectTechnologies,
  };
}
