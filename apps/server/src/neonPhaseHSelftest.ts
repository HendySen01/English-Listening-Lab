import { PrismaClient as NeonUser } from "./generated/neon-user/index.js";
import { PrismaClient as NeonAuth } from "./generated/neon-auth/index.js";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import express from "express";
import { assertDevelopmentPair, readDotenv } from "../scripts/neon-dev/guard.mjs";
import { databaseStamp, labDatabasePath, authDatabasePath } from "../scripts/sqlite/assign-learner-ownership.mjs";
import { AppError } from "./errors.ts";
import { schedule } from "./srs.ts";
import { assertRealSpendAllowed } from "./learnerQuota.ts";
import { setStudyClock, studyDate } from "./studyTime.ts";

const envFile = readDotenv(new URL("../.env.neon.development", import.meta.url));
const identity = assertDevelopmentPair(envFile);
const businessSchema = "lab_phase_h";
const authSchema = "lab_phase_h_auth";

function phaseUrl(raw: string, schema: string, connectionLimit = "1") {
  if (schema !== businessSchema && schema !== authSchema) throw new Error("拒绝未授权的 PostgreSQL schema");
  const url = new URL(raw);
  url.searchParams.set("connect_timeout", "30");
  url.searchParams.set("connection_limit", connectionLimit);
  url.searchParams.set("pool_timeout", "20");
  url.searchParams.set("schema", schema);
  return url.toString();
}

const user = new NeonUser({ datasources: { db: { url: phaseUrl(envFile.DATABASE_URL, businessSchema, "4") } } });
const transactionOptions = { maxWait: 20000, timeout: 20000 };
const userDirect = new NeonUser({ datasources: { db: { url: phaseUrl(envFile.DIRECT_URL, businessSchema) } } });
const authDb = new NeonAuth({ datasources: { db: { url: phaseUrl(envFile.DATABASE_URL, authSchema) } } });

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(detail ? `${name} :: ${detail}` : name);
  else console.log(`通过 ${name}`);
}
function codeOf(error: unknown) {
  return error instanceof AppError ? error.code : "";
}

