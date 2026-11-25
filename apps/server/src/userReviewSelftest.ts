import { execSync } from "node:child_process";
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
  originalLearnerId,
} from "../scripts/sqlite/assign-learner-ownership.mjs";

const runtimeFile = path.join(repoRoot, "data", "user-runtime.db");
const authRuntimeFile = path.join(repoRoot, "data", "auth-runtime.db");
process.env.DATABASE_URL = `file:${path.join(repoRoot, "data", "selftest.db").replace(/\\/g, "/")}`;
process.env.USER_DATABASE_URL = `file:${runtimeFile.replace(/\\/g, "/")}`;
process.env.AUTH_DATABASE_URL = `file:${authRuntimeFile.replace(/\\/g, "/")}`;
process.env.USER_RUNTIME = "1";
process.env.BETTER_AUTH_SECRET = "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8797";
process.env.BETTER_AUTH_TRUSTED_ORIGINS = "http://127.0.0.1:8797,http://localhost:8797";
process.env.AUTH_SELFTEST = "1";
process.env.LLM_API_KEY = "";
process.env.TTS_API_KEY = "";

const { AppError } = await import("./errors.ts");
const { createPrivateTestAccount } = await import("./auth.ts");
const { disconnectAuthPrisma } = await import("./authDatabase.ts");
const { createUserRuntimeApp } = await import("./userRuntimeApp.ts");
const { disconnectUserPrisma, getUserPrisma } = await import("./userDatabase.ts");
const {
  learnerReviewStarts,
  practiceOwnWord,
  rateOwnWord,
  resetLearnerReviewProbe,
  setLearnerReviewFaults,
} = await import("./learnerReview.ts");
const { schedule } = await import("./srs.ts");

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
}

function removeDatabase(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(`${file}${suffix}`)) fs.rmSync(`${file}${suffix}`);
}
function counts(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const progress = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(reps), 0) AS reps FROM WordProgress").get() as { n: number; reps: number };
    return {
      lessons: Number(db.prepare("SELECT COUNT(*) AS n FROM DailyLesson").get().n),
      progress: Number(progress.n),
      reps: Number(progress.reps),
      reviews: Number(db.prepare("SELECT COUNT(*) AS n FROM ReviewEvent").get().n),
    };
  } finally {
    db.close();
  }
}

