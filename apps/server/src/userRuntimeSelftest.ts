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
  originalAuthUserId,
  originalLearnerId,
} from "../scripts/sqlite/assign-learner-ownership.mjs";

const runtimeFile = path.join(repoRoot, "data", "user-runtime.db");
const authRuntimeFile = path.join(repoRoot, "data", "auth-runtime.db");
const secret = "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2";
const passwordA = "runtime-a-pass-1844";
const passwordB = "runtime-b-pass-2755";
const passwordC = "runtime-c-pass-3066";
const passwordD = "runtime-d-pass-4177";
const passwordProbe = "runtime-probe-pass-5288";
const sharedRequest = "runtime-shared-request-1844";

process.env.DATABASE_URL = `file:${path.join(repoRoot, "data", "selftest.db").replace(/\\/g, "/")}`;
process.env.USER_DATABASE_URL = `file:${runtimeFile.replace(/\\/g, "/")}`;
process.env.AUTH_DATABASE_URL = `file:${authRuntimeFile.replace(/\\/g, "/")}`;
process.env.USER_RUNTIME = "1";
process.env.BETTER_AUTH_SECRET = secret;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8797";
process.env.BETTER_AUTH_TRUSTED_ORIGINS = "http://127.0.0.1:8797,http://localhost:8797";
process.env.AUTH_SELFTEST = "1";
process.env.LLM_API_KEY = "";
process.env.TTS_API_KEY = "";

const { AppError } = await import("./errors.ts");
const { resolveAuthDatabaseUrl, resolveRuntimeAuthDatabaseUrl, disconnectAuthPrisma } = await import("./authDatabase.ts");
const { assertUserRuntimeEnabled, disconnectUserPrisma, resolveUserDatabaseUrl } = await import("./userDatabase.ts");
const { bindUnboundLearner, resolveLearnerFromHeaders, resolveLearnerFromSession, resolveRequestLearner } = await import("./learnerIdentity.ts");
const { createPrivateTestAccount } = await import("./auth.ts");
const { createApp } = await import("./app.ts");
const {
  getAttempt,
  getLesson,
  getProgress,
  listAttempts,
  listLessons,
  listProgress,
  listReviews,
  listSessions,
  listUsage,
  listVocabulary,
  recordReview,
  updateOwnProgressReps,
} = await import("./learnerScope.ts");
const { createUserRuntimeApp } = await import("./userRuntimeApp.ts");
const { getUserPrisma } = await import("./userDatabase.ts");

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
}

function fileUrl(file: string) {
  return `file:${file.replace(/\\/g, "/")}`;
}

function removeDatabase(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target);
  }
}

function readOnlyCounts(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const progress = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(reps), 0) AS reps FROM WordProgress").get() as { n: number; reps: number };
    return {
      lessons: Number(db.prepare("SELECT COUNT(*) AS n FROM DailyLesson").get().n),
      words: Number(db.prepare("SELECT COUNT(*) AS n FROM Vocabulary").get().n),
      progress: Number(progress.n),
      reps: Number(progress.reps),
      reviews: Number(db.prepare("SELECT COUNT(*) AS n FROM ReviewEvent").get().n),
    };
  } finally {
    db.close();
  }
}

function authUserCount(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'").get();
    if (!table) return null;
    return Number(db.prepare("SELECT COUNT(*) AS n FROM user").get().n);
  } finally {
    db.close();
  }
}

function openRuntime(file: string) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function rows(db: DatabaseSync, sql: string, arg: string) {
  return db.prepare(sql).all(arg);
}

const labBefore = databaseStamp(labDatabasePath);
const authBefore = databaseStamp(authDatabasePath);
const labCountsBefore = readOnlyCounts(labDatabasePath);
const authUsersBefore = authUserCount(authDatabasePath);