async function publicCounts() {
  const names = ["DailyLesson", "Vocabulary", "WordProgress", "ReviewEvent", "ExplanationCache", "AIUsageRecord"];
  const counts: Record<string, number> = {};
  for (const name of names) {
    const rows = await userDirect.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."${name}"`) as Array<{ n: number }>;
    counts[name] = rows[0].n;
  }
  const migrations = await userDirect.$queryRaw`SELECT migration_name FROM public."_prisma_migrations" ORDER BY migration_name` as Array<{ migration_name: string }>;
  const tables = await userDirect.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name` as Array<{ table_name: string }>;
  return { counts, migrations, tables: tables.map((row) => row.table_name) };
}

const beforePublic = await publicCounts();
const labBefore = databaseStamp(labDatabasePath);
const authBefore = databaseStamp(authDatabasePath);

await user.reviewEvent.deleteMany({});
await user.aiCharge.deleteMany({});
await user.quizAttempt.deleteMany({});
await user.studySession.deleteMany({});
await user.aIUsageRecord.deleteMany({});
await user.wordProgress.deleteMany({});
await user.quizQuestion.deleteMany({});
await user.vocabulary.deleteMany({});
await user.dailyLesson.deleteMany({});
await user.userSettings.deleteMany({});
await user.learner.deleteMany({});
await authDb.session.deleteMany({});
await authDb.account.deleteMany({});
await authDb.user.deleteMany({});

const createdAt = new Date("2026-05-01T00:00:00.000Z");
const due = new Date("2026-04-01T03:04:05.000Z");
async function seedLearner(id: string, authUserId: string, lemma: string) {
  await user.learner.create({ data: { id, authUserId, boundAt: createdAt, createdAt } });
  await user.userSettings.create({
    data: { id: `settings_${id}`, userId: id, dailyNewWords: id.endsWith("a") ? 8 : 6, difficulty: "A2", listeningLevel: "match", dailyMinutes: 60, theme: "Daily Life", customTheme: "", autoGenerate: true, ttsVoice: "en-US", speechRate: 1, locale: "zh-CN", colorMode: "system", wordPartsEnabled: true, recommendationsEnabled: true, updatedAt: createdAt },
  });
  await user.dailyLesson.create({
    data: {
      id: `lesson_${id}`, userId: id, lessonDate: "2026-11-23", version: 1, active: true, theme: "Daily Life", difficulty: "A2",
      newWordCount: 1, estimatedMinutes: 5, source: "phase-h", poolNote: "", progress: "{}", listeningTitle: id,
      listeningText: "A phase h sentence.", listeningChunks: "[]", listeningGloss: "{}", createdAt,
    },
  });
  await user.vocabulary.create({
    data: {
      id: `vocab_${id}`, userId: id, lemma, pos: "noun", ipaNote: "", meaningZh: "测试", definitionEn: "test", collocation: "",
      example: "A phase h sentence.", exampleZh: "测试", difficulty: "A2", theme: "Daily Life", knownAlready: false, exampleFlagged: false,
      createdAt, lessonId: `lesson_${id}`,
    },
  });
  await user.wordProgress.create({
    data: {
      id: `progress_${id}`, vocabularyId: `vocab_${id}`, userId: id, due, stability: 1.5, difficulty: 5, elapsedDays: 0, scheduledDays: 1,
      learningSteps: 0, reps: 2, lapses: 0, state: 1, firstLearnedAt: createdAt, correctCount: 0, incorrectCount: 0, familiarity: "new", recallAbility: "again",
    },
  });
  await user.quizQuestion.create({
    data: {
      id: `question_${id}`, lessonId: `lesson_${id}`, userId: id, sortOrder: 1, kind: "context", prompt: "Pick", options: "[\"a\",\"b\"]",
      answerIndex: 0, explanationEn: "a", explanationZh: "a", simplerZh: "更简单", evidence: "sentence", whyWrong: "[]",
    },
  });
}
await seedLearner("learner_phase_a", "auth_phase_a", "shared-lemma");
await seedLearner("learner_phase_b", "auth_phase_b", "shared-lemma");
await user.vocabulary.create({
  data: {
    id: "vocab_phase_a_mirror", userId: "learner_phase_a", lemma: "shared-lemma", pos: "noun", ipaNote: "", meaningZh: "测试", definitionEn: "test",
    collocation: "", example: "A phase h sentence.", exampleZh: "测试", difficulty: "A2", theme: "Daily Life", knownAlready: false, exampleFlagged: false,
    createdAt, lessonId: "lesson_learner_phase_a",
  },
});
await user.wordProgress.create({
  data: {
    id: "progress_phase_a_mirror", vocabularyId: "vocab_phase_a_mirror", userId: "learner_phase_a", due, stability: 1.5, difficulty: 5, elapsedDays: 0, scheduledDays: 1,
    learningSteps: 0, reps: 2, lapses: 0, state: 1, firstLearnedAt: createdAt, correctCount: 0, incorrectCount: 0, familiarity: "new", recallAbility: "again",
  },
});

async function rate(learnerId: string, vocabularyId: string, requestId: string, expectedReps: number) {
  return user.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lab_phase_h_fsrs'), hashtext(${vocabularyId}))`;
    const prior = await tx.reviewEvent.findFirst({ where: { userId: learnerId, clientRequestId: requestId } });
    if (prior) return { replayed: true, due: prior.dueAfter };
    const progress = await tx.wordProgress.findFirst({ where: { vocabularyId, userId: learnerId } });
    if (!progress || progress.reps !== expectedReps) throw new AppError(409, "STALE_PROGRESS", "进度已变化");
    const next = schedule(progress, "good");
    const updated = await tx.wordProgress.updateMany({
      where: { vocabularyId, userId: learnerId, reps: expectedReps, due: progress.due },
      data: { due: next.due, stability: next.stability, difficulty: next.difficulty, reps: next.reps, lapses: next.lapses, state: next.state, lastReview: next.lastReview },
    });
    if (updated.count !== 1) throw new AppError(409, "STALE_PROGRESS", "进度已变化");
    await tx.reviewEvent.create({
      data: {
        id: `review:${learnerId}:${requestId}`, userId: learnerId, vocabularyId, clientRequestId: requestId, mode: "formal", rating: "good",
        dueBefore: progress.due, dueAfter: next.due, changedSchedule: true, createdAt: new Date(),
      },
    });
    const siblings = await tx.vocabulary.findMany({ where: { userId: learnerId, lemma: "shared-lemma", NOT: { id: vocabularyId } } });
    if (siblings.length) {
      await tx.wordProgress.updateMany({
        where: { userId: learnerId, vocabularyId: { in: siblings.map((item) => item.id) } },
        data: { due: next.due, stability: next.stability, difficulty: next.difficulty, reps: next.reps, lapses: next.lapses, state: next.state, lastReview: next.lastReview },
      });
    }
    return { replayed: false, due: next.due, reps: next.reps };
  }, transactionOptions);
}

