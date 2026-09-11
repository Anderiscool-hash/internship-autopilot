-- CreateTable
CREATE TABLE "ShadowRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "atsType" "AtsType" NOT NULL,
    "fieldsTotal" INTEGER NOT NULL,
    "fieldsFilled" INTEGER NOT NULL,
    "fieldsSkipped" INTEGER NOT NULL,
    "fieldsFailed" INTEGER NOT NULL,
    "blockingGaps" TEXT[],
    "captcha" BOOLEAN NOT NULL DEFAULT false,
    "loginRequired" BOOLEAN NOT NULL DEFAULT false,
    "screenshotPath" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL,
    "verdict" TEXT,
    "verdictNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShadowRun_atsType_verdict_idx" ON "ShadowRun"("atsType", "verdict");

-- AddForeignKey
ALTER TABLE "ShadowRun" ADD CONSTRAINT "ShadowRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowRun" ADD CONSTRAINT "ShadowRun_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
