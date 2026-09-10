-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('NONE', 'LOCAL', 'ANTHROPIC');

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "provider" "AiProviderKind" NOT NULL DEFAULT 'NONE',
    "baseUrl" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);
