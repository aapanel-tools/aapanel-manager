-- ADR-0005: очередь заданий и массовые операции.
--
-- Задание переживает и вкладку браузера, и перезапуск процесса, поэтому живёт
-- в базе. Имя сервера в элементе хранится копией: отчёт о том, что делали
-- с боевой машиной, обязан пережить удаление этой машины из приложения.

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "JobItemStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "stopOnError" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "serverId" TEXT,
    "serverName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "JobItemStatus" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JobItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");
CREATE INDEX "JobItem_jobId_idx" ON "JobItem"("jobId");
CREATE INDEX "JobItem_serverId_idx" ON "JobItem"("serverId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;