const sameDayLessons = await user.dailyLesson.count({ where: { lessonDate: "2026-11-23", version: 1 } });
await user.vocabulary.create({
  data: {
    id: "vocab_phase_a_untracked", userId: "learner_phase_a", lemma: "untracked", pos: "noun", ipaNote: "", meaningZh: "测试", definitionEn: "test",
    collocation: "", example: "A phase h sentence.", exampleZh: "测试", difficulty: "A2", theme: "Daily Life", knownAlready: false, exampleFlagged: false,
    createdAt, lessonId: "lesson_learner_phase_a",
  },
});
let crossProgress = "";
try {
  await user.wordProgress.create({
    data: {
      id: "progress_cross", vocabularyId: "vocab_phase_a_untracked", userId: "learner_phase_b", due, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1,
      learningSteps: 0, reps: 0, lapses: 0, state: 0, firstLearnedAt: createdAt, correctCount: 0, incorrectCount: 0, familiarity: "new", recallAbility: "again",
    },
  });
  crossProgress = "created";
} catch {
  crossProgress = "rejected";
}
let crossQuiz = "";
try {
  await user.quizAttempt.create({
    data: { id: "attempt_cross", questionId: "question_learner_phase_a", selected: 0, correct: true, createdAt, userId: "learner_phase_b" },
  });
  crossQuiz = "created";
} catch {
  crossQuiz = "rejected";
}
await user.studySession.create({ data: { id: "session_a", lessonId: "lesson_learner_phase_a", module: "review", minutes: 5, createdAt, userId: "learner_phase_a" } });
await user.aIUsageRecord.create({ data: { id: "usage_a", userId: "learner_phase_a", model: "mock", kind: "probe", success: true, createdAt } });
const usageA = await user.aIUsageRecord.count({ where: { userId: "learner_phase_a" } });
const usageB = await user.aIUsageRecord.count({ where: { userId: "learner_phase_b" } });
const sessionsB = await user.studySession.count({ where: { userId: "learner_phase_b" } });
const settingsA = await user.userSettings.findFirstOrThrow({ where: { userId: "learner_phase_a" } });
const settingsB = await user.userSettings.findFirstOrThrow({ where: { userId: "learner_phase_b" } });
const duePrecision = await userDirect.$queryRaw`
  SELECT datetime_precision FROM information_schema.columns
  WHERE table_schema = 'lab_phase_h' AND table_name = 'WordProgress' AND column_name = 'due'` as Array<{ datetime_precision: number }>;
check("[PostgreSQL][隔离] 同日同版本课程、同形词、设置、会话和用量分属两个用户", sameDayLessons === 2 && settingsA.dailyNewWords === 8 && settingsB.dailyNewWords === 6 && usageA === 1 && usageB === 0 && sessionsB === 0);
check("[PostgreSQL][隔离] 跨用户进度和测验被外键拒绝", crossProgress === "rejected" && crossQuiz === "rejected");
check("[PostgreSQL][时间] WordProgress.due 保留毫秒精度", duePrecision[0]?.datetime_precision === 3);

