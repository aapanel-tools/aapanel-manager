-- CreateTable
CREATE TABLE "UpdateSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "deploymentMode" TEXT NOT NULL DEFAULT 'manual',
    "githubOwner" TEXT NOT NULL DEFAULT '',
    "githubRepo" TEXT NOT NULL DEFAULT '',
    "githubTokenEnc" TEXT,
    "aapanelServerId" TEXT,
    "aapanelProject" TEXT,
    "startScript" TEXT,
    "serviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionHistory" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "VersionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VersionHistory_installedAt_idx" ON "VersionHistory"("installedAt");