let missingUser = false;
try {
  resolveUserDatabaseUrl({});
} catch {
  missingUser = true;
}
check("[数据库] 缺少业务库配置不会连接真实学习库", missingUser);
let labRejected = false;
try {
  resolveUserDatabaseUrl({ USER_DATABASE_URL: fileUrl(labDatabasePath) });
} catch {
  labRejected = true;
}
check("[数据库] 业务访问拒绝 lab.db", labRejected);
let missingAuth = false;
try {
  resolveRuntimeAuthDatabaseUrl({});
} catch {
  missingAuth = true;
}
check("[数据库] 缺少运行时认证配置不会回退到 auth.db", missingAuth);
let authRejected = false;
try {
  resolveRuntimeAuthDatabaseUrl({ AUTH_DATABASE_URL: fileUrl(authDatabasePath) });
} catch {
  authRejected = true;
}
check("[数据库] 运行时认证拒绝 auth.db", authRejected);
check("[数据库] 现有认证入口仍可回退到 auth.db", resolveAuthDatabaseUrl({}).endsWith("auth.db"));
const savedRuntime = process.env.USER_RUNTIME;
delete process.env.USER_RUNTIME;
let runtimeBlocked = false;
try {
  assertUserRuntimeEnabled();
} catch {
  runtimeBlocked = true;
}
process.env.USER_RUNTIME = savedRuntime;
check("[数据库] 未显式开启时不能启动多用户运行时", runtimeBlocked);

removeDatabase(runtimeFile);
removeDatabase(authRuntimeFile);
await backupLabReadonly(runtimeFile);
const migrated = openRuntime(runtimeFile);
assignLearnerOwnership(migrated);
const originalProgress = JSON.stringify(rows(migrated, "SELECT id, due, stability, difficulty, state, reps, lapses, lastReview FROM WordProgress WHERE userId = ? ORDER BY id", originalLearnerId));
const originalLessons = JSON.stringify(rows(migrated, "SELECT id, lessonDate, version FROM DailyLesson WHERE userId = ? ORDER BY id", originalLearnerId));
const originalLearner = migrated.prepare("SELECT authUserId, boundAt FROM Learner WHERE id = ?").get(originalLearnerId) as { authUserId: string; boundAt: number | null };
check("[数据库] 历史学习者保持未绑定", originalLearner.authUserId === originalAuthUserId && originalLearner.boundAt === null);

migrated.exec("BEGIN");
try {
  const now = Date.now();
  migrated.prepare("INSERT INTO Learner (id, authUserId, boundAt, createdAt) VALUES ('learner_db_a', 'db-only-a', ?, ?)").run(now, now);
  migrated.prepare("INSERT INTO Learner (id, authUserId, boundAt, createdAt) VALUES ('learner_db_b', 'db-only-b', ?, ?)").run(now, now);
  migrated.prepare(`
    INSERT INTO ReviewEvent (id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt, userId)
    VALUES ('review_db_a', 'vocab_db_a', 'db-shared-request', 'formal', 'good', 1, 2, 0, 3, 'learner_db_a')
  `).run();
  migrated.prepare(`
    INSERT INTO ReviewEvent (id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt, userId)
    VALUES ('review_db_b', 'vocab_db_b', 'db-shared-request', 'formal', 'hard', 1, 2, 0, 4, 'learner_db_b')
  `).run();
  const shared = Number(migrated.prepare("SELECT COUNT(*) AS n FROM ReviewEvent WHERE clientRequestId = 'db-shared-request'").get().n);
  let duplicateRejected = false;
  try {
    migrated.prepare(`
      INSERT INTO ReviewEvent (id, vocabularyId, clientRequestId, mode, rating, dueBefore, dueAfter, changedSchedule, createdAt, userId)
      VALUES ('review_db_a_repeat', 'vocab_db_a', 'db-shared-request', 'formal', 'again', 1, 2, 0, 5, 'learner_db_a')
    `).run();
  } catch {
    duplicateRejected = true;
  }
  const question = migrated.prepare("SELECT id FROM QuizQuestion WHERE userId = ? LIMIT 1").get(originalLearnerId) as { id: string } | undefined;
  let crossRejected = false;
  try {
    migrated.prepare("INSERT INTO QuizAttempt (id, questionId, selected, correct, createdAt, userId) VALUES ('attempt_db_b', ?, 0, 0, 1, 'learner_db_b')").run(question?.id || "missing");
  } catch {
    crossRejected = true;
  }
  check("[数据库] 同一请求号可以分属两个用户", shared === 2 && duplicateRejected);
  check("[数据库] 跨用户答题被拒绝", crossRejected);
} finally {
  migrated.exec("ROLLBACK");
}
const sharedLeft = Number(migrated.prepare("SELECT COUNT(*) AS n FROM ReviewEvent WHERE clientRequestId = 'db-shared-request'").get().n);
const tempLeft = migrated.prepare("SELECT id FROM Learner WHERE id = 'learner_db_a'").get();
check("[数据库] 演练事务回滚后不留临时用户", sharedLeft === 0 && !tempLeft);
migrated.close();