const labBefore = databaseStamp(labDatabasePath);
const authBefore = databaseStamp(authDatabasePath);
const labCountsBefore = counts(labDatabasePath);
removeDatabase(runtimeFile);
removeDatabase(authRuntimeFile);
await backupLabReadonly(runtimeFile);
const migrated = new DatabaseSync(runtimeFile);
assignLearnerOwnership(migrated);
const originalFsrs = JSON.stringify(migrated.prepare("SELECT id, due, stability, difficulty, reps, lapses, state FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId));
migrated.close();
execSync("node scripts/auth/push.mjs", { cwd: path.join(repoRoot, "apps/server"), env: process.env, stdio: "inherit" });

const alpha = await createPrivateTestAccount({ email: "review-a@lab.test", password: "review-a-pass-1844", name: "Review A" });
const beta = await createPrivateTestAccount({ email: "review-b@lab.test", password: "review-b-pass-2755", name: "Review B" });
const user = getUserPrisma();
const createdAt = new Date("2026-11-23T01:00:00.000Z");
const due = new Date("2020-01-01T00:00:00.000Z");
const learnerA = { learnerId: "learner_review_a", authUserId: alpha.id, boundAt: createdAt };
const learnerB = { learnerId: "learner_review_b", authUserId: beta.id, boundAt: createdAt };

async function seedLearner(id: string, authUserId: string) {
  await user.learner.create({ data: { id, authUserId, boundAt: createdAt, createdAt } });
  await user.dailyLesson.create({
    data: {
      id: `lesson_${id}`, lessonDate: "2026-11-23", version: 1, active: true, theme: id, difficulty: "A2",
      newWordCount: 1, estimatedMinutes: 5, source: "runtime", poolNote: "", progress: "{}",
      listeningTitle: id, listeningText: "A review sentence.", listeningChunks: "[]", listeningGloss: "{}",
      createdAt, userId: id,
    },
  });
}
async function seedWord(id: string, learnerId: string, reps: number, stability: number, lemma = id) {
  await user.vocabulary.create({
    data: {
      id, lemma, pos: "noun", ipaNote: "", meaningZh: "测试", definitionEn: "runtime",
      collocation: "", example: "A shared lemma sentence.", exampleZh: "测试", difficulty: "A2", theme: learnerId,
      knownAlready: false, exampleFlagged: false, createdAt, lessonId: `lesson_${learnerId}`, userId: learnerId,
    },
  });
  await user.wordProgress.create({
    data: {
      id: `progress_${id}`, vocabularyId: id, due, stability, difficulty: 5, elapsedDays: 0, scheduledDays: 1,
      learningSteps: 0, reps, lapses: 0, state: 1, firstLearnedAt: createdAt, correctCount: 0, incorrectCount: 0,
      familiarity: "new", recallAbility: "again", userId: learnerId,
    },
  });
}
await seedLearner(learnerA.learnerId, alpha.id);
await seedLearner(learnerB.learnerId, beta.id);
for (const id of ["same_request", "same_snapshot", "mixed", "practice", "rollback", "busy", "changed", "network", "plain", "burst"]) {
  await seedWord(`vocab_${id}`, learnerA.learnerId, 2, 1.5);
}
await seedWord("vocab_mirror", learnerA.learnerId, 2, 1.5, "shared-lemma");
await seedWord("vocab_mirror_b", learnerA.learnerId, 2, 1.5, "shared-lemma");
await seedWord("vocab_other_sense", learnerA.learnerId, 2, 1.5, "shared-lemma");
await user.vocabulary.update({ where: { id: "vocab_other_sense" }, data: { meaningZh: "其他义项" } });
await seedWord("vocab_conflicting_history", learnerA.learnerId, 7, 9, "shared-lemma");
await seedWord("vocab_b", learnerB.learnerId, 5, 4.5, "shared-lemma");

function versionOf(row: { due: Date; reps: number; lapses: number; state: number; lastReview: Date | null; correctCount: number; incorrectCount: number }) {
  return { due: row.due, reps: row.reps, lapses: row.lapses, state: row.state, lastReview: row.lastReview, correctCount: row.correctCount, incorrectCount: row.incorrectCount };
}
async function progress(id: string) {
  return user.wordProgress.findFirstOrThrow({ where: { vocabularyId: id, userId: learnerA.learnerId } });
}
function fsrsSame(row: { due: Date; stability: number; difficulty: number; reps: number; lapses: number }, expected: { due: Date; stability: number; difficulty: number; reps: number; lapses: number }) {
  return Math.abs(row.due.getTime() - expected.due.getTime()) < 5000
    && row.stability === expected.stability
    && row.difficulty === expected.difficulty
    && row.reps === expected.reps
    && row.lapses === expected.lapses;
}

const sameRequestBefore = await progress("vocab_same_request");
const sameRequestExpected = schedule(sameRequestBefore, "good");
const sameRequestResults = await Promise.all(Array.from({ length: 8 }, () =>
  rateOwnWord(learnerA, "vocab_same_request", "good", "recall", "same-request-1844", versionOf(sameRequestBefore)).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )));
const sameRequestRow = await progress("vocab_same_request");
const sameRequestEvents = await user.reviewEvent.count({ where: { userId: learnerA.learnerId, clientRequestId: "same-request-1844" } });
const sameRequestEvent = await user.reviewEvent.findFirstOrThrow({ where: { userId: learnerA.learnerId, clientRequestId: "same-request-1844" } });
let reused: unknown = null;
try {
  await rateOwnWord(learnerA, "vocab_same_request", "again", "recall", "same-request-1844", versionOf(sameRequestRow));
} catch (error) {
  reused = error;
}
check(
  "[并发] 同一请求号只有一次正式计分",
  sameRequestResults.filter((item) => item.ok).length === 8
    && sameRequestEvents === 1
    && sameRequestEvent.rating === "good"
    && fsrsSame(sameRequestRow, sameRequestExpected)
    && sameRequestRow.due.getTime() === sameRequestEvent.dueAfter.getTime()
    && sameRequestResults.every((item) => item.ok && item.value.due.getTime() === sameRequestEvent.dueAfter.getTime())
    && reused instanceof AppError && reused.code === "REQUEST_REUSED"
    && await user.reviewEvent.count({ where: { userId: learnerA.learnerId, clientRequestId: "same-request-1844" } }) === 1,
);

const snapshotBefore = await progress("vocab_same_snapshot");
const snapshotResults = await Promise.all(["good", "good"].map((rating, index) =>
  rateOwnWord(learnerA, "vocab_same_snapshot", rating as "good", "recall", `snapshot-${index}-1844`, versionOf(snapshotBefore)).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )));
