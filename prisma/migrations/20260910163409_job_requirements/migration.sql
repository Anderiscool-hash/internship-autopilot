-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "requirements" JSONB,
ADD COLUMN     "requirementsExtractedAt" TIMESTAMP(3);
