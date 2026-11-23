import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { isolateNeonEnvFromAppEnv, redact } from "./guard.mjs";

const require = createRequire(import.meta.url);
const serverRoot = path.resolve("D:/Projects/English-Listening-Lab/apps/server");
const repoRoot = path.resolve("D:/Projects/English-Listening-Lab");
const sqlitePath = path.join(repoRoot, "data", "lab.db");
const cachePath = path.join(repoRoot, "data", "preview-explanations.json");
const schemaPath = path.join(serverRoot, "prisma-neon", "schema.prisma");
const migrationDir = path.join(serverRoot, "prisma-neon", "migrations", "20261123114300_init");
const backupDir = "D:/Backups/English-Listening-Lab";
const businessTables = [
  "UserSettings",
  "DailyLesson",
  "Vocabulary",
  "WordProgress",
  "QuizQuestion",
  "QuizAttempt",
  "StudySession",
  "ReviewEvent",
  "AIUsageRecord",
  "ExplanationCache",
];

function fail(stage, error) {
  console.error(JSON.stringify({ ok: false, stage, error: redact(error?.stack || error?.message || error) }, null, 2));
  process.exit(1);
}

function millis(value, label) {
  if (value == null) return null;
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || String(Math.abs(number)).length !== 13) {
    throw new Error(`${label} is not a 13-digit millisecond timestamp`);
  }
  return number;
}

function dateFromMillis(value, label) {
  const number = millis(value, label);
  return number == null ? null : new Date(number);
}

function bool(value, label) {
  if (value === 0 || value === 1 || value === true || value === false) return Boolean(value);
  throw new Error(`${label} is not a boolean`);
}

function mustJson(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is empty`);
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return value;
}

function optionalJson(value, label) {
  if (value == null) return null;
  return mustJson(value, label);
}

function readSqlite() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const all = (sql) => db.prepare(sql).all();
  const data = {
    settings: all("SELECT * FROM UserSettings"),
    lessons: all("SELECT * FROM DailyLesson"),
    words: all("SELECT * FROM Vocabulary"),
    progress: all("SELECT * FROM WordProgress"),
    questions: all("SELECT * FROM QuizQuestion"),
    attempts: all("SELECT * FROM QuizAttempt"),
    sessions: all("SELECT * FROM StudySession"),
    reviews: all("SELECT * FROM ReviewEvent"),
    usage: all("SELECT * FROM AIUsageRecord"),
  };
  db.close();
  for (const lesson of data.lessons) {
    mustJson(lesson.progress, `progress ${lesson.id}`);
    mustJson(lesson.listeningChunks, `chunks ${lesson.id}`);
    mustJson(lesson.listeningGloss, `gloss ${lesson.id}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lesson.lessonDate)) throw new Error(`bad lesson date ${lesson.id}`);
  }
  for (const word of data.words) optionalJson(word.morphology, `morphology ${word.id}`);
  for (const question of data.questions) {
    mustJson(question.options, `options ${question.id}`);
    mustJson(question.whyWrong, `whyWrong ${question.id}`);
    if (typeof question.evidence !== "string") throw new Error(`evidence ${question.id} is not text`);
  }
  const cacheFile = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const cache = Object.entries(cacheFile.entries || {}).map(([cacheKey, entry]) => {
    if (!entry || typeof entry.analysis !== "object" || entry.analysis == null) throw new Error(`cache ${cacheKey} has no analysis`);
    if (typeof entry.sentence !== "string" || !entry.sentence.trim()) throw new Error(`cache ${cacheKey} has no sentence`);
    const created = Date.parse(entry.createdAt);
    if (Number.isNaN(created)) throw new Error(`cache ${cacheKey} has a bad createdAt`);
    return {
      id: cacheKey,
      cacheKey,
      schemaVersion: cacheFile.version,
      passageId: entry.passageId,
      word: entry.word,
      sentence: entry.sentence,
      analysis: JSON.stringify(entry.analysis),
      model: entry.model,
      source: entry.source,
      attempts: entry.attempts,
      createdAtMs: created,
    };
  });
  return { data, cache, cacheVersion: cacheFile.version };
}