const snapshotEvents = await user.reviewEvent.count({ where: { vocabularyId: "vocab_same_snapshot", mode: "formal" } });
const snapshotRow = await progress("vocab_same_snapshot");
check(
  "[并发] 相同旧快照只有一次写入",
  snapshotResults.filter((item) => item.ok).length === 1
    && snapshotResults.filter((item) => !item.ok && item.error instanceof AppError && item.error.code === "STALE_PROGRESS").length === 1
    && snapshotEvents === 1
    && fsrsSame(snapshotRow, schedule(snapshotBefore, "good")),
);

const mixedBefore = await progress("vocab_mixed");
const mixedResults = await Promise.all((["again", "good", "easy"] as const).map((rating) =>
  rateOwnWord(learnerA, "vocab_mixed", rating, "recall", `mixed-${rating}-1844`, versionOf(mixedBefore)).then(
    (value) => ({ ok: true as const, rating, value }),
    (error: unknown) => ({ ok: false as const, rating, error }),
  )));
const mixedWins = mixedResults.filter((item) => item.ok);
const mixedEvent = await user.reviewEvent.findFirstOrThrow({ where: { vocabularyId: "vocab_mixed", mode: "formal" } });
const mixedRow = await progress("vocab_mixed");
check(
  "[并发] 不同评分同时提交只保留一次",
  mixedWins.length === 1
    && mixedResults.filter((item) => !item.ok && item.error instanceof AppError && item.error.code === "STALE_PROGRESS").length === 2
    && await user.reviewEvent.count({ where: { vocabularyId: "vocab_mixed", mode: "formal" } }) === 1
    && mixedEvent.rating === mixedWins[0]?.rating
    && fsrsSame(mixedRow, schedule(mixedBefore, mixedWins[0]!.rating)),
);

const bBefore = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_b" } });
const ownA = await progress("vocab_plain");
const [aRated, bRated] = await Promise.all([
  rateOwnWord(learnerA, "vocab_plain", "good", "recall", "cross-user-1844", versionOf(ownA)),
  rateOwnWord(learnerB, "vocab_b", "hard", "recall", "cross-user-1844", versionOf(bBefore)),
]);
const bAfter = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_b" } });
const aAfter = await progress("vocab_plain");
check(
  "[并发] A 和 B 用同一个请求号各自计分",
  aRated.replayed === false && bRated.replayed === false
    && await user.reviewEvent.count({ where: { clientRequestId: "cross-user-1844" } }) === 2
    && fsrsSame(aAfter, schedule(ownA, "good"))
    && fsrsSame(bAfter, schedule(bBefore, "hard"))
    && aRated.due.getTime() !== bRated.due.getTime()
);
const burstBefore = await progress("vocab_burst");
const burst = await Promise.all(Array.from({ length: 12 }, (_, index) =>
  rateOwnWord(learnerA, "vocab_burst", "easy", "recall", `burst-${index}-1844`, versionOf(burstBefore)).then(
    () => "ok" as const,
    (error: unknown) => error instanceof AppError ? error.code : "other",
  )));
const bDuringBurst = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_b" } });
check(
  "[并发] A 的大量请求不会改到 B",
  burst.filter((item) => item === "ok").length === 1
    && burst.filter((item) => item === "STALE_PROGRESS").length === 11
    && await user.reviewEvent.count({ where: { vocabularyId: "vocab_burst", mode: "formal" } }) === 1
    && bDuringBurst.reps === bAfter.reps && bDuringBurst.stability === bAfter.stability && bDuringBurst.due.getTime() === bAfter.due.getTime(),
);
const replayA = await rateOwnWord(learnerA, "vocab_plain", "good", "recall", "cross-user-1844", versionOf(ownA));
check("[并发] 重复请求不返回另一个用户的复习时间", replayA.replayed === true && replayA.due.getTime() === aRated.due.getTime() && replayA.due.getTime() !== bRated.due.getTime());

const senseBefore = await progress("vocab_other_sense");
const conflictBefore = await progress("vocab_conflicting_history");
const mirrorBefore = await progress("vocab_mirror");
await rateOwnWord(learnerA, "vocab_mirror", "good", "recall", "mirror-user-a-1844", versionOf(mirrorBefore));
const mirrorAfter = await progress("vocab_mirror");
const sibling = await progress("vocab_mirror_b");
check("[复习] 不同义项和有冲突的历史排程保持独立",
  fsrsSame(await progress("vocab_other_sense"), senseBefore)
  && fsrsSame(await progress("vocab_conflicting_history"), conflictBefore));

const bMirror = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_b" } });
check(
  "[并发] 同形词镜像只更新当前用户",
  sibling.reps === mirrorAfter.reps && sibling.stability === mirrorAfter.stability && sibling.due.getTime() === mirrorAfter.due.getTime()
    && bMirror.reps === bAfter.reps && bMirror.stability === bAfter.stability,
);

