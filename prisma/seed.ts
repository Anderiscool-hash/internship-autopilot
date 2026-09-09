// ============================================================================
// Seed script — populates a fresh local database with a small, honest
// starting point. Run with `npm run db:seed` (see package.json).
//
// What's in here on purpose, and nothing more:
//   1. ~10 real, well-known companies with their actual ATS board
//      identifiers, VERIFIED by calling each platform's public jobs API
//      directly (see the comment above each one) before writing this file.
//      One company is included with a null identifier + active=false to
//      show the "we know their ATS but haven't confirmed the exact board
//      token yet" state honestly, rather than guessing.
//   2. Exactly one candidate row, and it is unmistakably a placeholder —
//      not a real profile. Replace it (or add your real one) once the app
//      has a profile-editing UI.
//
// This script is safe to run more than once: companies are looked up by
// domain first and updated in place instead of being duplicated, and the
// placeholder candidate is looked up by its fixed placeholder email.
// ============================================================================

import { PrismaClient, AtsType } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedCompany {
  name: string;
  domain: string;
  careersUrl: string | null;
  atsType: AtsType | null;
  atsIdentifier: string | null;
  active: boolean;
  /** Left in as a comment source, not stored in the DB. */
  note?: string;
}

// ----------------------------------------------------------------------------
// Companies. Every GREENHOUSE/LEVER/ASHBY identifier below was confirmed
// live against the platform's public API immediately before writing this
// file (e.g. `curl https://boards-api.greenhouse.io/v1/boards/stripe/jobs`
// returning real job data, not a 404). None of these were guessed.
// ----------------------------------------------------------------------------
const companies: SeedCompany[] = [
  {
    name: "Stripe",
    domain: "stripe.com",
    careersUrl: "https://boards.greenhouse.io/stripe",
    atsType: AtsType.GREENHOUSE,
    atsIdentifier: "stripe",
    active: true,
  },
  {
    name: "Airbnb",
    domain: "airbnb.com",
    careersUrl: "https://boards.greenhouse.io/airbnb",
    atsType: AtsType.GREENHOUSE,
    atsIdentifier: "airbnb",
    active: true,
  },
  {
    name: "Coinbase",
    domain: "coinbase.com",
    careersUrl: "https://boards.greenhouse.io/coinbase",
    atsType: AtsType.GREENHOUSE,
    atsIdentifier: "coinbase",
    active: true,
  },
  {
    name: "Figma",
    domain: "figma.com",
    careersUrl: "https://boards.greenhouse.io/figma",
    atsType: AtsType.GREENHOUSE,
    atsIdentifier: "figma",
    active: true,
  },
  {
    name: "Cloudflare",
    domain: "cloudflare.com",
    careersUrl: "https://boards.greenhouse.io/cloudflare",
    atsType: AtsType.GREENHOUSE,
    atsIdentifier: "cloudflare",
    active: true,
  },
  {
    name: "Palantir Technologies",
    domain: "palantir.com",
    careersUrl: "https://jobs.lever.co/palantir",
    atsType: AtsType.LEVER,
    atsIdentifier: "palantir",
    active: true,
  },
  {
    name: "OpenAI",
    domain: "openai.com",
    careersUrl: "https://jobs.ashbyhq.com/openai",
    atsType: AtsType.ASHBY,
    atsIdentifier: "openai",
    active: true,
  },
  {
    name: "Ramp",
    domain: "ramp.com",
    careersUrl: "https://jobs.ashbyhq.com/ramp",
    atsType: AtsType.ASHBY,
    atsIdentifier: "ramp",
    active: true,
  },
  {
    name: "Vercel",
    domain: "vercel.com",
    careersUrl: "https://jobs.ashbyhq.com/vercel",
    atsType: AtsType.ASHBY,
    atsIdentifier: "vercel",
    active: true,
  },
  {
    // NEEDS VERIFICATION: Microsoft is known to run on Workday, but the
    // exact Workday tenant slug/site id was not confirmed against a live
    // API before writing this file (Workday doesn't expose a simple public
    // jobs endpoint the way Greenhouse/Lever/Ashby do). Rather than guess a
    // tenant string and have it silently fail later, this is left null and
    // the company is marked inactive so the scanner skips it until a human
    // fills in the real identifier.
    name: "Microsoft",
    domain: "microsoft.com",
    careersUrl: "https://careers.microsoft.com",
    atsType: AtsType.WORKDAY,
    atsIdentifier: null,
    active: false,
    note: "needs verification — Workday tenant identifier not confirmed",
  },
];

async function seedCompanies() {
  for (const company of companies) {
    const existing = await prisma.company.findFirst({
      where: { domain: company.domain },
    });

    if (existing) {
      await prisma.company.update({
        where: { id: existing.id },
        data: {
          name: company.name,
          careersUrl: company.careersUrl,
          atsType: company.atsType,
          atsIdentifier: company.atsIdentifier,
          active: company.active,
        },
      });
    } else {
      await prisma.company.create({
        data: {
          name: company.name,
          domain: company.domain,
          careersUrl: company.careersUrl,
          atsType: company.atsType,
          atsIdentifier: company.atsIdentifier,
          active: company.active,
        },
      });
    }
  }
  console.log(`Seeded ${companies.length} companies.`);
}

// ----------------------------------------------------------------------------
// Placeholder candidate. This is NOT a real person — every field says so.
// Delete this row (or just stop using it) once the app has a real profile
// for you.
// ----------------------------------------------------------------------------
const PLACEHOLDER_EMAIL = "placeholder@example.invalid";

async function seedPlaceholderCandidate() {
  await prisma.candidate.upsert({
    where: { email: PLACEHOLDER_EMAIL },
    update: {},
    create: {
      name: "PLACEHOLDER — replace with your real profile",
      email: PLACEHOLDER_EMAIL,
      phone: null,
      address: null,
      school: "PLACEHOLDER UNIVERSITY",
      degree: "PLACEHOLDER DEGREE",
      graduationDate: null,
      workAuthorization: null,
      needsSponsorship: false,
      citizenship: null,
      preferredLocations: [],
      desiredRoles: [],
      skills: [],
      certifications: [],
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
    },
  });
  console.log("Seeded placeholder candidate (not a real profile).");
}

async function main() {
  await seedCompanies();
  await seedPlaceholderCandidate();
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