execSync("node scripts/auth/push.mjs", {
  cwd: path.join(repoRoot, "apps/server"),
  env: process.env,
  stdio: "inherit",
});

const alpha = await createPrivateTestAccount({ email: "runtime-a@lab.test", password: passwordA, name: "Runtime A" });
const beta = await createPrivateTestAccount({ email: "runtime-b@lab.test", password: passwordB, name: "Runtime B" });
const guest = await createPrivateTestAccount({ email: "runtime-c@lab.test", password: passwordC, name: "Runtime C" });
const broken = await createPrivateTestAccount({ email: "runtime-d@lab.test", password: passwordD, name: "Runtime D" });
const probe = await createPrivateTestAccount({ email: "runtime-probe@lab.test", password: passwordProbe, name: "Runtime Probe" });

const user = getUserPrisma();
const createdAt = new Date("2026-11-23T01:00:00.000Z");
const due = new Date("2026-12-01T00:00:00.000Z");

async function seedLearner(input: { id: string; authUserId: string; boundAt: Date | null; reps: number; stability: number; minutes: number }) {
  await user.learner.create({
    data: { id: input.id, authUserId: input.authUserId, boundAt: input.boundAt, createdAt },
  });
  if (!input.boundAt) return;
  const lessonId = `lesson_${input.id}`;
  const vocabId = `vocab_${input.id}`;
  const questionId = `question_${input.id}`;
  await user.dailyLesson.create({
    data: {
      id: lessonId,
      lessonDate: "2026-11-23",
      version: 1,
      active: true,
      theme: input.id,
      difficulty: "A2",
      newWordCount: 1,
      estimatedMinutes: 5,
      source: "runtime",
      poolNote: "",
      progress: "{}",
      listeningTitle: input.id,
      listeningText: "A short runtime sentence.",
      listeningChunks: "[]",
      listeningGloss: "[]",
      createdAt,
      userId: input.id,
    },
  });
  await user.vocabulary.create({
    data: {
      id: vocabId,
      lemma: input.id,
      pos: "noun",
      ipaNote: "",
      meaningZh: "测试",
      definitionEn: "runtime",
      collocation: "",
      example: "A short runtime sentence.",
      exampleZh: "一句测试。",
      difficulty: "A2",
      theme: input.id,
      knownAlready: false,
      exampleFlagged: false,
      createdAt,
      lessonId,
      userId: input.id,
    },
  });
  await user.wordProgress.create({
    data: {
      id: `progress_${input.id}`,
      vocabularyId: vocabId,
      due,
      stability: input.stability,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reps: input.reps,
      lapses: 0,
      state: 1,
      firstLearnedAt: createdAt,
      correctCount: 0,
      incorrectCount: 0,
      familiarity: "new",
      recallAbility: "again",
      userId: input.id,
    },
  });
  await user.quizQuestion.create({
    data: {
      id: questionId,
      lessonId,
      sortOrder: 1,
      kind: "meaning",
      prompt: input.id,
      options: "[]",
      answerIndex: 0,
      explanationEn: "runtime",
      explanationZh: "测试",
      simplerZh: "测试",
      evidence: "runtime",
      whyWrong: "[]",
      userId: input.id,
    },
  });
  await user.quizAttempt.create({
    data: { id: `attempt_${input.id}`, questionId, selected: 0, correct: true, createdAt, userId: input.id },
  });
  await user.studySession.create({
    data: { id: `session_${input.id}`, lessonId, module: "lesson", minutes: input.minutes, createdAt, userId: input.id },
  });
  await user.aIUsageRecord.create({
    data: { id: `usage_${input.id}`, kind: "runtime", model: "none", promptTokens: 0, completionTokens: 0, success: true, createdAt, userId: input.id },
  });
}

