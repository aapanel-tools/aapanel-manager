-- AlterTable
ALTER TABLE "UpdateSettings" ADD COLUMN     "selfApiKeyEnc" TEXT,
ADD COLUMN     "selfBaseUrl" TEXT,
ADD COLUMN     "selfInsecureTLS" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "selfProject" TEXT;
