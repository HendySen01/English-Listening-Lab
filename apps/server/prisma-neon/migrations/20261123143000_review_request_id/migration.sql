-- Additive nullable request id. Existing ReviewEvent rows stay unchanged.
-- SQLite and PostgreSQL both allow multiple NULL values in this unique index.

ALTER TABLE "ReviewEvent" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "ReviewEvent_clientRequestId_key" ON "ReviewEvent"("clientRequestId");