const firstRate = await rate("learner_phase_a", "vocab_learner_phase_a", "phase-h-rate-1844", 2);
const replayRate = await rate("learner_phase_a", "vocab_learner_phase_a", "phase-h-rate-1844", 2);
const otherUserSameRequest = await rate("learner_phase_b", "vocab_learner_phase_b", "phase-h-rate-1844", 2);
const mirror = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_phase_a_mirror" } });
const bProgress = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_learner_phase_b" } });
const reviews = await user.reviewEvent.findMany({ select: { userId: true, vocabularyId: true, clientRequestId: true } });
check(
  "[PostgreSQL][FSRS] 同一请求只计分一次，另一个用户可用同一请求号",
  firstRate.replayed === false && replayRate.replayed === true && replayRate.due.getTime() === firstRate.due.getTime() && otherUserSameRequest.replayed === false
    && reviews.filter((item) => item.clientRequestId === "phase-h-rate-1844").length === 2,
  `replay=${replayRate.replayed} reviews=${reviews.length}`,
);
check(
  "[PostgreSQL][FSRS] 同形词镜像只更新当前用户",
  mirror.reps === firstRate.reps && bProgress.reps === otherUserSameRequest.reps
    && reviews.filter((item) => item.userId === "learner_phase_b").every((item) => item.vocabularyId === "vocab_learner_phase_b")
    && reviews.filter((item) => item.vocabularyId === "vocab_phase_a_mirror").length === 0,
  `mirror=${mirror.reps} b=${bProgress.reps}`,
);

const freshA = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_learner_phase_a" } });
const raced = await Promise.all([0, 1].map((index) => rate("learner_phase_a", "vocab_learner_phase_a", `phase-h-race-${index}-1844`, freshA.reps).then(() => "ok", codeOf)));
check("[PostgreSQL][FSRS] 同一进度并发只有一次成功", raced.filter((item) => item === "ok").length === 1 && raced.filter((item) => item === "STALE_PROGRESS").length === 1, raced.join(","));

const beforeRollback = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_learner_phase_b" } });
let rolled = false;
try {
  await user.$transaction(async (tx) => {
    await tx.wordProgress.update({ where: { id: beforeRollback.id }, data: { reps: 99 } });
    throw new Error("phase-h-rollback");
  }, transactionOptions);
} catch {
  rolled = true;
}
const afterRollback = await user.wordProgress.findFirstOrThrow({ where: { id: beforeRollback.id } });
check("[PostgreSQL][FSRS] 事务失败会回滚", rolled && afterRollback.reps === beforeRollback.reps);

async function reserve(learnerId: string, requestId: string, limit: number, now: Date, siteLimit = 1500) {
  const date = studyDate(now);
  return user.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lab_phase_h_ai'))`;
    const prior = await tx.aiCharge.findFirst({ where: { userId: learnerId, requestId } });
    if (prior) return prior;
    const used = await tx.aiCharge.count({ where: { userId: learnerId, studyDate: date, status: { in: ["pending", "succeeded", "unknown"] } } });
    const site = await tx.aiCharge.count({ where: { studyDate: date, status: { in: ["pending", "succeeded", "unknown"] } } });
    if (used >= limit) throw new AppError(429, "USER_QUOTA", "个人额度已满");
    if (site >= siteLimit) throw new AppError(429, "SITE_QUOTA", "全站额度已满");
    return tx.aiCharge.create({
      data: {
        id: `charge_${learnerId}_${requestId}`, userId: learnerId, requestId, model: "mock", kind: "probe", studyDate: date,
        status: "pending", reservedCount: 1, reservedCostMicros: 200, actualCostMicros: null, priceVersion: "unconfirmed-test", createdAt: now,
      },
    });
  }, transactionOptions);
}
const siteNow = new Date("2026-11-22T10:00:00.000Z");
const siteRace = await Promise.all([
  reserve("learner_phase_a", "phase-site-a-1844", 200, siteNow, 1).then(() => "ok", codeOf),
  reserve("learner_phase_b", "phase-site-b-1844", 200, siteNow, 1).then(() => "ok", codeOf),
]);
check("[PostgreSQL][额度] 全站最后一次并发只有一个成功", siteRace.filter((item) => item === "ok").length === 1 && siteRace.includes("SITE_QUOTA"), siteRace.join(","));
let budgetDenied = false;
try {
  assertRealSpendAllowed();
} catch (error) {
  budgetDenied = codeOf(error) === "AI_BUDGET_REQUIRED";
}
check("[PostgreSQL][额度] 未确认费用预算时拒绝真实模型请求", budgetDenied);

