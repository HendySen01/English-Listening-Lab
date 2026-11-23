-- PostgreSQL draft only. Do not run this on Neon development or production.
-- Prisma 6.19.3 does not promise to wrap a migration file, so the boundary is explicit.
-- This is not the SQLite rebuild script. Existing cache keys are not rewritten.
-- Historical rows are assigned to Learner learner_original_lab, whose authUserId
-- stays unbound until a later authorized bind. No production account is used.

BEGIN;

CREATE TABLE "Learner" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Learner_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Learner_authUserId_key" ON "Learner"("authUserId");

INSERT INTO "Learner" ("id", "authUserId", "boundAt", "createdAt")
VALUES ('learner_original_lab', 'unbound:original-lab', NULL, CURRENT_TIMESTAMP);

ALTER TABLE "UserSettings" ADD COLUMN "userId" TEXT;
UPDATE "UserSettings" SET "userId" = 'learner_original_lab';
ALTER TABLE "UserSettings" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "UserSettings" ALTER COLUMN "id" DROP DEFAULT;
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyLesson" ADD COLUMN "userId" TEXT;
UPDATE "DailyLesson" SET "userId" = 'learner_original_lab';
ALTER TABLE "DailyLesson" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX "DailyLesson_lessonDate_version_key";
CREATE UNIQUE INDEX "DailyLesson_userId_lessonDate_version_key" ON "DailyLesson"("userId", "lessonDate", "version");
CREATE UNIQUE INDEX "DailyLesson_id_userId_key" ON "DailyLesson"("id", "userId");
CREATE INDEX "DailyLesson_userId_lessonDate_active_idx" ON "DailyLesson"("userId", "lessonDate", "active");
ALTER TABLE "DailyLesson" ADD CONSTRAINT "DailyLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vocabulary" ADD COLUMN "userId" TEXT;
UPDATE "Vocabulary" SET "userId" = 'learner_original_lab';
ALTER TABLE "Vocabulary" ALTER COLUMN "userId" SET NOT NULL;
CREATE UNIQUE INDEX "Vocabulary_id_userId_key" ON "Vocabulary"("id", "userId");
CREATE INDEX "Vocabulary_userId_lemma_idx" ON "Vocabulary"("userId", "lemma");
ALTER TABLE "Vocabulary" ADD CONSTRAINT "Vocabulary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vocabulary" ADD CONSTRAINT "Vocabulary_lesson_user_fkey" FOREIGN KEY ("lessonId", "userId") REFERENCES "DailyLesson"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WordProgress" ADD COLUMN "userId" TEXT;
UPDATE "WordProgress" SET "userId" = 'learner_original_lab';
ALTER TABLE "WordProgress" ALTER COLUMN "userId" SET NOT NULL;
CREATE UNIQUE INDEX "WordProgress_vocabularyId_userId_key" ON "WordProgress"("vocabularyId", "userId");
CREATE INDEX "WordProgress_userId_due_idx" ON "WordProgress"("userId", "due");
ALTER TABLE "WordProgress" ADD CONSTRAINT "WordProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WordProgress" ADD CONSTRAINT "WordProgress_vocabulary_user_fkey" FOREIGN KEY ("vocabularyId", "userId") REFERENCES "Vocabulary"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuizQuestion" ADD COLUMN "userId" TEXT;
UPDATE "QuizQuestion" SET "userId" = 'learner_original_lab';
ALTER TABLE "QuizQuestion" ALTER COLUMN "userId" SET NOT NULL;
CREATE UNIQUE INDEX "QuizQuestion_id_userId_key" ON "QuizQuestion"("id", "userId");
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_lesson_user_fkey" FOREIGN KEY ("lessonId", "userId") REFERENCES "DailyLesson"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuizAttempt" ADD COLUMN "userId" TEXT;
UPDATE "QuizAttempt" SET "userId" = 'learner_original_lab';
ALTER TABLE "QuizAttempt" ALTER COLUMN "userId" SET NOT NULL;
CREATE INDEX "QuizAttempt_userId_createdAt_idx" ON "QuizAttempt"("userId", "createdAt");
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_question_user_fkey" FOREIGN KEY ("questionId", "userId") REFERENCES "QuizQuestion"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySession" ADD COLUMN "userId" TEXT;
UPDATE "StudySession" SET "userId" = 'learner_original_lab';
ALTER TABLE "StudySession" ALTER COLUMN "userId" SET NOT NULL;
CREATE INDEX "StudySession_userId_createdAt_idx" ON "StudySession"("userId", "createdAt");
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION study_session_same_user() RETURNS trigger AS $$
BEGIN
  IF NEW."lessonId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "DailyLesson" WHERE "id" = NEW."lessonId" AND "userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'cross-user-link';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER study_session_same_user_insert BEFORE INSERT ON "StudySession" FOR EACH ROW EXECUTE FUNCTION study_session_same_user();
CREATE TRIGGER study_session_same_user_update BEFORE UPDATE ON "StudySession" FOR EACH ROW EXECUTE FUNCTION study_session_same_user();

ALTER TABLE "ReviewEvent" ADD COLUMN "userId" TEXT;
UPDATE "ReviewEvent" AS event
SET "userId" = word."userId"
FROM "Vocabulary" AS word
WHERE word."id" = event."vocabularyId";
ALTER TABLE "ReviewEvent" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX "ReviewEvent_clientRequestId_key";
CREATE UNIQUE INDEX "ReviewEvent_userId_clientRequestId_key" ON "ReviewEvent"("userId", "clientRequestId");
CREATE INDEX "ReviewEvent_userId_vocabularyId_createdAt_idx" ON "ReviewEvent"("userId", "vocabularyId", "createdAt");
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AIUsageRecord" ADD COLUMN "userId" TEXT;
UPDATE "AIUsageRecord" SET "userId" = 'learner_original_lab';
ALTER TABLE "AIUsageRecord" ALTER COLUMN "userId" SET NOT NULL;
CREATE INDEX "AIUsageRecord_userId_createdAt_idx" ON "AIUsageRecord"("userId", "createdAt");
CREATE INDEX "AIUsageRecord_createdAt_idx" ON "AIUsageRecord"("createdAt");
ALTER TABLE "AIUsageRecord" ADD CONSTRAINT "AIUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExplanationCache" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE "ExplanationCache" ADD COLUMN "ownerAuthUserId" TEXT;
ALTER TABLE "ExplanationCache" ADD CONSTRAINT "ExplanationCache_scope_owner_check" CHECK (
  ("scope" = 'shared' AND "ownerAuthUserId" IS NULL)
  OR ("scope" = 'private' AND "ownerAuthUserId" IS NOT NULL)
);

COMMIT;