function mapRows(source) {
  const { data, cache } = source;
  return {
    settings: data.settings.map((row) => ({
      ...row,
      autoGenerate: bool(row.autoGenerate, "autoGenerate"),
      wordPartsEnabled: bool(row.wordPartsEnabled, "wordPartsEnabled"),
      recommendationsEnabled: bool(row.recommendationsEnabled, "recommendationsEnabled"),
      updatedAt: dateFromMillis(row.updatedAt, "settings.updatedAt"),
    })),
    lessons: data.lessons.map((row) => ({
      ...row,
      active: bool(row.active, "active"),
      createdAt: dateFromMillis(row.createdAt, `lesson.createdAt ${row.id}`),
    })),
    words: data.words.map((row) => ({
      ...row,
      knownAlready: bool(row.knownAlready, "knownAlready"),
      exampleFlagged: bool(row.exampleFlagged, "exampleFlagged"),
      createdAt: dateFromMillis(row.createdAt, `word.createdAt ${row.id}`),
    })),
    progress: data.progress.map((row) => ({
      ...row,
      due: dateFromMillis(row.due, `due ${row.id}`),
      lastReview: dateFromMillis(row.lastReview, `lastReview ${row.id}`),
      firstLearnedAt: dateFromMillis(row.firstLearnedAt, `firstLearnedAt ${row.id}`),
    })),
    questions: data.questions,
    attempts: data.attempts.map((row) => ({
      ...row,
      correct: bool(row.correct, "correct"),
      createdAt: dateFromMillis(row.createdAt, `attempt.createdAt ${row.id}`),
    })),
    sessions: data.sessions.map((row) => ({
      ...row,
      createdAt: dateFromMillis(row.createdAt, `session.createdAt ${row.id}`),
    })),
    reviews: data.reviews.map((row) => ({
      ...row,
      changedSchedule: bool(row.changedSchedule, "changedSchedule"),
      dueBefore: dateFromMillis(row.dueBefore, `dueBefore ${row.id}`),
      dueAfter: dateFromMillis(row.dueAfter, `dueAfter ${row.id}`),
      createdAt: dateFromMillis(row.createdAt, `review.createdAt ${row.id}`),
    })),
    usage: data.usage.map((row) => ({
      ...row,
      success: bool(row.success, "success"),
      createdAt: dateFromMillis(row.createdAt, `usage.createdAt ${row.id}`),
    })),
    cache: cache.map((row) => ({
      id: row.id,
      cacheKey: row.cacheKey,
      schemaVersion: row.schemaVersion,
      passageId: row.passageId,
      word: row.word,
      sentence: row.sentence,
      analysis: row.analysis,
      model: row.model,
      source: row.source,
      attempts: row.attempts,
      createdAt: new Date(row.createdAtMs),
    })),
  };
}

