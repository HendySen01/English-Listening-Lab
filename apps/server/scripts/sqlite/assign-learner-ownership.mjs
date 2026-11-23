import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const labDatabasePath = path.join(repoRoot, "data", "lab.db");
export const authDatabasePath = path.join(repoRoot, "data", "auth.db");
export const originalLearnerId = "learner_original_lab";
export const originalAuthUserId = "unbound:original-lab";
const revisionId = "multiuser-ownership-1";

const forbidden = new Set(["lab.db", "auth.db", "auth-selftest.db", "selftest.db", "upgrade-test.db"]);

export function assertIsolatedDrill(file) {
  const resolved = path.resolve(file);
  const base = path.basename(resolved).toLowerCase();
  const dataDir = path.resolve(repoRoot, "data");
  if (!resolved.startsWith(dataDir + path.sep)) throw new Error("演练库必须位于 data 目录。");
  if (forbidden.has(base) || !base.startsWith("user-drill") || !base.endsWith(".db")) {
    throw new Error("演练库文件名必须是 user-drill 开头，且不能是学习库或认证库。");
  }
  if (resolved === path.resolve(labDatabasePath) || resolved === path.resolve(authDatabasePath)) {
    throw new Error("拒绝写入真实学习库或认证库。");
  }
}

export function databaseStamp(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

export async function backupLabReadonly(destination) {
  assertIsolatedDrill(destination);
  const before = databaseStamp(labDatabasePath);
  const authBefore = databaseStamp(authDatabasePath);
  const source = new DatabaseSync(labDatabasePath, { readOnly: true });
  try {
    await backup(source, destination);
  } finally {
    source.close();
  }
  const after = databaseStamp(labDatabasePath);
  const authAfter = databaseStamp(authDatabasePath);
  if (!before || !after || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("只读备份后 lab.db 的文件状态发生了变化，演练已停止。");
  }
  if (authBefore && authAfter && (authBefore.size !== authAfter.size || authBefore.mtimeMs !== authAfter.mtimeMs)) {
    throw new Error("只读备份后 auth.db 的文件状态发生了变化，演练已停止。");
  }
  return destination;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function countOf(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

export function snapshotLearningData(db) {
  const progress = db.prepare(`SELECT id, vocabularyId, due, stability, difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state, lastReview, firstLearnedAt, correctCount, incorrectCount, familiarity, recallAbility FROM WordProgress ORDER BY id`).all();
  const reviews = db.prepare(`SELECT id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt FROM ReviewEvent ORDER BY id`).all();
  const lessons = db.prepare(`SELECT id, lessonDate, version, active, createdAt FROM DailyLesson ORDER BY id`).all();
  const settings = db.prepare(`SELECT dailyNewWords, difficulty, listeningLevel, dailyMinutes, theme, customTheme, autoGenerate, ttsVoice, speechRate, locale, colorMode, wordPartsEnabled, recommendationsEnabled, updatedAt FROM UserSettings`).all();
  return {
    counts: {
      settings: countOf(db, "UserSettings"),
      lessons: countOf(db, "DailyLesson"),
      words: countOf(db, "Vocabulary"),
      progress: countOf(db, "WordProgress"),
      reviews: countOf(db, "ReviewEvent"),
      questions: countOf(db, "QuizQuestion"),
      attempts: countOf(db, "QuizAttempt"),
      sessions: countOf(db, "StudySession"),
      usage: countOf(db, "AIUsageRecord"),
    },
    ids: {
      lessons: lessons.map((row) => row.id),
      words: db.prepare(`SELECT id FROM Vocabulary ORDER BY id`).all().map((row) => row.id),
      progress: progress.map((row) => row.id),
      reviews: reviews.map((row) => row.id),
    },
    progress,
    reviews,
    lessons,
    settings,
  };
}

function alreadyUpgraded(db) {
  const learner = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Learner'`).get();
  const revision = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'SchemaRevision'`).get();
  if (!learner && !revision) return false;
  if (!learner || !revision || !columnNames(db, "DailyLesson").includes("userId")) {
    throw new Error("演练库处于半迁移状态，已停止。请换一份新的备份副本。");
  }
  return true;
}

function createNextTables(db) {
  db.exec(`
    CREATE TABLE Learner (
      id TEXT PRIMARY KEY,
      authUserId TEXT NOT NULL UNIQUE,
      boundAt INTEGER,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE SchemaRevision (
      id TEXT PRIMARY KEY,
      appliedAt INTEGER NOT NULL
    );
    CREATE TABLE UserSettings_next (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL UNIQUE REFERENCES Learner(id) ON DELETE CASCADE,
      dailyNewWords INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      listeningLevel TEXT NOT NULL,
      dailyMinutes INTEGER NOT NULL,
      theme TEXT NOT NULL,
      customTheme TEXT NOT NULL,
      autoGenerate INTEGER NOT NULL,
      ttsVoice TEXT NOT NULL,
      speechRate REAL NOT NULL,
      locale TEXT NOT NULL,
      colorMode TEXT NOT NULL,
      wordPartsEnabled INTEGER NOT NULL,
      recommendationsEnabled INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE DailyLesson_next (
      id TEXT PRIMARY KEY,
      lessonDate TEXT NOT NULL,
      version INTEGER NOT NULL,
      active INTEGER NOT NULL,
      theme TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      newWordCount INTEGER NOT NULL,
      estimatedMinutes INTEGER NOT NULL,
      source TEXT NOT NULL,
      model TEXT,
      poolNote TEXT NOT NULL,
      progress TEXT NOT NULL,
      listeningTitle TEXT NOT NULL,
      listeningText TEXT NOT NULL,
      listeningChunks TEXT NOT NULL,
      listeningGloss TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      userId TEXT NOT NULL REFERENCES Learner(id) ON DELETE CASCADE,
      UNIQUE (id, userId),
      UNIQUE (userId, lessonDate, version)
    );
    CREATE INDEX DailyLesson_user_date_active_idx ON DailyLesson_next(userId, lessonDate, active);
    CREATE TABLE Vocabulary_next (
      id TEXT PRIMARY KEY,
      lemma TEXT NOT NULL,
      pos TEXT NOT NULL,
      ipa TEXT,
      ipaNote TEXT NOT NULL,
      stress TEXT,
      meaningZh TEXT NOT NULL,
      definitionEn TEXT NOT NULL,
      collocation TEXT NOT NULL,
      example TEXT NOT NULL,
      exampleZh TEXT NOT NULL,
      morphology TEXT,
      difficulty TEXT NOT NULL,
      theme TEXT NOT NULL,
      knownAlready INTEGER NOT NULL,
      exampleFlagged INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      lessonId TEXT,
      userId TEXT NOT NULL REFERENCES Learner(id) ON DELETE CASCADE,
      UNIQUE (id, userId),
      FOREIGN KEY (lessonId, userId) REFERENCES DailyLesson_next(id, userId) ON DELETE CASCADE
    );
    CREATE INDEX Vocabulary_user_lemma_idx ON Vocabulary_next(userId, lemma);
    CREATE TABLE WordProgress_next (
      id TEXT PRIMARY KEY,
      vocabularyId TEXT NOT NULL UNIQUE,
      due INTEGER NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      elapsedDays INTEGER NOT NULL,
      scheduledDays INTEGER NOT NULL,
      learningSteps INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      state INTEGER NOT NULL,
      lastReview INTEGER,
      firstLearnedAt INTEGER NOT NULL,
      correctCount INTEGER NOT NULL,
      incorrectCount INTEGER NOT NULL,
      familiarity TEXT NOT NULL,
      recallAbility TEXT NOT NULL,
      userId TEXT NOT NULL,
      UNIQUE (vocabularyId, userId),
      FOREIGN KEY (vocabularyId, userId) REFERENCES Vocabulary_next(id, userId) ON DELETE CASCADE
    );
    CREATE INDEX WordProgress_user_due_idx ON WordProgress_next(userId, due);
    CREATE TABLE QuizQuestion_next (
      id TEXT PRIMARY KEY,
      lessonId TEXT NOT NULL,
      sortOrder INTEGER NOT NULL,
      kind TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options TEXT NOT NULL,
      answerIndex INTEGER NOT NULL,
      explanationEn TEXT NOT NULL,
      explanationZh TEXT NOT NULL,
      simplerZh TEXT NOT NULL,
      evidence TEXT NOT NULL,
      whyWrong TEXT NOT NULL,
      userId TEXT NOT NULL,
      UNIQUE (id, userId),
      FOREIGN KEY (lessonId, userId) REFERENCES DailyLesson_next(id, userId) ON DELETE CASCADE
    );
    CREATE TABLE QuizAttempt_next (
      id TEXT PRIMARY KEY,
      questionId TEXT NOT NULL,
      selected INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      userId TEXT NOT NULL,
      FOREIGN KEY (questionId, userId) REFERENCES QuizQuestion_next(id, userId) ON DELETE CASCADE
    );
    CREATE INDEX QuizAttempt_user_created_idx ON QuizAttempt_next(userId, createdAt);
    CREATE TABLE StudySession_next (
      id TEXT PRIMARY KEY,
      lessonId TEXT,
      module TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      userId TEXT NOT NULL REFERENCES Learner(id) ON DELETE CASCADE
    );
    CREATE INDEX StudySession_user_created_idx ON StudySession_next(userId, createdAt);
    CREATE TABLE ReviewEvent_next (
      id TEXT PRIMARY KEY,
      vocabularyId TEXT NOT NULL,
      clientRequestId TEXT,
      mode TEXT NOT NULL,
      rating TEXT NOT NULL,
      dueBefore INTEGER NOT NULL,
      dueAfter INTEGER NOT NULL,
      changedSchedule INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      userId TEXT NOT NULL REFERENCES Learner(id) ON DELETE CASCADE,
      UNIQUE (userId, clientRequestId)
    );
    CREATE INDEX ReviewEvent_user_vocab_created_idx ON ReviewEvent_next(userId, vocabularyId, createdAt);
    CREATE TABLE AIUsageRecord_next (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      promptTokens INTEGER,
      completionTokens INTEGER,
      success INTEGER NOT NULL,
      error TEXT,
      createdAt INTEGER NOT NULL,
      userId TEXT NOT NULL REFERENCES Learner(id) ON DELETE CASCADE
    );
    CREATE INDEX AIUsageRecord_user_created_idx ON AIUsageRecord_next(userId, createdAt);
    CREATE INDEX AIUsageRecord_created_idx ON AIUsageRecord_next(createdAt);
  `);
}

function copyRows(db) {
  const now = Date.now();
  db.prepare(`INSERT INTO Learner (id, authUserId, boundAt, createdAt) VALUES (?, ?, NULL, ?)`).run(originalLearnerId, originalAuthUserId, now);
  const settings = countOf(db, "UserSettings");
  if (settings !== 1) throw new Error("原设置不是单行，演练已停止。");
  db.exec(`
    INSERT INTO UserSettings_next (
      id, userId, dailyNewWords, difficulty, listeningLevel, dailyMinutes, theme, customTheme,
      autoGenerate, ttsVoice, speechRate, locale, colorMode, wordPartsEnabled, recommendationsEnabled, updatedAt
    )
    SELECT 'settings_original_lab', '${originalLearnerId}', dailyNewWords, difficulty, listeningLevel, dailyMinutes,
      theme, customTheme, autoGenerate, ttsVoice, speechRate, locale, colorMode, wordPartsEnabled, recommendationsEnabled, updatedAt
    FROM UserSettings;
    INSERT INTO DailyLesson_next (
      id, lessonDate, version, active, theme, difficulty, newWordCount, estimatedMinutes, source, model, poolNote,
      progress, listeningTitle, listeningText, listeningChunks, listeningGloss, createdAt, userId
    )
    SELECT id, lessonDate, version, active, theme, difficulty, newWordCount, estimatedMinutes, source, model, poolNote,
      progress, listeningTitle, listeningText, listeningChunks, listeningGloss, createdAt, '${originalLearnerId}'
    FROM DailyLesson;
    INSERT INTO Vocabulary_next (
      id, lemma, pos, ipa, ipaNote, stress, meaningZh, definitionEn, collocation, example, exampleZh, morphology,
      difficulty, theme, knownAlready, exampleFlagged, createdAt, lessonId, userId
    )
    SELECT id, lemma, pos, ipa, ipaNote, stress, meaningZh, definitionEn, collocation, example, exampleZh, morphology,
      difficulty, theme, knownAlready, exampleFlagged, createdAt, lessonId, '${originalLearnerId}'
    FROM Vocabulary;
    INSERT INTO WordProgress_next (
      id, vocabularyId, due, stability, difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state,
      lastReview, firstLearnedAt, correctCount, incorrectCount, familiarity, recallAbility, userId
    )
    SELECT id, vocabularyId, due, stability, difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state,
      lastReview, firstLearnedAt, correctCount, incorrectCount, familiarity, recallAbility, '${originalLearnerId}'
    FROM WordProgress;
    INSERT INTO QuizQuestion_next (
      id, lessonId, sortOrder, kind, prompt, options, answerIndex, explanationEn, explanationZh, simplerZh, evidence, whyWrong, userId
    )
    SELECT id, lessonId, sortOrder, kind, prompt, options, answerIndex, explanationEn, explanationZh, simplerZh, evidence, whyWrong, '${originalLearnerId}'
    FROM QuizQuestion;
    INSERT INTO QuizAttempt_next (id, questionId, selected, correct, createdAt, userId)
    SELECT id, questionId, selected, correct, createdAt, '${originalLearnerId}' FROM QuizAttempt;
    INSERT INTO StudySession_next (id, lessonId, module, minutes, createdAt, userId)
    SELECT id, lessonId, module, minutes, createdAt, '${originalLearnerId}' FROM StudySession;
    INSERT INTO AIUsageRecord_next (id, kind, model, promptTokens, completionTokens, success, error, createdAt, userId)
    SELECT id, kind, model, promptTokens, completionTokens, success, error, createdAt, '${originalLearnerId}' FROM AIUsageRecord;
  `);
  const reviewCopied = db.prepare(`
    INSERT INTO ReviewEvent_next (
      id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt, userId
    )
    SELECT e.id, e.vocabularyId, e.clientRequestId, e.mode, e.rating, e.dueBefore, e.dueAfter, e.changedSchedule, e.createdAt, v.userId
    FROM ReviewEvent e
    JOIN Vocabulary_next v ON v.id = e.vocabularyId
  `).run().changes;
  if (reviewCopied !== countOf(db, "ReviewEvent")) throw new Error("有复习事件找不到对应单词，演练已回滚。");
}

function replaceTables(db) {
  db.exec(`
    DROP TABLE QuizAttempt;
    DROP TABLE QuizQuestion;
    DROP TABLE WordProgress;
    DROP TABLE ReviewEvent;
    DROP TABLE StudySession;
    DROP TABLE AIUsageRecord;
    DROP TABLE Vocabulary;
    DROP TABLE DailyLesson;
    DROP TABLE UserSettings;
    ALTER TABLE UserSettings_next RENAME TO UserSettings;
    ALTER TABLE DailyLesson_next RENAME TO DailyLesson;
    ALTER TABLE Vocabulary_next RENAME TO Vocabulary;
    ALTER TABLE WordProgress_next RENAME TO WordProgress;
    ALTER TABLE QuizQuestion_next RENAME TO QuizQuestion;
    ALTER TABLE QuizAttempt_next RENAME TO QuizAttempt;
    ALTER TABLE StudySession_next RENAME TO StudySession;
    ALTER TABLE ReviewEvent_next RENAME TO ReviewEvent;
    ALTER TABLE AIUsageRecord_next RENAME TO AIUsageRecord;
    CREATE TRIGGER vocabulary_same_user_insert BEFORE INSERT ON Vocabulary
    WHEN NEW.lessonId IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'cross-user-link')
      WHERE NOT EXISTS (SELECT 1 FROM DailyLesson WHERE id = NEW.lessonId AND userId = NEW.userId);
    END;
    CREATE TRIGGER vocabulary_same_user_update BEFORE UPDATE ON Vocabulary
    WHEN NEW.lessonId IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'cross-user-link')
      WHERE NOT EXISTS (SELECT 1 FROM DailyLesson WHERE id = NEW.lessonId AND userId = NEW.userId);
    END;
    CREATE TRIGGER study_session_same_user_insert BEFORE INSERT ON StudySession
    WHEN NEW.lessonId IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'cross-user-link')
      WHERE NOT EXISTS (SELECT 1 FROM DailyLesson WHERE id = NEW.lessonId AND userId = NEW.userId);
    END;
    CREATE TRIGGER study_session_same_user_update BEFORE UPDATE ON StudySession
    WHEN NEW.lessonId IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'cross-user-link')
      WHERE NOT EXISTS (SELECT 1 FROM DailyLesson WHERE id = NEW.lessonId AND userId = NEW.userId);
    END;
    CREATE TRIGGER daily_lesson_clear_sessions AFTER DELETE ON DailyLesson
    BEGIN
      UPDATE StudySession SET lessonId = NULL WHERE lessonId = OLD.id AND userId = OLD.userId;
    END;
  `);
}

export function assignLearnerOwnership(db, options = {}) {
  if (alreadyUpgraded(db)) return { already: true };
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    createNextTables(db);
    copyRows(db);
    replaceTables(db);
    const broken = db.prepare("PRAGMA foreign_key_check").all();
    if (broken.length) throw new Error("外键检查没有通过，演练已回滚。");
    if (options.failBeforeCommit) throw new Error("演练故障：提交前停止。");
    db.prepare("INSERT INTO SchemaRevision (id, appliedAt) VALUES (?, ?)").run(revisionId, Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  return { already: false };
}
