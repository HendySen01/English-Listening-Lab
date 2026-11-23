import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { repoRoot } from "./paths.ts";
import {
  assignLearnerOwnership,
  authDatabasePath,
  backupLabReadonly,
  databaseStamp,
  labDatabasePath,
  originalAuthUserId,
  originalLearnerId,
  snapshotLearningData,
} from "../scripts/sqlite/assign-learner-ownership.mjs";

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
}

function stamp(file: string) {
  return databaseStamp(file);
}

function openDrill(file: string) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const labBefore = stamp(labDatabasePath);
const authBefore = stamp(authDatabasePath);
const baseFile = path.join(repoRoot, "data", "user-drill-base.db");
const drillFile = path.join(repoRoot, "data", "user-drill.db");
const rollbackFile = path.join(repoRoot, "data", "user-drill-rollback.db");
for (const file of [baseFile, drillFile, rollbackFile]) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target);
  }
}

await backupLabReadonly(baseFile);
fs.copyFileSync(baseFile, drillFile);
fs.copyFileSync(baseFile, rollbackFile);

const source = new DatabaseSync(baseFile, { readOnly: true });
const before = snapshotLearningData(source);
source.close();
const liveSchema = fs.readFileSync(path.join(repoRoot, "apps/server/prisma/schema.prisma"), "utf8");
check("运行中的业务 Schema 仍是单用户", liveSchema.includes("id                     Int      @id @default(1)") && liveSchema.includes("@@unique([lessonDate, version])"));
check("副本读到现有学习规模", before.counts.lessons === 5 && before.counts.words === 30 && before.counts.progress === 30 && before.counts.reviews === 11 && before.counts.questions === 15 && before.counts.sessions === 3 && before.counts.usage === 7);

const rollback = openDrill(rollbackFile);
let rollbackFailed = false;
try {
  assignLearnerOwnership(rollback, { failBeforeCommit: true });
} catch (error) {
  rollbackFailed = error instanceof Error && error.message.includes("演练故障");
} finally {
  rollback.close();
}
const rolled = new DatabaseSync(rollbackFile, { readOnly: true });
const rolledSnapshot = snapshotLearningData(rolled);
const learnerLeft = rolled.prepare(`SELECT name FROM sqlite_master WHERE name = 'Learner'`).get();
rolled.close();
check("提交前失败会回滚", rollbackFailed && !learnerLeft && sameJson(before, rolledSnapshot));

const drill = openDrill(drillFile);
assignLearnerOwnership(drill);
const migrated = snapshotLearningData(drill);
check("迁移后数量不变", sameJson(before.counts, migrated.counts));
check("课程、单词、进度和复习的原标识保留", sameJson(before.ids, migrated.ids));
check("FSRS 参数和时间没有重算", sameJson(before.progress, migrated.progress));
check("复习事件历史没有改写", sameJson(before.reviews, migrated.reviews));
check("学习日和课程版本没有改写", sameJson(before.lessons, migrated.lessons));
check("原设置内容保留", sameJson(before.settings, migrated.settings));
check("历史记录归到未绑定的演练用户", drill.prepare(`SELECT authUserId, boundAt FROM Learner WHERE id = ?`).get(originalLearnerId).authUserId === originalAuthUserId);
check("历史请求号仍全部为空", Number(drill.prepare(`SELECT COUNT(*) AS n FROM ReviewEvent WHERE clientRequestId IS NULL`).get().n) === before.counts.reviews);
const again = assignLearnerOwnership(drill);
check("重复执行不会复制数据", again.already === true && sameJson(snapshotLearningData(drill).counts, before.counts));

