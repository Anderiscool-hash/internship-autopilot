-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SubmissionAttempt" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "atsType" "AtsType" NOT NULL,
    "adapterId" TEXT NOT NULL,
    "authorizationKind" TEXT NOT NULL,
    "authorizationActor" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL,
    "trustLevel" INTEGER NOT NULL,
    "confidence" INTEGER,
    "gates" JSONB NOT NULL,
    "refusedGate" TEXT,
    "requests" TEXT[],
    "outcome" TEXT NOT NULL,
    "adapterError" TEXT,
    "screenshotPath" TEXT,
    "verdict" TEXT,
    "verdictNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionAttempt_applicationId_idx" ON "SubmissionAttempt"("applicationId");

-- CreateIndex
CREATE INDEX "SubmissionAttempt_atsType_outcome_idx" ON "SubmissionAttempt"("atsType", "outcome");

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