await seedLearner({ id: "learner_runtime_a", authUserId: alpha.id, boundAt: createdAt, reps: 2, stability: 1.5, minutes: 5 });
await seedLearner({ id: "learner_runtime_b", authUserId: beta.id, boundAt: createdAt, reps: 7, stability: 4.5, minutes: 8 });
await seedLearner({ id: "learner_runtime_d", authUserId: broken.id, boundAt: null, reps: 0, stability: 1, minutes: 0 });

let unboundTargetRejected = false;
try {
  await bindUnboundLearner(user, { learnerId: originalLearnerId, authUserId: "unbound:original-lab" });
} catch (error) {
  unboundTargetRejected = error instanceof AppError && error.code === "LEARNER_BINDING_INVALID";
}
let missingUserRejected = false;
try {
  await bindUnboundLearner(user, { learnerId: originalLearnerId, authUserId: "missing-auth-user" });
} catch (error) {
  missingUserRejected = error instanceof AppError && error.code === "LEARNER_BINDING_INVALID";
}
let bindRolledBack = false;
try {
  await user.$transaction(async (tx) => {
    await bindUnboundLearner(tx, { learnerId: originalLearnerId, authUserId: probe.id });
    bindRolledBack = true;
    throw new Error("rollback-original-bind");
  });
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("rollback-original-bind")) throw error;
}
await user.learner.create({
  data: { id: "learner_bind_probe", authUserId: "unbound:probe", boundAt: null, createdAt },
});
const boundProbe = await bindUnboundLearner(user, { learnerId: "learner_bind_probe", authUserId: probe.id });
const originalAfterBind = await user.learner.findUniqueOrThrow({ where: { id: originalLearnerId } });
check("[服务] 拒绝把未绑定标记当作认证账号", unboundTargetRejected);
check("[服务] 认证用户不存在时不会绑定", missingUserRejected);
check("[服务] 原始学习者的绑定演练已回滚", bindRolledBack && originalAfterBind.authUserId === originalAuthUserId && originalAfterBind.boundAt === null);
check("[服务] 显式绑定只改变指定的演练学习者", boundProbe.authUserId === probe.id && boundProbe.boundAt !== null);

const learnerA = { learnerId: "learner_runtime_a", authUserId: alpha.id, boundAt: createdAt };
const learnerB = { learnerId: "learner_runtime_b", authUserId: beta.id, boundAt: createdAt };
const resolvedA = await resolveLearnerFromSession({ user: { id: alpha.id } });
const resolvedB = await resolveLearnerFromSession({ user: { id: beta.id } });
const resolvedGuest = await resolveLearnerFromSession({ user: { id: guest.id } });
const resolvedBroken = await resolveLearnerFromSession({ user: { id: broken.id } });
const resolvedMissing = await resolveLearnerFromSession(null);
check("[服务] A 只解析到 A", resolvedA.ok && resolvedA.learner.learnerId === "learner_runtime_a" && resolvedA.learner.authUserId === alpha.id);
check("[服务] B 只解析到 B", resolvedB.ok && resolvedB.learner.learnerId === "learner_runtime_b" && resolvedB.learner.authUserId === beta.id);
check("[服务] 未登录返回 401", !resolvedMissing.ok && resolvedMissing.status === 401);
check("[服务] 已登录但未绑定会被拒绝", !resolvedGuest.ok && resolvedGuest.status === 403 && resolvedGuest.code === "LEARNER_UNBOUND");
check("[服务] 异常绑定会被拒绝", !resolvedBroken.ok && resolvedBroken.status === 409 && resolvedBroken.code === "LEARNER_BINDING_INVALID");

