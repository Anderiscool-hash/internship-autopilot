-- CreateEnum
CREATE TYPE "AtsType" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY', 'WORKDAY', 'SMARTRECRUITERS', 'ICIMS', 'JOBVITE', 'ORACLE', 'SAP_SUCCESSFACTORS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RemotePreference" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID', 'ANY');

-- CreateEnum
CREATE TYPE "RemoteType" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('INTERNSHIP', 'CO_OP', 'FULL_TIME', 'PART_TIME', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('OPEN', 'CLOSED', 'FILLED', 'REMOVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TruthFactCategory" AS ENUM ('EXPERIENCE', 'PROJECT', 'EDUCATION', 'SKILL', 'CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "AutoApplyMode" AS ENUM ('AUTO', 'REVIEW', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DISCOVERED', 'NORMALIZED', 'ELIGIBLE', 'MATCHED', 'MATERIALS_READY', 'PREFLIGHTED', 'QUEUED', 'APPLYING', 'SUBMITTED_PENDING_CONFIRMATION', 'CONFIRMED', 'WAITING_FOR_USER', 'CAPTCHA', 'LOGIN_REQUIRED', 'AMBIGUOUS_QUESTION', 'JOB_CLOSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApplicationOutcome" AS ENUM ('OA', 'INTERVIEW', 'FINAL_ROUND', 'OFFER', 'REJECTED', 'WITHDRAWN', 'GHOSTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EventEntityType" AS ENUM ('JOB', 'APPLICATION');

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "school" TEXT,
    "degree" TEXT,
    "graduationDate" TIMESTAMP(3),
    "workAuthorization" TEXT,
    "needsSponsorship" BOOLEAN NOT NULL DEFAULT false,
    "citizenship" TEXT,
    "preferredLocations" TEXT[],
    "remotePreference" "RemotePreference" NOT NULL DEFAULT 'ANY',
    "minimumSalary" INTEGER,
    "desiredRoles" TEXT[],
    "skills" TEXT[],
    "certifications" TEXT[],
    "linkedinUrl" TEXT,
    "githubUrl" TEXT,
    "portfolioUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkExperience" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "bullets" TEXT[],
    "technologies" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "technologies" TEXT[],
    "url" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "fieldOfStudy" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "graduationDate" TIMESTAMP(3),
    "gpa" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruthFact" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "category" "TruthFactCategory" NOT NULL,
    "statement" TEXT NOT NULL,
    "company" TEXT,
    "role" TEXT,
    "technology" TEXT,
    "metric" TEXT,
    "sourceDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TruthFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePreferences" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "minimumFitScore" INTEGER NOT NULL DEFAULT 0,
    "minimumApplicationConfidence" INTEGER NOT NULL DEFAULT 0,
    "maximumPostingAgeHours" INTEGER NOT NULL DEFAULT 72,
    "dailyApplicationLimit" INTEGER NOT NULL DEFAULT 25,
    "maxApplicationsPerCompany" INTEGER NOT NULL DEFAULT 3,
    "atsAutoApplyModes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidatePreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerBankEntry" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "confidence" INTEGER,
    "isLegal" BOOLEAN NOT NULL DEFAULT false,
    "isStandard" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnswerBankEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "careersUrl" TEXT,
    "atsType" "AtsType",
    "atsIdentifier" TEXT,
    "country" TEXT,
    "companySize" TEXT,
    "lastScan" TIMESTAMP(3),
    "lastChange" TIMESTAMP(3),
    "scanPriority" INTEGER NOT NULL DEFAULT 50,
    "pollInterval" INTEGER NOT NULL DEFAULT 30,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "atsType" "AtsType" NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "remoteType" "RemoteType" NOT NULL DEFAULT 'UNKNOWN',
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'OTHER',
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT,
    "description" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourcePostedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DISCOVERED',
    "outcome" "ApplicationOutcome",
    "fitScore" INTEGER,
    "applicationConfidence" INTEGER,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "resumeUsed" TEXT,
    "coverLetterUsed" TEXT,
    "submittedAnswers" JSONB,
    "recruiterContact" TEXT,
    "interviewDates" TIMESTAMP(3)[],
    "notes" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "entityType" "EventEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_email_key" ON "Candidate"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CandidatePreferences_candidateId_key" ON "CandidatePreferences"("candidateId");

-- CreateIndex
CREATE INDEX "Company_active_lastScan_idx" ON "Company"("active", "lastScan");

-- CreateIndex
CREATE UNIQUE INDEX "Job_fingerprint_key" ON "Job"("fingerprint");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_sourceJobId_key" ON "Job"("companyId", "sourceJobId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateId_jobId_key" ON "Application"("candidateId", "jobId");

-- CreateIndex
CREATE INDEX "EventLog_entityType_entityId_idx" ON "EventLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "WorkExperience" ADD CONSTRAINT "WorkExperience_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Education" ADD CONSTRAINT "Education_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruthFact" ADD CONSTRAINT "TruthFact_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePreferences" ADD CONSTRAINT "CandidatePreferences_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerBankEntry" ADD CONSTRAINT "AnswerBankEntry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
