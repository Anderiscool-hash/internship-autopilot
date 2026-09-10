-- CreateTable
CREATE TABLE "ResumeImport" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeImport_pkey" PRIMARY KEY ("id")
);