const lessonsA = await listLessons(learnerA);
const lessonB = await getLesson(learnerA, "lesson_learner_runtime_b");
const progressA = await getProgress(learnerB, "vocab_learner_runtime_a");
check("[服务] A 的课程列表不含 B", lessonsA.length === 1 && lessonsA[0]?.id === "lesson_learner_runtime_a" && lessonsA.every((item) => item.userId === "learner_runtime_a"));
check("[服务] A 读取 B 的课程得到空结果", lessonB === null);
check("[服务] B 读取 A 的词汇进度得到空结果", progressA === null);
const progressBeforeReview = await getProgress(learnerA, "vocab_learner_runtime_a");
const reviewA = await recordReview(learnerA, { vocabularyId: "vocab_learner_runtime_a", clientRequestId: sharedRequest, rating: "good" });
const reviewB = await recordReview(learnerB, { vocabularyId: "vocab_learner_runtime_b", clientRequestId: sharedRequest, rating: "hard" });
const reviewAgain = await recordReview(learnerA, { vocabularyId: "vocab_learner_runtime_a", clientRequestId: sharedRequest, rating: "again" });
const progressAfterReview = await getProgress(learnerA, "vocab_learner_runtime_a");
const progressBAfterReview = await getProgress(learnerB, "vocab_learner_runtime_b");
check("[服务] 两个用户可以使用同一个请求号", reviewA.ok && reviewB.ok);
check("[服务] 同一用户重复请求号被拒绝", !reviewAgain.ok && reviewAgain.code === "REQUEST_REUSED");
check(
  "[服务] 记录复习不会改写双方的 FSRS 进度",
  JSON.stringify(progressBeforeReview) === JSON.stringify(progressAfterReview) && progressBAfterReview?.reps === 7 && progressBAfterReview.stability === 4.5,
);
const updatedA = await updateOwnProgressReps(learnerA, "vocab_learner_runtime_a", 3);
const stolen = await updateOwnProgressReps(learnerA, "vocab_learner_runtime_b", 9);
const progressBAfterWrite = await getProgress(learnerB, "vocab_learner_runtime_b");
check("[服务] A 只能修改自己的进度", updatedA.ok && updatedA.value.reps === 3 && updatedA.value.userId === "learner_runtime_a");
check("[服务] A 不能修改 B 的进度", !stolen.ok && stolen.status === 404 && progressBAfterWrite?.reps === 7 && progressBAfterWrite.stability === 4.5);
let transactionFailed = false;
try {
  await user.$transaction(async (tx) => {
    await tx.wordProgress.updateMany({ where: { vocabularyId: "vocab_learner_runtime_a", userId: "learner_runtime_a" }, data: { reps: 30 } });
    transactionFailed = true;
    throw new Error("runtime-transaction-fault");
  });
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("runtime-transaction-fault")) throw error;
}
const progressAfterFault = await getProgress(learnerA, "vocab_learner_runtime_a");
check("[服务] 事务失败会回滚演练进度", transactionFailed && progressAfterFault?.reps === 3);
const sessionsA = await listSessions(learnerA);
const usageA = await listUsage(learnerA);
const attemptsA = await listAttempts(learnerA);
const attemptB = await getAttempt(learnerA, "attempt_learner_runtime_b");
check("[服务] 学习记录、用量和答题都限制在当前用户", sessionsA.length === 1 && sessionsA[0]?.userId === "learner_runtime_a" && usageA.length === 1 && usageA[0]?.userId === "learner_runtime_a" && attemptsA.length === 1 && attemptB === null);
const wordsA = await listVocabulary(learnerA);
const reviewsA = await listReviews(learnerA);
check("[服务] 词汇和复习事件只返回当前用户", wordsA.every((item) => item.userId === "learner_runtime_a") && reviewsA.every((item) => item.userId === "learner_runtime_a") && reviewsA.length === 1);