setStudyClock(new Date("2026-11-23T15:59:59.999Z"));
const quotaA = await reserve("learner_phase_a", "phase-quota-1844", 1, new Date("2026-11-23T15:59:59.999Z"));
const quotaReplay = await reserve("learner_phase_a", "phase-quota-1844", 1, new Date("2026-11-23T15:59:59.999Z"));
const quotaRace = await Promise.all([
  reserve("learner_phase_a", "phase-quota-a2-1844", 1, new Date("2026-11-23T15:59:59.999Z")).then(() => "ok", codeOf),
  reserve("learner_phase_b", "phase-quota-b2-1844", 1, new Date("2026-11-23T15:59:59.999Z")).then(() => "ok", codeOf),
]);
await user.aiCharge.update({ where: { id: quotaA.id }, data: { status: "failed", reservedCostMicros: 0, settledAt: new Date() } });
const released = await reserve("learner_phase_a", "phase-quota-new-1844", 1, new Date("2026-11-23T15:59:59.999Z"));
await user.aiCharge.update({ where: { id: released.id }, data: { status: "unknown", settledAt: new Date() } });
const unknownReplay = await reserve("learner_phase_a", "phase-quota-new-1844", 1, new Date("2026-11-23T16:00:00.000Z"));
const unknownRow = await user.aiCharge.findFirstOrThrow({ where: { id: released.id } });
const failedRow = await user.aiCharge.findFirstOrThrow({ where: { id: quotaA.id } });
setStudyClock(new Date("2026-11-23T16:00:00.000Z"));
const nextDay = await reserve("learner_phase_a", "phase-quota-next-day", 1, new Date("2026-11-23T16:00:00.000Z"));
setStudyClock(null);
check("[PostgreSQL][额度] 预留幂等且个人最后一次并发只有一个成功", quotaReplay.id === quotaA.id && quotaRace.filter((item) => item === "ok").length === 1 && quotaRace.includes("USER_QUOTA"), quotaRace.join(","));
check(
  "[PostgreSQL][额度] 失败释放、unknown 保留，跨上海日重置",
  failedRow.status === "failed" && failedRow.reservedCostMicros === 0 && unknownRow.status === "unknown" && unknownRow.reservedCostMicros === 200
    && unknownReplay.id === released.id && nextDay.studyDate === "2026-11-24",
);

await user.aiCharge.create({
  data: {
    id: "charge_pending_old", userId: "learner_phase_b", requestId: "phase-pending-old", model: "mock", kind: "probe", studyDate: "2026-11-23",
    status: "pending", reservedCount: 1, reservedCostMicros: 200, priceVersion: "unconfirmed-test", createdAt: new Date("2026-11-23T00:00:00.000Z"),
  },
});
await user.aiCharge.updateMany({ where: { id: "charge_pending_old", status: "pending" }, data: { status: "unknown", settledAt: new Date() } });
const recovered = await user.aiCharge.findFirstOrThrow({ where: { id: "charge_pending_old" } });
check("[PostgreSQL][额度] pending 恢复为 unknown 且不释放费用", recovered.status === "unknown" && recovered.reservedCostMicros === 200);

