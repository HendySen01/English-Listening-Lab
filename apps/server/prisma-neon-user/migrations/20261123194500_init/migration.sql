-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Learner" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Learner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyNewWords" INTEGER NOT NULL,
    "difficulty" TEXT NOT NULL,
    "listeningLevel" TEXT NOT NULL,
    "dailyMinutes" INTEGER NOT NULL,
    "theme" TEXT NOT NULL,
    "customTheme" TEXT NOT NULL,
    "autoGenerate" BOOLEAN NOT NULL,
    "ttsVoice" TEXT NOT NULL,
    "speechRate" DOUBLE PRECISION NOT NULL,
    "locale" TEXT NOT NULL,
    "colorMode" TEXT NOT NULL,
    "wordPartsEnabled" BOOLEAN NOT NULL,
    "recommendationsEnabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLesson" (
    "id" TEXT NOT NULL,
    "lessonDate" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "theme" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "newWordCount" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "poolNote" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "listeningTitle" TEXT NOT NULL,
    "listeningText" TEXT NOT NULL,
    "listeningChunks" TEXT NOT NULL,
    "listeningGloss" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DailyLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vocabulary" (
    "id" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "pos" TEXT NOT NULL,
    "ipa" TEXT,
    "ipaNote" TEXT NOT NULL,
    "stress" TEXT,
    "meaningZh" TEXT NOT NULL,
    "definitionEn" TEXT NOT NULL,
    "collocation" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "exampleZh" TEXT NOT NULL,
    "morphology" TEXT,
    "difficulty" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "knownAlready" BOOLEAN NOT NULL,
    "exampleFlagged" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lessonId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Vocabulary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordProgress" (
    "id" TEXT NOT NULL,
    "vocabularyId" TEXT NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "elapsedDays" INTEGER NOT NULL,
    "scheduledDays" INTEGER NOT NULL,
    "learningSteps" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "lapses" INTEGER NOT NULL,
    "state" INTEGER NOT NULL,
    "lastReview" TIMESTAMP(3),
    "firstLearnedAt" TIMESTAMP(3) NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "incorrectCount" INTEGER NOT NULL,
    "familiarity" TEXT NOT NULL,
    "recallAbility" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "WordProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "answerIndex" INTEGER NOT NULL,
    "explanationEn" TEXT NOT NULL,
    "explanationZh" TEXT NOT NULL,
    "simplerZh" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "whyWrong" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selected" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT,
    "module" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "vocabularyId" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "mode" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "dueBefore" TIMESTAMP(3) NOT NULL,
    "dueAfter" TIMESTAMP(3) NOT NULL,
    "changedSchedule" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsageRecord" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AIUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCharge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "studyDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reservedCount" INTEGER NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "reservedCostMicros" INTEGER,
    "actualCostMicros" INTEGER,
    "priceVersion" TEXT,
    "resultJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AiCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Learner_authUserId_key" ON "Learner"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "DailyLesson_userId_lessonDate_active_idx" ON "DailyLesson"("userId", "lessonDate", "active");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLesson_id_userId_key" ON "DailyLesson"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLesson_userId_lessonDate_version_key" ON "DailyLesson"("userId", "lessonDate", "version");

-- CreateIndex
CREATE INDEX "Vocabulary_userId_lemma_idx" ON "Vocabulary"("userId", "lemma");

-- CreateIndex
CREATE UNIQUE INDEX "Vocabulary_id_userId_key" ON "Vocabulary"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WordProgress_vocabularyId_key" ON "WordProgress"("vocabularyId");

-- CreateIndex
CREATE INDEX "WordProgress_userId_due_idx" ON "WordProgress"("userId", "due");

-- CreateIndex
CREATE UNIQUE INDEX "WordProgress_vocabularyId_userId_key" ON "WordProgress"("vocabularyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_id_userId_key" ON "QuizQuestion"("id", "userId");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_createdAt_idx" ON "QuizAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StudySession_userId_createdAt_idx" ON "StudySession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_vocabularyId_createdAt_idx" ON "ReviewEvent"("userId", "vocabularyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_userId_clientRequestId_key" ON "ReviewEvent"("userId", "clientRequestId");

-- CreateIndex
CREATE INDEX "AIUsageRecord_userId_createdAt_idx" ON "AIUsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIUsageRecord_createdAt_idx" ON "AIUsageRecord"("createdAt");

-- CreateIndex
CREATE INDEX "AiCharge_studyDate_status_idx" ON "AiCharge"("studyDate", "status");

-- CreateIndex
CREATE INDEX "AiCharge_userId_studyDate_status_idx" ON "AiCharge"("userId", "studyDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiCharge_userId_requestId_key" ON "AiCharge"("userId", "requestId");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLesson" ADD CONSTRAINT "DailyLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vocabulary" ADD CONSTRAINT "Vocabulary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vocabulary" ADD CONSTRAINT "Vocabulary_lessonId_userId_fkey" FOREIGN KEY ("lessonId", "userId") REFERENCES "DailyLesson"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordProgress" ADD CONSTRAINT "WordProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordProgress" ADD CONSTRAINT "WordProgress_vocabularyId_userId_fkey" FOREIGN KEY ("vocabularyId", "userId") REFERENCES "Vocabulary"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_lessonId_userId_fkey" FOREIGN KEY ("lessonId", "userId") REFERENCES "DailyLesson"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_questionId_userId_fkey" FOREIGN KEY ("questionId", "userId") REFERENCES "QuizQuestion"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "DailyLesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageRecord" ADD CONSTRAINT "AIUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCharge" ADD CONSTRAINT "AiCharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