const lesson = drill.prepare(`SELECT lessonDate, version, active, theme, difficulty, newWordCount, estimatedMinutes, source, poolNote, progress, listeningTitle, listeningText, listeningChunks, listeningGloss, createdAt FROM DailyLesson WHERE userId = ? LIMIT 1`).get(originalLearnerId) as Record<string, unknown>;
drill.prepare(`INSERT INTO Learner (id, authUserId, boundAt, createdAt) VALUES ('learner_drill_b', 'unbound:drill-b', NULL, ?)`).run(Date.now());
drill.prepare(`
  INSERT INTO DailyLesson (
    id, lessonDate, version, active, theme, difficulty, newWordCount, estimatedMinutes, source, model, poolNote,
    progress, listeningTitle, listeningText, listeningChunks, listeningGloss, createdAt, userId
  ) VALUES (
    'lesson_b_same_slot', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'learner_drill_b'
  )
`).run(lesson.lessonDate, lesson.version, lesson.active, lesson.theme, lesson.difficulty, lesson.newWordCount, lesson.estimatedMinutes, lesson.source, lesson.poolNote, lesson.progress, lesson.listeningTitle, lesson.listeningText, lesson.listeningChunks, lesson.listeningGloss, lesson.createdAt);
const word = drill.prepare(`SELECT lemma, pos, ipaNote, meaningZh, definitionEn, collocation, example, exampleZh, difficulty, theme, knownAlready, exampleFlagged, createdAt FROM Vocabulary WHERE userId = ? LIMIT 1`).get(originalLearnerId) as Record<string, unknown>;
drill.prepare(`
  INSERT INTO Vocabulary (
    id, lemma, pos, ipa, ipaNote, stress, meaningZh, definitionEn, collocation, example, exampleZh, morphology,
    difficulty, theme, knownAlready, exampleFlagged, createdAt, lessonId, userId
  ) VALUES (
    'vocab_b_same_lemma', ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 'learner_drill_b'
  )
`).run(word.lemma, word.pos, word.ipaNote, word.meaningZh, word.definitionEn, word.collocation, word.example, word.exampleZh, word.difficulty, word.theme, word.knownAlready, word.exampleFlagged, word.createdAt);
const progress = drill.prepare(`SELECT due, stability, difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state, lastReview, firstLearnedAt, correctCount, incorrectCount, familiarity, recallAbility FROM WordProgress WHERE userId = ? LIMIT 1`).get(originalLearnerId) as Record<string, number | string | null>;
const repsBefore = progress.reps;
drill.prepare(`
  INSERT INTO WordProgress (
    id, vocabularyId, due, stability, difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state,
    lastReview, firstLearnedAt, correctCount, incorrectCount, familiarity, recallAbility, userId
  ) VALUES (
    'progress_b', 'vocab_b_same_lemma', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'learner_drill_b'
  )
`).run(progress.due, progress.stability, progress.difficulty, progress.elapsedDays, progress.scheduledDays, progress.learningSteps, progress.reps, progress.lapses, progress.state, progress.lastReview, progress.firstLearnedAt, progress.correctCount, progress.incorrectCount, progress.familiarity, progress.recallAbility);
drill.prepare(`UPDATE WordProgress SET reps = reps + 1 WHERE id = 'progress_b'`).run();
check("同一天可以各有一节相同版本的课", Number(drill.prepare(`SELECT COUNT(*) AS n FROM DailyLesson WHERE lessonDate = ? AND version = ?`).get(lesson.lessonDate, lesson.version).n) === 2);
check("两个用户可以拥有同一个英文单词", Number(drill.prepare(`SELECT COUNT(*) AS n FROM Vocabulary WHERE lemma = ?`).get(word.lemma).n) >= 2);
check("更新 B 的进度不会改到 A", drill.prepare(`SELECT reps FROM WordProgress WHERE userId = ? AND reps = ?`).get(originalLearnerId, repsBefore) && Number(drill.prepare(`SELECT reps FROM WordProgress WHERE id = 'progress_b'`).get().reps) === Number(repsBefore) + 1);

drill.prepare(`
  INSERT INTO ReviewEvent (id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt, userId)
  VALUES ('review_a_shared', ?, 'shared-request-id-1844', 'formal', 'good', 1, 2, 1, 3, ?)
`).run(before.ids.words[0], originalLearnerId);
drill.prepare(`
  INSERT INTO ReviewEvent (id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt, userId)
  VALUES ('review_b_shared', 'vocab_b_same_lemma', 'shared-request-id-1844', 'formal', 'hard', 1, 2, 1, 4, 'learner_drill_b')
`).run();
let duplicateRejected = false;
try {
  drill.prepare(`
    INSERT INTO ReviewEvent (id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt, userId)
    VALUES ('review_a_repeat', ?, 'shared-request-id-1844', 'formal', 'again', 1, 2, 1, 5, ?)
  `).run(before.ids.words[0], originalLearnerId);
} catch {
  duplicateRejected = true;
}
check("同一请求号可以分属两个用户", Number(drill.prepare(`SELECT COUNT(*) AS n FROM ReviewEvent WHERE clientRequestId = 'shared-request-id-1844'`).get().n) === 2);
check("同一用户重复请求号被拒绝", duplicateRejected);