const appSource = fs.readFileSync(path.join(repoRoot, "apps/server/src/app.ts"), "utf8");
const indexSource = fs.readFileSync(path.join(repoRoot, "apps/server/src/index.ts"), "utf8");
const liveSchema = fs.readFileSync(path.join(repoRoot, "apps/server/prisma/schema.prisma"), "utf8");
const userSchema = fs.readFileSync(path.join(repoRoot, "apps/server/prisma-user/schema.prisma"), "utf8");
const authSchema = fs.readFileSync(path.join(repoRoot, "apps/server/prisma-auth/schema.prisma"), "utf8");
check("[HTTP] 现有应用没有挂载多用户路由", appSource.includes('app.get("/api/lessons"') && !appSource.includes("user-runtime") && !appSource.includes("getUserPrisma"));
check("[HTTP] 开发入口仍使用 8787 和单用户应用", indexSource.includes("createApp") && indexSource.includes("8787") && !indexSource.includes("userRuntime"));
check("[HTTP] 三份 Schema 的客户端输出互不覆盖", liveSchema.includes('provider = "prisma-client-js"') && !liveSchema.includes("generated/user") && userSchema.includes("../src/generated/user") && authSchema.includes("../src/generated/auth"));

const legacy = createApp();
const legacyServer = await new Promise<import("node:http").Server>((resolve) => {
  const started = legacy.listen(0, "127.0.0.1", () => resolve(started));
});
const runtime = createUserRuntimeApp();
const runtimeServer = await new Promise<import("node:http").Server>((resolve) => {
  const started = runtime.listen(0, "127.0.0.1", () => resolve(started));
});

function portOf(server: import("node:http").Server) {
  const address = server.address();
  return address && typeof address === "object" ? address.port : 0;
}
function hostOf(server: import("node:http").Server) {
  const address = server.address();
  return address && typeof address === "object" ? address.address : "";
}

const legacyBase = `http://127.0.0.1:${portOf(legacyServer)}`;
const base = `http://127.0.0.1:${portOf(runtimeServer)}`;
const origin = { Origin: "http://127.0.0.1:8797" };

function cookieFrom(response: Response) {
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
}

async function signIn(email: string, password: string) {
  return fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email, password }),
  });
}

async function api(pathname: string, cookie = "", init: RequestInit = {}) {
  return fetch(`${base}${pathname}`, {
    ...init,
    headers: { cookie, ...origin, ...(init.headers || {}) },
  });
}

