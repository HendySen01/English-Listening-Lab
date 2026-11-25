BEGIN;
ALTER TABLE "UserSettings" ADD COLUMN "learningDirection" TEXT;
ALTER TABLE "UserSettings" ADD COLUMN "customLearningGoal" TEXT;
COMMIT;