const questionId = before.ids.lessons.length ? drill.prepare(`SELECT id FROM QuizQuestion WHERE userId = ? LIMIT 1`).get(originalLearnerId).id : "";
let crossQuestion = false;
try {
  drill.prepare(`INSERT INTO QuizAttempt (id, questionId, selected, correct, createdAt, userId) VALUES ('attempt_b', ?, 0, 0, 1, 'learner_drill_b')`).run(questionId);
} catch {
  crossQuestion = true;
}
let crossLesson = false;
try {
  const lessonId = drill.prepare(`SELECT id FROM DailyLesson WHERE userId = ? LIMIT 1`).get(originalLearnerId).id;
  drill.prepare(`INSERT INTO StudySession (id, lessonId, module, minutes, createdAt, userId) VALUES ('session_b', ?, 'lesson', 5, 1, 'learner_drill_b')`).run(lessonId);
} catch (error) {
  crossLesson = error instanceof Error && error.message.includes("cross-user-link");
}
let crossWord = false;
try {
  const lessonId = drill.prepare(`SELECT id FROM DailyLesson WHERE userId = ? LIMIT 1`).get(originalLearnerId).id;
  drill.prepare(`
    UPDATE Vocabulary SET lessonId = ? WHERE id = 'vocab_b_same_lemma'
  `).run(lessonId);
} catch {
  crossWord = true;
}
check("不能把答题写到另一个用户的题目", crossQuestion && Number(drill.prepare(`SELECT COUNT(*) AS n FROM QuizAttempt`).get().n) === before.counts.attempts);
check("不能把学习记录挂到另一个用户的课程", crossLesson);
check("不能把单词挂到另一个用户的课程", crossWord);
drill.prepare(`INSERT INTO StudySession (id, lessonId, module, minutes, createdAt, userId) VALUES ('session_b_own', 'lesson_b_same_slot', 'lesson', 5, 1, 'learner_drill_b')`).run();
drill.prepare(`INSERT INTO AIUsageRecord (id, kind, model, promptTokens, completionTokens, success, error, createdAt, userId) VALUES ('usage_b', 'drill', 'none', 0, 0, 1, NULL, 1, 'learner_drill_b')`).run();
check("学习时长和 AI 记录按用户分开", Number(drill.prepare(`SELECT COUNT(*) AS n FROM StudySession WHERE userId = 'learner_drill_b'`).get().n) === 1 && Number(drill.prepare(`SELECT COUNT(*) AS n FROM AIUsageRecord WHERE userId = ?`).get(originalLearnerId).n) === before.counts.usage);

drill.exec("BEGIN");
const bound = drill.prepare(`UPDATE Learner SET authUserId = 'auth_user_drill_only', boundAt = ? WHERE id = ? AND authUserId = ? AND boundAt IS NULL`).run(Date.now(), originalLearnerId, originalAuthUserId);
check("未来绑定只更新未绑定的学习者", Number(bound.changes) === 1);
drill.exec("ROLLBACK");
check("演练绑定没有留下", drill.prepare(`SELECT authUserId FROM Learner WHERE id = ?`).get(originalLearnerId).authUserId === originalAuthUserId);
drill.close();

const verified = openDrill(drillFile);
const broken = verified.prepare("PRAGMA foreign_key_check").all();
verified.close();
check("迁移后的外键检查为空", broken.length === 0);

const labAfter = stamp(labDatabasePath);
const authAfter = stamp(authDatabasePath);
check("lab.db 文件没有被改写", sameJson(labBefore, labAfter));
check("auth.db 文件没有被改写", sameJson(authBefore, authAfter));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("user drill ok");