function runPrisma(args, env) {
  const result = spawnSync("npx", ["prisma", ...args], {
    cwd: serverRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(redact(`${result.stdout || ""}\n${result.stderr || ""}`.trim() || `prisma exited ${result.status}`));
  }
  return redact(result.stdout || "");
}

async function main() {
  const stage = { name: "isolate-env" };
  const { neon } = isolateNeonEnvFromAppEnv();
  const directEnv = { DATABASE_URL: neon.DIRECT_URL, DIRECT_URL: neon.DIRECT_URL };
  const splitEnv = { DATABASE_URL: neon.DATABASE_URL, DIRECT_URL: neon.DIRECT_URL };

  stage.name = "backup";
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "lab-before-neon-dev-import.db");
  const sourceDb = new DatabaseSync(sqlitePath, { readOnly: true });
  await backup(sourceDb, backupPath);
  sourceDb.close();
  fs.copyFileSync(cachePath, path.join(backupDir, "preview-explanations-before-neon-dev-import.json"));

  stage.name = "read-sqlite";
  const source = readSqlite();
  const rows = mapRows(source);
  const sourceCounts = {
    UserSettings: rows.settings.length,
    DailyLesson: rows.lessons.length,
    Vocabulary: rows.words.length,
    WordProgress: rows.progress.length,
    QuizQuestion: rows.questions.length,
    QuizAttempt: rows.attempts.length,
    StudySession: rows.sessions.length,
    ReviewEvent: rows.reviews.length,
    AIUsageRecord: rows.usage.length,
    ExplanationCache: rows.cache.length,
  };

  stage.name = "create-migration";
  fs.mkdirSync(migrationDir, { recursive: true });
  fs.writeFileSync(path.join(serverRoot, "prisma-neon", "migrations", "migration_lock.toml"), 'provider = "postgresql"\n');
  const diff = spawnSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPath, "--script"],
    { cwd: serverRoot, env: { ...process.env, ...splitEnv }, encoding: "utf8", shell: true },
  );
  if (diff.status !== 0) throw new Error(redact(diff.stderr || diff.stdout));
  const sql = diff.stdout;
  if (/drop\s+table|drop\s+schema|truncate/i.test(sql)) throw new Error("Generated SQL contains a destructive statement");
  if (/ExplanationCache[\s\S]*jsonb|evidence[\s\S]*jsonb/i.test(sql)) throw new Error("Generated SQL uses jsonb");
  const reviewSql = sql.split('CREATE TABLE "ReviewEvent"')[1]?.split('CREATE TABLE')[0] || "";
  if (/REFERENCES/i.test(reviewSql)) throw new Error("Generated SQL adds a foreign key to ReviewEvent");
  fs.writeFileSync(path.join(migrationDir, "migration.sql"), sql);

  stage.name = "generate-client";
  runPrisma(["generate", "--schema", schemaPath], splitEnv);
  const { PrismaClient } = require("../../src/generated/neon/index.js");

  stage.name = "inspect-development";
  const inspector = new PrismaClient({ datasources: { db: { url: neon.DIRECT_URL } } });
  let existing = [];
  try {
    existing = await inspector.$queryRaw`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
  } finally {
    await inspector.$disconnect();
  }
  const existingNames = existing.map((row) => row.name);
  const unexpected = existingNames.filter((name) => !businessTables.includes(name) && name !== "_prisma_migrations");
  if (unexpected.length) throw new Error(`Development has unexpected tables: ${unexpected.join(", ")}`);

  stage.name = "migrate-deploy";
  if (!existingNames.includes("DailyLesson")) {
    runPrisma(["migrate", "deploy", "--schema", schemaPath], splitEnv);
  } else if (!existingNames.includes("_prisma_migrations")) {
    throw new Error("Development already has tables but no Prisma migration history");
  }

  const prisma = new PrismaClient({ datasources: { db: { url: neon.DIRECT_URL } } });
  try {
    stage.name = "preflight-counts";
    const before = {
      UserSettings: await prisma.userSettings.count(),
      DailyLesson: await prisma.dailyLesson.count(),
      Vocabulary: await prisma.vocabulary.count(),
      WordProgress: await prisma.wordProgress.count(),
      QuizQuestion: await prisma.quizQuestion.count(),
      QuizAttempt: await prisma.quizAttempt.count(),
      StudySession: await prisma.studySession.count(),
      ReviewEvent: await prisma.reviewEvent.count(),
      AIUsageRecord: await prisma.aIUsageRecord.count(),
      ExplanationCache: await prisma.explanationCache.count(),
    };
    const total = Object.values(before).reduce((sum, count) => sum + count, 0);
    if (total > 0) {
      const same = Object.keys(sourceCounts).every((key) => before[key] === sourceCounts[key]);
      if (!same) throw new Error(`Development already contains data that does not match SQLite: ${JSON.stringify(before)}`);
    } else {
      stage.name = "import";
      await prisma.$transaction(async (tx) => {
        await tx.userSettings.createMany({ data: rows.settings });
        await tx.dailyLesson.createMany({ data: rows.lessons });
        await tx.vocabulary.createMany({ data: rows.words });
        await tx.wordProgress.createMany({ data: rows.progress });
        await tx.quizQuestion.createMany({ data: rows.questions });
        await tx.quizAttempt.createMany({ data: rows.attempts });
        await tx.studySession.createMany({ data: rows.sessions });
        await tx.reviewEvent.createMany({ data: rows.reviews });
        await tx.aIUsageRecord.createMany({ data: rows.usage });
        await tx.explanationCache.createMany({ data: rows.cache });
      }, { timeout: 60000, maxWait: 20000 });
    }

    stage.name = "verify";
    const report = await verify(prisma, source, rows, sourceCounts);
    stage.name = "compat";
    const compat = await compatibility(PrismaClient, neon, sourceCounts);
    report.compat = compat;
    fs.writeFileSync(path.join(backupDir, "neon-dev-verification.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, sourceCounts, targetCounts: report.targetCounts, fsrs: report.fsrs, cache: report.cache, compat }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function verify(prisma, source, rows, sourceCounts) {
  const targetCounts = {
    UserSettings: await prisma.userSettings.count(),
    DailyLesson: await prisma.dailyLesson.count(),
    Vocabulary: await prisma.vocabulary.count(),
    WordProgress: await prisma.wordProgress.count(),
    QuizQuestion: await prisma.quizQuestion.count(),
    QuizAttempt: await prisma.quizAttempt.count(),
    StudySession: await prisma.studySession.count(),
    ReviewEvent: await prisma.reviewEvent.count(),
    AIUsageRecord: await prisma.aIUsageRecord.count(),
    ExplanationCache: await prisma.explanationCache.count(),
  };
  const countMismatches = Object.keys(sourceCounts).filter((key) => sourceCounts[key] !== targetCounts[key]);
  if (countMismatches.length) throw new Error(`Count mismatch: ${countMismatches.join(", ")}`);

  const lessons = await prisma.dailyLesson.findMany({ orderBy: [{ lessonDate: "asc" }, { version: "asc" }] });
  const lessonMismatches = [];
  for (const sourceRow of rows.lessons) {
    const target = lessons.find((row) => row.id === sourceRow.id);
    if (!target) lessonMismatches.push({ id: sourceRow.id, field: "missing" });
    else {
      for (const field of ["lessonDate", "version", "active", "source", "progress", "listeningText", "listeningChunks", "listeningGloss"]) {
        if (JSON.stringify(target[field]) !== JSON.stringify(sourceRow[field])) lessonMismatches.push({ id: sourceRow.id, field });
      }
      if (target.createdAt.getTime() !== sourceRow.createdAt.getTime()) lessonMismatches.push({ id: sourceRow.id, field: "createdAt" });
    }
  }
  if (lessonMismatches.length) throw new Error(`Lesson mismatch ${JSON.stringify(lessonMismatches)}`);

  const words = await prisma.vocabulary.findMany();
  const wordIds = new Set(words.map((word) => word.id));
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  let orphanWords = 0;
  let morphologyBad = 0;
  for (const word of words) {
    if (!word.lessonId || !lessonIds.has(word.lessonId)) orphanWords += 1;
    if (word.morphology != null) {
      try {
        JSON.parse(word.morphology);
      } catch {
        morphologyBad += 1;
      }
    }
  }
  const sourceWordIds = new Set(rows.words.map((word) => word.id));
  if (orphanWords || morphologyBad || words.some((word) => !sourceWordIds.has(word.id))) {
    throw new Error(`Vocabulary integrity failed: orphans ${orphanWords}, bad morphology ${morphologyBad}`);
  }

  const progress = await prisma.wordProgress.findMany();
  const progressById = new Map(progress.map((row) => [row.id, row]));
  const dueMismatches = [];
  let latestFormalMismatches = 0;
  for (const sourceRow of rows.progress) {
    const target = progressById.get(sourceRow.id);
    if (!target || target.vocabularyId !== sourceRow.vocabularyId || !wordIds.has(target.vocabularyId)) {
      dueMismatches.push({ id: sourceRow.id, field: "link" });
      continue;
    }
    if (target.due.getTime() !== sourceRow.due.getTime()) dueMismatches.push({ id: sourceRow.id, field: "due" });
    const sourceLast = sourceRow.lastReview?.getTime() ?? null;
    const targetLast = target.lastReview?.getTime() ?? null;
    if (sourceLast !== targetLast) dueMismatches.push({ id: sourceRow.id, field: "lastReview" });
    for (const field of ["stability", "difficulty", "state", "reps", "lapses", "familiarity", "recallAbility"]) {
      if (target[field] !== sourceRow[field]) dueMismatches.push({ id: sourceRow.id, field });
    }
  }
  const reviews = await prisma.reviewEvent.findMany();
  const latestByWord = new Map();
  for (const review of reviews) {
    if (!wordIds.has(review.vocabularyId)) dueMismatches.push({ id: review.id, field: "review-orphan" });
    if (review.mode !== "formal") continue;
    const current = latestByWord.get(review.vocabularyId);
    if (!current || review.createdAt > current.createdAt) latestByWord.set(review.vocabularyId, review);
  }
  for (const [vocabularyId, review] of latestByWord) {
    const card = progress.find((row) => row.vocabularyId === vocabularyId);
    if (!card || card.due.getTime() !== review.dueAfter.getTime()) latestFormalMismatches += 1;
  }
  const sourceReviewIds = new Set(rows.reviews.map((row) => row.id));
  for (const sourceRow of rows.reviews) {
    const target = reviews.find((row) => row.id === sourceRow.id);
    if (!target || target.dueBefore.getTime() !== sourceRow.dueBefore.getTime() || target.dueAfter.getTime() !== sourceRow.dueAfter.getTime()) {
      dueMismatches.push({ id: sourceRow.id, field: "review-time" });
    }
  }
  if (dueMismatches.length || latestFormalMismatches || reviews.some((row) => !sourceReviewIds.has(row.id))) {
    throw new Error(`FSRS mismatch ${JSON.stringify({ dueMismatches, latestFormalMismatches })}`);
  }

  const questions = await prisma.quizQuestion.findMany();
  let questionProblems = 0;
  for (const question of questions) {
    if (!lessonIds.has(question.lessonId)) questionProblems += 1;
    try {
      JSON.parse(question.options);
      JSON.parse(question.whyWrong);
    } catch {
      questionProblems += 1;
    }
    if (question.evidence.trim().startsWith("{") || question.evidence.trim().startsWith("[")) questionProblems += 1;
  }
  const sessions = await prisma.studySession.findMany();
  const sessionProblems = sessions.filter((session) => session.lessonId && !lessonIds.has(session.lessonId)).length;
  const usage = await prisma.aIUsageRecord.findMany();
  const usageProblems = usage.filter((row) => row.createdAt.getTime() !== rows.usage.find((item) => item.id === row.id)?.createdAt.getTime()).length;
  if (questionProblems || sessionProblems || usageProblems) {
    throw new Error(`Related data mismatch questions ${questionProblems}, sessions ${sessionProblems}, usage ${usageProblems}`);
  }

  const caches = await prisma.explanationCache.findMany();
  let cacheKeyMismatches = 0;
  let analysisMismatches = 0;
  let sentenceHits = 0;
  for (const sourceRow of rows.cache) {
    const target = caches.find((row) => row.cacheKey === sourceRow.cacheKey);
    if (!target || target.id !== sourceRow.id) cacheKeyMismatches += 1;
    else {
      if (target.analysis !== sourceRow.analysis) analysisMismatches += 1;
      if (target.sentence === sourceRow.sentence && target.createdAt.getTime() === sourceRow.createdAt.getTime()) sentenceHits += 1;
    }
  }
  const distinctAnalysis = new Set(caches.map((row) => row.analysis)).size;
  if (cacheKeyMismatches || analysisMismatches || sentenceHits !== rows.cache.length) {
    throw new Error(`Cache mismatch keys ${cacheKeyMismatches}, analysis ${analysisMismatches}, hits ${sentenceHits}`);
  }

  const active = await prisma.dailyLesson.groupBy({ by: ["lessonDate"], _sum: { version: true }, where: { active: true } });
  return {
    targetCounts,
    lessons: lessons.map((row) => ({ lessonDate: row.lessonDate, version: row.version, active: row.active, source: row.source })),
    fsrs: {
      cards: progress.length,
      dueMatches: progress.length - dueMismatches.filter((item) => item.field === "due").length,
      latestFormalMatches: latestByWord.size - latestFormalMismatches,
      formalEvents: reviews.filter((row) => row.mode === "formal").length,
    },
    cache: {
      entries: caches.length,
      version: source.cacheVersion,
      sentenceHits,
      distinctAnalysis,
    },
    activeDates: active.map((row) => row.lessonDate).sort(),
    studySessions: sessions.map((row) => ({ module: row.module, minutes: row.minutes, createdAt: row.createdAt.toISOString() })),
  };
}

async function compatibility(PrismaClient, neon, sourceCounts) {
  const direct = new PrismaClient({ datasources: { db: { url: neon.DIRECT_URL } } });
  const pooled = new PrismaClient({ datasources: { db: { url: neon.DATABASE_URL } } });
  const before = await direct.dailyLesson.count();
  const results = {};
  try {
    const started = Date.now();
    const joined = await pooled.dailyLesson.findFirst({
      where: { active: true },
      include: { words: { include: { progress: true } }, questions: true },
      orderBy: { lessonDate: "desc" },
    });
    results.pooledQueryMs = Date.now() - started;
    results.pooledRelation = Boolean(joined && joined.words.length === 6 && joined.questions.length === 3 && joined.words.every((word) => word.progress));
    results.directCount = await direct.dailyLesson.count();
    results.pooledCount = await pooled.dailyLesson.count();
    results.sameCount = results.directCount === results.pooledCount && results.directCount === sourceCounts.DailyLesson;

    let uniqueRejected = false;
    try {
      await direct.dailyLesson.create({
        data: {
          id: "neon-dev-unique-probe",
          lessonDate: joined.lessonDate,
          version: joined.version,
          theme: "probe",
          difficulty: "probe",
          newWordCount: 0,
          estimatedMinutes: 0,
          source: "probe",
          progress: "{}",
          listeningTitle: "probe",
          listeningText: "probe",
          listeningChunks: "[]",
          listeningGloss: "{}",
        },
      });
    } catch {
      uniqueRejected = true;
    }
    if (await direct.dailyLesson.findUnique({ where: { id: "neon-dev-unique-probe" } })) {
      await direct.dailyLesson.delete({ where: { id: "neon-dev-unique-probe" } });
      uniqueRejected = false;
    }
    results.uniqueConstraintRejected = uniqueRejected;

    const probeDue = 1795340572518;
    let roundTrip = null;
    try {
      await direct.$transaction(async (tx) => {
        await tx.dailyLesson.create({
          data: {
            id: "neon-dev-rollback",
            lessonDate: "2099-12-31",
            version: 1,
            theme: "probe",
            difficulty: "probe",
            newWordCount: 0,
            estimatedMinutes: 0,
            source: "probe",
            progress: "{}",
            listeningTitle: "probe",
            listeningText: "probe",
            listeningChunks: "[]",
            listeningGloss: "{}",
            words: {
              create: {
                id: "neon-dev-rollback-word",
                lemma: "neon-dev-probe",
                pos: "noun",
                meaningZh: "probe",
                definitionEn: "probe",
                collocation: "probe",
                example: "probe",
                exampleZh: "probe",
                difficulty: "probe",
                theme: "probe",
                progress: { create: { id: "neon-dev-rollback-progress", due: new Date(probeDue), stability: 1.25, difficulty: 2.5 } },
              },
            },
          },
        });
        await tx.dailyLesson.updateMany({ where: { lessonDate: "2099-12-31" }, data: { active: false } });
        await tx.dailyLesson.update({ where: { id: "neon-dev-rollback" }, data: { active: true } });
        const card = await tx.wordProgress.findUnique({ where: { id: "neon-dev-rollback-progress" } });
        roundTrip = card?.due.getTime() ?? null;
        const active = await tx.dailyLesson.findUnique({ where: { id: "neon-dev-rollback" } });
        if (!active?.active) throw new Error("activate pattern failed");
        throw new Error("ROLLBACK_TEST");
      });
    } catch (error) {
      if (!String(error.message).includes("ROLLBACK_TEST")) throw error;
    }
    if (await direct.dailyLesson.findUnique({ where: { id: "neon-dev-rollback" } })) {
      await direct.dailyLesson.delete({ where: { id: "neon-dev-rollback" } });
      results.interactiveTransactionRolledBack = false;
    } else {
      results.interactiveTransactionRolledBack = true;
    }
    results.dateRoundTripMillisMatch = roundTrip === probeDue;

    await pooled.$disconnect();
    await pooled.$connect();
    results.reconnectCount = await pooled.dailyLesson.count();
    const missing = await pooled.dailyLesson.findUnique({ where: { id: "does-not-exist" } });
    results.missingRecordIsNull = missing == null;
    results.countsUnchanged = (await direct.dailyLesson.count()) === before;
    results.idleSuspendWait = "not tested; compute suspend takes several minutes and was not forced";
    return results;
  } finally {
    await direct.$disconnect();
    await pooled.$disconnect();
  }
}

main().catch((error) => fail("run", error));
