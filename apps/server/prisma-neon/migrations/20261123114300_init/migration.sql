-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "dailyNewWords" INTEGER NOT NULL DEFAULT 6,
    "difficulty" TEXT NOT NULL DEFAULT 'A2+',
    "listeningLevel" TEXT NOT NULL DEFAULT 'match',
    "dailyMinutes" INTEGER NOT NULL DEFAULT 60,
    "theme" TEXT NOT NULL DEFAULT 'Daily Life',
    "customTheme" TEXT NOT NULL DEFAULT '',
    "autoGenerate" BOOLEAN NOT NULL DEFAULT true,
    "ttsVoice" TEXT NOT NULL DEFAULT 'en-US',
    "speechRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "colorMode" TEXT NOT NULL DEFAULT 'system',
    "wordPartsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recommendationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLesson" (
    "id" TEXT NOT NULL,
    "lessonDate" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "theme" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "newWordCount" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "poolNote" TEXT NOT NULL DEFAULT '',
    "progress" TEXT NOT NULL,
    "listeningTitle" TEXT NOT NULL,
    "listeningText" TEXT NOT NULL,
    "listeningChunks" TEXT NOT NULL,
    "listeningGloss" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vocabulary" (
    "id" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "pos" TEXT NOT NULL,
    "ipa" TEXT,
    "ipaNote" TEXT NOT NULL DEFAULT '',
    "stress" TEXT,
    "meaningZh" TEXT NOT NULL,
    "definitionEn" TEXT NOT NULL,
    "collocation" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "exampleZh" TEXT NOT NULL,
    "morphology" TEXT,
    "difficulty" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "knownAlready" BOOLEAN NOT NULL DEFAULT false,
    "exampleFlagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lessonId" TEXT,

    CONSTRAINT "Vocabulary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordProgress" (
    "id" TEXT NOT NULL,
    "vocabularyId" TEXT NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elapsedDays" INTEGER NOT NULL DEFAULT 0,
    "scheduledDays" INTEGER NOT NULL DEFAULT 0,
    "learningSteps" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "state" INTEGER NOT NULL DEFAULT 0,
    "lastReview" TIMESTAMP(3),
    "firstLearnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "familiarity" TEXT NOT NULL DEFAULT 'new',
    "recallAbility" TEXT NOT NULL DEFAULT 'unset',

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

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selected" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT,
    "module" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "vocabularyId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "dueBefore" TIMESTAMP(3) NOT NULL,
    "dueAfter" TIMESTAMP(3) NOT NULL,
    "changedSchedule" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExplanationCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExplanationCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyLesson_lessonDate_version_key" ON "DailyLesson"("lessonDate", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WordProgress_vocabularyId_key" ON "WordProgress"("vocabularyId");

-- CreateIndex
CREATE UNIQUE INDEX "ExplanationCache_cacheKey_key" ON "ExplanationCache"("cacheKey");

-- AddForeignKey
ALTER TABLE "Vocabulary" ADD CONSTRAINT "Vocabulary_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "DailyLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordProgress" ADD CONSTRAINT "WordProgress_vocabularyId_fkey" FOREIGN KEY ("vocabularyId") REFERENCES "Vocabulary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "DailyLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "DailyLesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