const practiceBefore = await progress("vocab_practice");
const practicePair = await Promise.all([
  rateOwnWord(learnerA, "vocab_practice", "good", "recall", "formal-practice-1844", versionOf(practiceBefore)),
  practiceOwnWord(learnerA, "vocab_practice", "again", "practice-formal-1844"),
]);
const practiceRow = await progress("vocab_practice");
const practiceEvents = await user.reviewEvent.findMany({ where: { vocabularyId: "vocab_practice" } });
check(
  "[并发] 提前练习不改变正式排程",
  practicePair[1].changedSchedule === false
    && practiceEvents.filter((item) => item.mode === "formal").length === 1
    && practiceEvents.filter((item) => item.mode === "practice" && item.changedSchedule === false).length === 1
    && fsrsSame(practiceRow, schedule(practiceBefore, "good")),
);

resetLearnerReviewProbe();
let injected = 0;
setLearnerReviewFaults({
  before: () => {
    injected += 1;
    if (injected === 1) throw new Error("SQLITE_BUSY: database is locked");
  },
});
const busyBefore = await progress("vocab_busy");
const busyResult = await rateOwnWord(learnerA, "vocab_busy", "good", "recall", "busy-retry-1844", versionOf(busyBefore));
const busyRow = await progress("vocab_busy");
check(
  "[模拟故障] 锁错误会重试并只计分一次",
  injected === 2 && learnerReviewStarts() === 2 && busyResult.replayed === false
    && await user.reviewEvent.count({ where: { clientRequestId: "busy-retry-1844" } }) === 1
    && fsrsSame(busyRow, schedule(busyBefore, "good")),
);
resetLearnerReviewProbe();
setLearnerReviewFaults({ before: () => { throw new Error("database is locked"); } });
const exhaustedBefore = await user.reviewEvent.count({ where: { vocabularyId: "vocab_busy" } });
let exhausted: unknown = null;
try {
  await rateOwnWord(learnerA, "vocab_busy", "easy", "recall", "busy-exhausted-1844", versionOf(await progress("vocab_busy")));
} catch (error) {
  exhausted = error;
}
const exhaustedText = exhausted instanceof Error ? exhausted.message : "";
check(
  "[模拟故障] 重试耗尽返回 REVIEW_BUSY 且不写入",
  learnerReviewStarts() === 3 && exhausted instanceof AppError && exhausted.code === "REVIEW_BUSY"
    && !exhaustedText.includes("SQLITE") && !exhaustedText.includes("database is locked")
    && await user.reviewEvent.count({ where: { vocabularyId: "vocab_busy" } }) === exhaustedBefore,
);

resetLearnerReviewProbe();
const changedBefore = await progress("vocab_changed");
let changedOnce = false;
setLearnerReviewFaults({
  before: () => {
    if (changedOnce) return;
    changedOnce = true;
    throw new Error("database is locked");
  },
  between: () => {
    const side = new DatabaseSync(runtimeFile);
    side.prepare("UPDATE WordProgress SET reps = 99 WHERE vocabularyId = 'vocab_changed'").run();
    side.close();
  },
});
let changedError: unknown = null;
try {
  await rateOwnWord(learnerA, "vocab_changed", "good", "recall", "changed-during-retry", versionOf(changedBefore));
} catch (error) {
  changedError = error;
}
const changedRow = await progress("vocab_changed");
check(
  "[模拟故障] 重试时发现进度已变化就拒绝旧快照",
  changedError instanceof AppError && changedError.code === "STALE_PROGRESS"
    && changedRow.reps === 99
    && await user.reviewEvent.count({ where: { clientRequestId: "changed-during-retry" } }) === 0,
);

resetLearnerReviewProbe();
const rollbackBefore = await progress("vocab_rollback");
const rollbackEvents = await user.reviewEvent.count({ where: { vocabularyId: "vocab_rollback" } });
setLearnerReviewFaults({ after: () => { throw new Error("forced-review-failure"); } });
let rollbackError: unknown = null;
try {
  await rateOwnWord(learnerA, "vocab_rollback", "good", "recall", "rollback-review-1844", versionOf(rollbackBefore));
} catch (error) {
  rollbackError = error;
}
const rollbackAfter = await progress("vocab_rollback");
check(
  "[模拟故障] 非锁错误不重试，事务回滚",
  learnerReviewStarts() === 1 && rollbackError instanceof Error && rollbackError.message.includes("forced-review-failure")
    && fsrsSame(rollbackAfter, rollbackBefore) && await user.reviewEvent.count({ where: { vocabularyId: "vocab_rollback" } }) === rollbackEvents,
);
resetLearnerReviewProbe();

