-- ADR-0002: доверие панели по отпечатку сертификата вместо отключения проверки TLS.
--
-- Существующие строки не ломаются и ручных действий при обновлении не требуют:
-- сервер, который работал без проверки, переходит в PINNED с пустым отпечатком,
-- то есть отпечаток будет закреплён при первом же соединении (trust on first use).
-- Сервер, у которого проверка была включена, переходит в VERIFY.

-- CreateEnum
CREATE TYPE "TlsMode" AS ENUM ('PINNED', 'VERIFY');

-- AlterTable Server
ALTER TABLE "Server" ADD COLUMN "tlsMode" "TlsMode" NOT NULL DEFAULT 'PINNED',
ADD COLUMN "tlsPinSha256" TEXT;

UPDATE "Server"
SET "tlsMode" = CASE WHEN "insecureTLS" THEN 'PINNED'::"TlsMode" ELSE 'VERIFY'::"TlsMode" END;

ALTER TABLE "Server" DROP COLUMN "insecureTLS";

-- AlterTable UpdateSettings
ALTER TABLE "UpdateSettings" ADD COLUMN "selfTlsMode" "TlsMode" NOT NULL DEFAULT 'PINNED',
ADD COLUMN "selfTlsPinSha256" TEXT;

UPDATE "UpdateSettings"
SET "selfTlsMode" = CASE WHEN "selfInsecureTLS" THEN 'PINNED'::"TlsMode" ELSE 'VERIFY'::"TlsMode" END;

ALTER TABLE "UpdateSettings" DROP COLUMN "selfInsecureTLS";
