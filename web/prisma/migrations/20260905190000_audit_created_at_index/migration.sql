-- Ф-2: журнал операций читается страницами, отсортированными по дате.
-- Без индекса выборка деградирует по мере роста таблицы, а она только растёт.

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
