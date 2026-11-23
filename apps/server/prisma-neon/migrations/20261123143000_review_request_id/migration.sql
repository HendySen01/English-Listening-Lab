-- Prisma 6.19.3 does not promise to wrap a PostgreSQL migration file in one transaction.
-- These boundaries keep the new column and unique index atomic.
-- Existing ReviewEvent rows are not updated. Multiple NULL request ids remain valid.

BEGIN;

ALTER TABLE "ReviewEvent" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "ReviewEvent_clientRequestId_key" ON "ReviewEvent"("clientRequestId");

COMMIT;