let probeRolled = false;
try {
  await user.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TABLE lab_phase_h."PhaseHRollbackProbe" ("id" INT)`);
    throw new Error("probe rollback");
  }, transactionOptions);
} catch {
  probeRolled = true;
}
const probeLeft = await userDirect.$queryRaw`
  SELECT COUNT(*)::int AS n FROM information_schema.tables
  WHERE table_schema = 'lab_phase_h' AND table_name = 'PhaseHRollbackProbe'` as Array<{ n: number }>;
check("[PostgreSQL][迁移] 隔离 schema 中失败的事务不会留下表", probeRolled && probeLeft[0].n === 0);

const pooledCount = await user.learner.count();
const directCount = await userDirect.learner.count();
check("[PostgreSQL][连接] Pooled 与 Direct 读到同一隔离数据", pooledCount === 2 && directCount === 2);

let rejectedProduction = false;
try {
  assertDevelopmentPair({
    DATABASE_URL: "postgresql://user:secret@production.example/neondb?sslmode=require",
    DIRECT_URL: "postgresql://user:secret@production-pooler.example/neondb?sslmode=require",
  });
} catch {
  rejectedProduction = true;
}
check("[PostgreSQL][连接] 非 development 目标在连接前被拒绝", rejectedProduction);

process.env.BETTER_AUTH_SECRET = "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8798";
process.env.AUTH_SELFTEST = "1";
const auth = betterAuth({
  baseURL: "http://127.0.0.1:8798",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(authDb, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  trustedOrigins: ["http://127.0.0.1:*", "http://localhost:*"],
  session: { expiresIn: 60 * 60, storeSessionInDatabase: true, cookieCache: { enabled: false } },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 100, customRules: { "/sign-in/email": { window: 15 * 60, max: 5 } } },
  advanced: {
    useSecureCookies: false,
    ipAddress: { ipAddressHeaders: ["x-lab-client-ip"] },
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
  },
});
const context = await auth.$context;
async function makeAccount(email: string, password: string, name: string) {
  const hashed = await context.password.hash(password);
  const accountUser = await context.internalAdapter.createUser({ email, name, emailVerified: true });
  await context.internalAdapter.createAccount({ userId: accountUser.id, providerId: "credential", accountId: accountUser.id, password: hashed });
  return accountUser;
}
const accountA = await makeAccount("phase-h-a@lab.test", "phase-h-a-pass-1844", "Phase A");
const accountB = await makeAccount("phase-h-b@lab.test", "phase-h-b-pass-2755", "Phase B");
await user.learner.update({ where: { id: "learner_phase_a" }, data: { authUserId: accountA.id } });
await user.learner.update({ where: { id: "learner_phase_b" }, data: { authUserId: accountB.id } });

const app = express();
app.use((req, _res, next) => {
  req.headers["x-lab-client-ip"] = req.socket.remoteAddress || "127.0.0.1";
  next();
});
app.all("/api/auth/{*any}", (req, res, next) => {
  Promise.resolve(toNodeHandler(auth)(req, res)).catch(next);
});
app.use(express.json());
app.get("/api/lessons", async (req, res) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return res.status(401).json({ code: "UNAUTHORIZED" });
  const learner = await user.learner.findFirst({ where: { authUserId: session.user.id } });
  if (!learner || learner.authUserId.startsWith("unbound:")) return res.status(403).json({ code: "UNBOUND" });
  const lessons = await user.dailyLesson.findMany({ where: { userId: learner.id } });
  res.json(lessons.map((item) => ({ id: item.id, lessonDate: item.lessonDate, version: item.version })));
});
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = app.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
check("[PostgreSQL][运行] 测试服务没有占用 8787", port !== 8787 && port !== 0);
async function signIn(email: string, password: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8798" },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, cookie: response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ") };
}
try {
  const signup = await fetch(`http://127.0.0.1:${port}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8798" },
    body: JSON.stringify({ email: "public@lab.test", password: "public-pass-1844", name: "Public" }),
  });
  const loginA = await signIn("phase-h-a@lab.test", "phase-h-a-pass-1844");
  const loginB = await signIn("phase-h-b@lab.test", "phase-h-b-pass-2755");
  const lessonsA = await fetch(`http://127.0.0.1:${port}/api/lessons?userId=learner_phase_b`, { headers: { cookie: loginA.cookie } });
  const lessonsB = await fetch(`http://127.0.0.1:${port}/api/lessons`, { headers: { cookie: loginB.cookie } });
  const anonymous = await fetch(`http://127.0.0.1:${port}/api/lessons`);
  const bodyA = await lessonsA.json() as Array<{ id: string }>;
  const bodyB = await lessonsB.json() as Array<{ id: string }>;
  const logout = await fetch(`http://127.0.0.1:${port}/api/auth/sign-out`, { method: "POST", headers: { cookie: loginA.cookie, Origin: "http://127.0.0.1:8798" } });
  const afterLogout = await fetch(`http://127.0.0.1:${port}/api/lessons`, { headers: { cookie: loginA.cookie } });
  check("[PostgreSQL][认证] 关闭注册，两个会话不混用，登出后拒绝", signup.status >= 400 && loginA.status === 200 && loginB.status === 200 && anonymous.status === 401 && bodyA.every((item) => item.id.includes("phase_a")) && bodyB.every((item) => item.id.includes("phase_b")) && logout.status === 200 && afterLogout.status === 401);
  const sessionRow = await authDb.session.findFirst({ where: { userId: accountB.id } });
  if (sessionRow) await authDb.session.update({ where: { id: sessionRow.id }, data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") } });
  const expired = await fetch(`http://127.0.0.1:${port}/api/lessons`, { headers: { cookie: loginB.cookie } });
  const accountC = await makeAccount("phase-h-c@lab.test", "phase-h-c-pass-3066", "Phase C");
  const loginC = await signIn("phase-h-c@lab.test", "phase-h-c-pass-3066");
  const unbound = await fetch(`http://127.0.0.1:${port}/api/lessons?userId=${accountA.id}`, { headers: { cookie: loginC.cookie } });
  check("[PostgreSQL][认证] 已登录但未绑定 Learner 被拒绝，伪造 userId 不改变身份", loginC.status === 200 && unbound.status === 403 && accountC.id !== accountA.id);
  check("[PostgreSQL][认证] 过期会话不能访问业务数据", loginB.status === 200 && expired.status === 401);
  const dead = new NeonAuth({
    datasources: { db: { url: "postgresql://phase:phase@127.0.0.1:1/neondb?schema=lab_phase_h_auth&connect_timeout=2&connection_limit=1" } },
  });
  let unavailable = false;
  try {
    await dead.user.count();
  } catch {
    unavailable = true;
  }
  await dead.$disconnect().catch(() => undefined);
  const restoredCount = await authDb.user.count();
  const badLogins = [];
  for (let index = 0; index < 6; index += 1) {
    badLogins.push(await signIn("missing-phase-h@lab.test", "wrong-pass-1844"));
  }
  check(
  "[PostgreSQL][认证] 错误连接被拒绝后认证库仍可读取，登录错误会进入数据库限流",
  unavailable && restoredCount === 3 && (badLogins[0]?.status ?? 0) >= 400 && badLogins[0]?.status !== 429 && badLogins.at(-1)?.status === 429,
  badLogins.map((item) => item.status).join(","),
);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const afterPublic = await publicCounts();
check("[PostgreSQL][保护] public 业务表和迁移记录没有变化", JSON.stringify(beforePublic) === JSON.stringify(afterPublic));
check("[SQLite] lab.db 和 auth.db 文件没有变化", JSON.stringify(labBefore) === JSON.stringify(databaseStamp(labDatabasePath)) && JSON.stringify(authBefore) === JSON.stringify(databaseStamp(authDatabasePath)));
let health = "not-running";
try {
  const response = await fetch("http://127.0.0.1:8787/api/health");
  health = response.ok ? await response.text() : String(response.status);
} catch {
  health = "not-running";
}
console.log(`8787 健康检查：${health}`);

await user.$disconnect();
await userDirect.$disconnect();
await authDb.$disconnect();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`neon phase h ok ${identity.endpoint} ${identity.database}`);