try {
  check("[HTTP] 运行时只监听本机", hostOf(runtimeServer) === "127.0.0.1" && portOf(runtimeServer) !== 8787);
  const legacyHealth = await fetch(`${legacyBase}/api/health`);
  const legacyRuntime = await fetch(`${legacyBase}/api/user-runtime/lessons`);
  const legacyLessons = await fetch(`${legacyBase}/api/lessons`);
  check("[HTTP] 旧应用健康检查保持原样", legacyHealth.status === 200 && await legacyHealth.text() === "{\"ok\":true}");
  check("[HTTP] 旧应用没有多用户测试路由", legacyRuntime.status === 404);
  check("[HTTP] 旧业务路由仍可访问且不计入隔离通过", legacyLessons.status === 200);
  const runtimeHealth = await fetch(`${base}/api/user-runtime/health`);
  const runtimeHealthText = await runtimeHealth.text();
  check("[HTTP] 运行时健康检查不返回连接信息", runtimeHealth.status === 200 && runtimeHealthText === "{\"ok\":true}");
  const oldLessons = await fetch(`${base}/api/lessons`);
  check("[HTTP] 运行时的业务课程接口拒绝未登录", oldLessons.status === 401);

  const anonymous = await api("/api/user-runtime/lessons");
  const anonymousWrite = await api("/api/user-runtime/reviews", "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vocabularyId: "vocab_learner_runtime_a", clientRequestId: "anonymous", rating: "good", userId: "learner_runtime_b" }),
  });
  check("[HTTP] 未登录请求返回 401", anonymous.status === 401 && anonymousWrite.status === 401);

  const alphaSign = await signIn("runtime-a@lab.test", passwordA);
  const betaSign = await signIn("runtime-b@lab.test", passwordB);
  const guestSign = await signIn("runtime-c@lab.test", passwordC);
  const brokenSign = await signIn("runtime-d@lab.test", passwordD);
  const alphaCookie = cookieFrom(alphaSign);
  const betaCookie = cookieFrom(betaSign);
  const guestCookie = cookieFrom(guestSign);
  const brokenCookie = cookieFrom(brokenSign);
  check("[HTTP] 两个测试账号都能登录", alphaSign.status === 200 && betaSign.status === 200 && Boolean(alphaCookie) && Boolean(betaCookie));

  const forged = await resolveRequestLearner(new Headers({ cookie: alphaCookie }), "learner_runtime_b");
  check("[服务] 伪造 userId 不能切换已验证身份", forged.ok && forged.learner.learnerId === "learner_runtime_a" && forged.learner.authUserId === alpha.id);

  const whoA = await api("/api/user-runtime/learner?userId=learner_runtime_b", alphaCookie);
  const whoB = await api("/api/user-runtime/learner?userId=learner_runtime_a", betaCookie);
  const whoABody = await whoA.json() as { learnerId?: string; authUserId?: string };
  const whoBBody = await whoB.json() as { learnerId?: string; authUserId?: string };
  check("[HTTP] A 登录后只能解析到 A", whoA.status === 200 && whoABody.learnerId === "learner_runtime_a" && whoABody.authUserId === alpha.id);
  check("[HTTP] B 登录后只能解析到 B", whoB.status === 200 && whoBBody.learnerId === "learner_runtime_b" && whoBBody.authUserId === beta.id);
  const guestBody = await (await api("/api/user-runtime/lessons", guestCookie)).json() as { code?: string };
  const brokenBody = await (await api("/api/user-runtime/progress", brokenCookie)).json() as { code?: string };
  check("[HTTP] 已登录但未绑定学习者时拒绝访问", (await api("/api/user-runtime/lessons", guestCookie)).status === 403 && guestBody.code === "LEARNER_UNBOUND");
  check("[HTTP] 异常绑定拒绝访问", (await api("/api/user-runtime/progress", brokenCookie)).status === 409 && brokenBody.code === "LEARNER_BINDING_INVALID");

  const lessons = await api("/api/user-runtime/lessons?userId=learner_runtime_b", alphaCookie);
  const lessonList = await lessons.json() as Array<{ id: string; userId: string }>;
  const foreignLesson = await api("/api/user-runtime/lessons/lesson_learner_runtime_b", alphaCookie);
  const foreignLessonBody = await foreignLesson.json() as { code?: string };
  const foreignProgress = await api("/api/user-runtime/progress/vocab_learner_runtime_a", betaCookie);
  const foreignProgressBody = await foreignProgress.json() as { code?: string };
  check("[HTTP] A 无法读取 B 的课程", lessons.status === 200 && lessonList.length === 1 && lessonList[0]?.id === "lesson_learner_runtime_a" && foreignLesson.status === 404 && foreignLessonBody.code === "NOT_FOUND");
  check("[HTTP] B 无法读取 A 的词汇进度", foreignProgress.status === 404 && foreignProgressBody.code === "NOT_FOUND");
  const foreignAttempt = await api("/api/user-runtime/attempts/attempt_learner_runtime_b", alphaCookie);
  check("[HTTP] 跨用户资源访问返回 404", foreignAttempt.status === 404);

  const postA = await api("/api/user-runtime/reviews", alphaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vocabularyId: "vocab_learner_runtime_a", clientRequestId: "http-shared-request", rating: "good", userId: "learner_runtime_b" }),
  });
  const postB = await api("/api/user-runtime/reviews", betaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vocabularyId: "vocab_learner_runtime_b", clientRequestId: "http-shared-request", rating: "hard", userId: "learner_runtime_a" }),
  });
  const postRepeat = await api("/api/user-runtime/reviews", alphaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vocabularyId: "vocab_learner_runtime_a", clientRequestId: "http-shared-request", rating: "again" }),
  });
  const savedA = await postA.json() as { userId?: string };
  check("[HTTP] 同一个请求号在不同用户之间不冲突", postA.status === 201 && postB.status === 201 && savedA.userId === "learner_runtime_a" && postRepeat.status === 409);

  const writeA = await api("/api/user-runtime/progress/vocab_learner_runtime_a", alphaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reps: 4, userId: "learner_runtime_b" }),
  });
  const writeForeign = await api("/api/user-runtime/progress/vocab_learner_runtime_a", betaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reps: 9 }),
  });
  const readA = await (await api("/api/user-runtime/progress/vocab_learner_runtime_a", alphaCookie)).json() as { reps?: number; stability?: number; userId?: string };
  const readB = await (await api("/api/user-runtime/progress/vocab_learner_runtime_b", betaCookie)).json() as { reps?: number; stability?: number; userId?: string };
  check("[HTTP] 用户间 FSRS 历史互不影响", writeA.status === 200 && writeForeign.status === 404 && readA.reps === 4 && readA.stability === 1.5 && readA.userId === "learner_runtime_a" && readB.reps === 7 && readB.stability === 4.5);

  const usage = await (await api("/api/user-runtime/usage", alphaCookie)).json() as Array<{ userId: string }>;
  const session = await (await api("/api/user-runtime/sessions", betaCookie)).json() as Array<{ userId: string; minutes: number }>;
  check("[HTTP] 用量和学习记录按当前用户返回", usage.length === 1 && usage[0]?.userId === "learner_runtime_a" && session.length === 1 && session[0]?.userId === "learner_runtime_b" && session[0]?.minutes === 8);

  const liveHealth = await fetch("http://127.0.0.1:8787/api/health");
  const liveRuntime = await fetch("http://127.0.0.1:8787/api/user-runtime/lessons");
  check("[HTTP] 当前 8787 仍是原来的健康检查", liveHealth.status === 200 && await liveHealth.text() === "{\"ok\":true}");
  check("[HTTP] 当前 8787 没有多用户测试路由", liveRuntime.status === 404);
} finally {
  await new Promise<void>((resolve) => legacyServer.close(() => resolve()));
  await new Promise<void>((resolve) => runtimeServer.close(() => resolve()));
  await disconnectUserPrisma();
  await disconnectAuthPrisma();
}