const holder = new DatabaseSync(runtimeFile);
holder.exec("BEGIN IMMEDIATE");
const lockBefore = await progress("vocab_network");
const lockPromise = rateOwnWord(learnerA, "vocab_network", "good", "recall", "real-lock-1844", versionOf(lockBefore)).then(
  (value) => ({ ok: true as const, value }),
  (error: unknown) => ({ ok: false as const, error }),
);
await new Promise((resolve) => setTimeout(resolve, 250));
holder.exec("ROLLBACK");
holder.close();
const lockResult = await lockPromise;
const lockEvents = await user.reviewEvent.count({ where: { clientRequestId: "real-lock-1844" } });
const lockRow = await progress("vocab_network");
const lockConsistent = lockResult.ok
  ? lockEvents === 1 && fsrsSame(lockRow, schedule(lockBefore, "good"))
  : lockEvents === 0 && fsrsSame(lockRow, lockBefore) && lockResult.error instanceof AppError && lockResult.error.code === "REVIEW_BUSY";
console.log(`真实写锁：${lockResult.ok ? "等待后成功，没有抛出锁错误" : "返回 REVIEW_BUSY"}`);
check("[并发] 真实写锁期间没有重复计分", lockConsistent);

const runtime = createUserRuntimeApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = runtime.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const origin = { Origin: "http://127.0.0.1:8797" };
async function signIn(email: string, password: string) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email, password }),
  });
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
}
async function rateHttp(cookie: string, vocabId: string, body: unknown) {
  const response = await fetch(`${base}/api/review/${vocabId}/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, ...origin },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) as { code?: string; replayed?: boolean; due?: string } : {} };
}
try {
  const fresh = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_same_request" } });
  const payload = { rating: "good", clientRequestId: "same-request-1844", progress: versionOf(fresh), userId: learnerB.learnerId };
  const cookie = await signIn("review-a@lab.test", "review-a-pass-1844");
  const betaCookie = await signIn("review-b@lab.test", "review-b-pass-2755");
  const first = await rateHttp(cookie, "vocab_same_request", payload);
  const second = await rateHttp(cookie, "vocab_same_request", payload);
  const events = await user.reviewEvent.count({ where: { userId: learnerA.learnerId, clientRequestId: "same-request-1844" } });
  check("[HTTP] 网络重试返回原结果且不新增复习事件", first.status === 200 && second.status === 200 && second.body.replayed === true && second.body.due === first.body.due && events === 1 && !second.text.includes(learnerB.learnerId));
  const anonymous = await rateHttp("", "vocab_plain", payload);
  const forged = await rateHttp(cookie, "vocab_b", { ...payload, clientRequestId: "forged-rate-1844", progress: versionOf(bAfter) });
  const badId = await rateHttp(cookie, "vocab_plain", { rating: "good", clientRequestId: "short", progress: versionOf(await progress("vocab_plain")) });
  const missing = await rateHttp(cookie, "vocab_plain", { rating: "good", clientRequestId: "missing-progress-1844" });
  const bRow = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_b" } });
  check("[HTTP] 缺少或伪造身份、错误请求都不能评分", anonymous.status === 401 && forged.status === 404 && badId.status === 400 && missing.status === 400 && bRow.reps === bAfter.reps && bRow.stability === bAfter.stability);
  const wrongUser = await rateHttp(betaCookie, "vocab_plain", payload);
  check("[HTTP] B 不能用 A 的词评分", wrongUser.status === 404 && (await progress("vocab_plain")).reps === aAfter.reps);
} finally {
  resetLearnerReviewProbe();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectUserPrisma();
  await disconnectAuthPrisma();
}

check("[数据库] 原始 FSRS 没有被改写", (() => {
  const db = new DatabaseSync(runtimeFile, { readOnly: true });
  try {
    return JSON.stringify(db.prepare("SELECT id, due, stability, difficulty, reps, lapses, state FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId)) === originalFsrs;
  } finally {
    db.close();
  }
})());
check("[数据库] lab.db 和 auth.db 没有变化", JSON.stringify(labBefore) === JSON.stringify(databaseStamp(labDatabasePath)) && JSON.stringify(labCountsBefore) === JSON.stringify(counts(labDatabasePath)) && JSON.stringify(authBefore) === JSON.stringify(databaseStamp(authDatabasePath)));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("user review ok");