const verify = new DatabaseSync(runtimeFile, { readOnly: true });
const progressNow = JSON.stringify(rows(verify, "SELECT id, due, stability, difficulty, state, reps, lapses, lastReview FROM WordProgress WHERE userId = ? ORDER BY id", originalLearnerId));
const lessonsNow = JSON.stringify(rows(verify, "SELECT id, lessonDate, version FROM DailyLesson WHERE userId = ? ORDER BY id", originalLearnerId));
const originalNow = verify.prepare("SELECT authUserId, boundAt FROM Learner WHERE id = ?").get(originalLearnerId) as { authUserId: string; boundAt: number | null };
const learnerTableInAuth = new DatabaseSync(authRuntimeFile, { readOnly: true });
const authHasLearner = learnerTableInAuth.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Learner'").get();
const userHasAuthTable = verify.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'").get();
const sharedHttp = Number(verify.prepare("SELECT COUNT(*) AS n FROM ReviewEvent WHERE clientRequestId = 'http-shared-request'").get().n);
learnerTableInAuth.close();
verify.close();
check("[数据库] 原始 FSRS 和学习日没有被运行时改写", progressNow === originalProgress && lessonsNow === originalLessons);
check("[数据库] 原始学习者没有被自动绑定", originalNow.authUserId === originalAuthUserId && originalNow.boundAt === null);
check("[数据库] 认证库和业务库没有互相写入对方的表", !authHasLearner && !userHasAuthTable && sharedHttp === 2);

const labAfter = databaseStamp(labDatabasePath);
const authAfter = databaseStamp(authDatabasePath);
const labCountsAfter = readOnlyCounts(labDatabasePath);
const authUsersAfter = authUserCount(authDatabasePath);
check("[数据库] lab.db 文件和计数没有变化", JSON.stringify(labBefore) === JSON.stringify(labAfter) && JSON.stringify(labCountsBefore) === JSON.stringify(labCountsAfter));
check("[数据库] auth.db 文件和账号数没有变化", JSON.stringify(authBefore) === JSON.stringify(authAfter) && authUsersBefore === authUsersAfter);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("user runtime ok");
