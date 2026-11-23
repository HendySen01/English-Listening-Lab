import { execFileSync } from "node:child_process";
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
process.env.STUDY_TIMEZONE = "Asia/Shanghai";
process.env.AI_USER_DAILY_LIMIT = "200";
process.env.AI_SITE_DAILY_LIMIT = "1500";
process.env.AI_MAX_CONCURRENT = "4";
process.env.AI_SITE_MAX_CONCURRENT = "20";
delete process.env.AI_USER_DAILY_BUDGET_MICROS;
delete process.env.AI_SITE_DAILY_BUDGET_MICROS;
delete process.env.AI_HARD_BUDGET_MICROS;
delete process.env.AI_PRICE_VERSION;
delete process.env.AI_INPUT_MICROS_PER_MILLION;
delete process.env.AI_OUTPUT_MICROS_PER_MILLION;
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
const { assertPaidAiMock, paidAiCalls, resetPaidAiCalls, setPaidAiMock } = await import("./learnerAiGuard.ts");
const { assertRealSpendAllowed, ownQuota, setQuotaFault, withAiCharge } = await import("./learnerQuota.ts");
const { explainOwnedPassage, recallOwnLesson } = await import("./learnerApi.ts");
const { setStudyClock, studyDate, studyDayBounds } = await import("./studyTime.ts");

const failures: string[] = [];
function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`通过 ${name}`);
}
function codeOf(error: unknown) {
  return error instanceof AppError ? error.code : "";
}

let realDenied = false;
try {
  assertRealSpendAllowed();
} catch (error) {
  realDenied = codeOf(error) === "AI_BUDGET_REQUIRED";
}
check("[费用] 未确认预算时拒绝真实付费", realDenied && paidAiCalls() === 0);

function removeDatabase(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(`${file}${suffix}`)) fs.rmSync(`${file}${suffix}`);
}
function counts(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return {
      lessons: Number(db.prepare("SELECT COUNT(*) AS n FROM DailyLesson").get().n),
      usage: Number(db.prepare("SELECT COUNT(*) AS n FROM AIUsageRecord").get().n),
      progress: Number(db.prepare("SELECT COUNT(*) AS n FROM WordProgress").get().n),
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
const originalUsage = Number(migrated.prepare("SELECT COUNT(*) AS n FROM AIUsageRecord WHERE userId = ?").get(originalLearnerId).n);
const originalFsrs = JSON.stringify(migrated.prepare("SELECT id, due, lastReview, reps FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId));
const originalLessons = JSON.stringify(migrated.prepare("SELECT id, lessonDate, version, active FROM DailyLesson WHERE userId = ? ORDER BY id").all(originalLearnerId));
migrated.close();
execFileSync(process.execPath, ["scripts/auth/push.mjs"], { cwd: path.join(repoRoot, "apps", "server"), env: process.env, stdio: "inherit" });

const alpha = await createPrivateTestAccount({ email: "quota-a@lab.test", password: "quota-a-pass-1844", name: "Quota A" });
const beta = await createPrivateTestAccount({ email: "quota-b@lab.test", password: "quota-b-pass-2755", name: "Quota B" });
const user = getUserPrisma();
const createdAt = new Date("2026-05-01T00:00:00.000Z");
const learnerA = { learnerId: "learner_quota_a", authUserId: alpha.id, boundAt: createdAt };
const learnerB = { learnerId: "learner_quota_b", authUserId: beta.id, boundAt: createdAt };
for (const learner of [learnerA, learnerB]) {
  await user.learner.create({ data: { id: learner.learnerId, authUserId: learner.authUserId, boundAt: createdAt, createdAt } });
}
await user.dailyLesson.create({
  data: {
    id: "lesson_quota_a", lessonDate: "2020-05-06", version: 1, active: true, theme: "Daily Life", difficulty: "A2",
    newWordCount: 1, estimatedMinutes: 5, source: "runtime", poolNote: "", progress: "{}",
    listeningTitle: "history", listeningText: "An old sentence.", listeningChunks: "[]", listeningGloss: "{}",
    createdAt, userId: learnerA.learnerId,
  },
});
setPaidAiMock(() => undefined);
async function spend(learner: typeof learnerA, requestId: string) {
  return withAiCharge({ learner, requestId, kind: "probe" }, async () => {
    assertPaidAiMock();
    return { ok: true };
  });
}
const held = () => user.aiCharge.count({ where: { status: { in: ["pending", "succeeded", "unknown"] } } });

const first = await spend(learnerA, "quota-repeat-1844");
const second = await spend(learnerA, "quota-repeat-1844");
const callsAfterReplay = paidAiCalls();
const cross = await spend(learnerB, "quota-repeat-1844");
const repeatCount = await user.aiCharge.count({ where: { userId: learnerA.learnerId, requestId: "quota-repeat-1844" } });
check("[幂等] 同一请求不重复预留", first.replayed === false && second.replayed === true && callsAfterReplay === 1 && repeatCount === 1);
check("[隔离] 不同用户可以使用同一个请求号", cross.replayed === false && await user.aiCharge.count({ where: { requestId: "quota-repeat-1844" } }) === 2 && (await ownQuota(learnerB)).userUsed === 1);

process.env.AI_USER_DAILY_LIMIT = "2";
const personal = await Promise.all([0, 1].map((index) => spend(learnerA, `personal-slot-${index}-1844`).then(() => "ok", codeOf)));
process.env.AI_USER_DAILY_LIMIT = "200";
check("[并发] 个人最后一次额度只有一个成功", personal.filter((item) => item === "ok").length === 1 && personal.filter((item) => item === "USER_QUOTA").length === 1 && await user.aiCharge.count({ where: { userId: learnerA.learnerId, status: "succeeded" } }) === 2);

await user.aiCharge.deleteMany({});
resetPaidAiCalls();
process.env.AI_SITE_DAILY_LIMIT = "1";
const site = await Promise.all([
  spend(learnerA, "site-slot-a-1844").then(() => "ok", codeOf),
  spend(learnerB, "site-slot-b-1844").then(() => "ok", codeOf),
]);
process.env.AI_SITE_DAILY_LIMIT = "1500";
check("[并发] 全站最后一次额度只有一个成功", site.filter((item) => item === "ok").length === 1 && site.filter((item) => item === "SITE_QUOTA").length === 1 && await held() === 1 && paidAiCalls() === 1);

await user.aiCharge.deleteMany({});
resetPaidAiCalls();
let unsentCalls = paidAiCalls();
let unsentCode = "";
try {
  await withAiCharge({ learner: learnerA, requestId: "quota-unsent-1844", kind: "probe" }, async () => {
    throw new AppError(403, "AI_NOT_SENT", "确认没有发送。");
  });
} catch (error) {
  unsentCode = codeOf(error);
}
const unsent = await user.aiCharge.findFirstOrThrow({ where: { requestId: "quota-unsent-1844" } });
check("[结算] 确认未发送的失败会释放预留", unsentCode === "AI_NOT_SENT" && unsent.status === "failed" && unsent.reservedCostMicros === 0 && paidAiCalls() === unsentCalls && await held() === 0);

let unknownCode = "";
try {
  await withAiCharge({ learner: learnerA, requestId: "quota-unknown-1844", kind: "explain" }, async () => {
    assertPaidAiMock();
    throw new AppError(504, "AI_TIMEOUT", "结果还不明确。");
  });
} catch (error) {
  unknownCode = codeOf(error);
}
const callsAfterUnknown = paidAiCalls();
let retryCode = "";
try {
  await spend(learnerA, "quota-unknown-1844");
} catch (error) {
  retryCode = codeOf(error);
}
const unknown = await user.aiCharge.findFirstOrThrow({ where: { requestId: "quota-unknown-1844" } });
check("[结算] 结果不明的请求不释放且不重试模型", unknownCode === "AI_TIMEOUT" && unknown.status === "unknown" && unknown.reservedCount === 1 && retryCode === "AI_UNKNOWN" && paidAiCalls() === callsAfterUnknown);

await user.aiCharge.deleteMany({});
resetPaidAiCalls();
setStudyClock(new Date("2026-11-23T15:59:59.999Z"));
process.env.AI_USER_DAILY_LIMIT = "1";
await spend(learnerA, "quota-before-midnight");
setStudyClock(new Date("2026-11-23T16:00:00.000Z"));
const afterMidnight = await spend(learnerA, "quota-after-midnight");
const beforeRow = await user.aiCharge.findFirstOrThrow({ where: { requestId: "quota-before-midnight" } });
const afterRow = await user.aiCharge.findFirstOrThrow({ where: { requestId: "quota-after-midnight" } });
process.env.AI_USER_DAILY_LIMIT = "200";
setStudyClock(null);
check("[时区] 上海午夜后个人额度重新计算", afterMidnight.replayed === false && beforeRow.studyDate === "2026-11-23" && afterRow.studyDate === "2026-11-24");

setQuotaFault(() => {
  throw new Error("forced quota failure");
});
let faultCode = "";
try {
  await spend(learnerA, "quota-fault-184400");
} catch (error) {
  faultCode = codeOf(error);
}
setQuotaFault(null);
check("[事务] 预留失败不会扣减也不会调用模型", faultCode === "AI_QUOTA_UNAVAILABLE" && await user.aiCharge.count({ where: { requestId: "quota-fault-184400" } }) === 0);

process.env.AI_MAX_INPUT_TOKENS = "100";
process.env.AI_MAX_OUTPUT_TOKENS = "50";
process.env.AI_PRICE_VERSION = "test-unconfirmed";
process.env.AI_INPUT_MICROS_PER_MILLION = "1000000";
process.env.AI_OUTPUT_MICROS_PER_MILLION = "2000000";
process.env.AI_USER_DAILY_BUDGET_MICROS = "200";
process.env.AI_SITE_DAILY_BUDGET_MICROS = "200";
process.env.AI_HARD_BUDGET_MICROS = "200";
const beforeBudgetCalls = paidAiCalls();
const priced = await withAiCharge({ learner: learnerA, requestId: "quota-budget-1844", kind: "lesson" }, async () => {
  assertPaidAiMock();
  return { ok: true };
});
const pricedRow = await user.aiCharge.findFirstOrThrow({ where: { requestId: "quota-budget-1844" } });
let budgetCode = "";
try {
  await spend(learnerB, "quota-budget-over-1844");
} catch (error) {
  budgetCode = codeOf(error);
}
check("[费用] 预算只够一次最坏预留", priced.replayed === false && pricedRow.reservedCostMicros === 200 && pricedRow.actualCostMicros == null && pricedRow.priceVersion === "test-unconfirmed" && budgetCode === "COST_BUDGET" && paidAiCalls() === beforeBudgetCalls + 1);
let tokenCode = "";
try {
  await withAiCharge({ learner: learnerA, requestId: "quota-token-1844", kind: "probe", inputTokens: 101 }, async () => {
    assertPaidAiMock();
    return { ok: true };
  });
} catch (error) {
  tokenCode = codeOf(error);
}
check("[限额] 超过 Token 上限不会预留", tokenCode === "AI_TOKEN_LIMIT" && await user.aiCharge.count({ where: { requestId: "quota-token-1844" } }) === 0 && paidAiCalls() === beforeBudgetCalls + 1);
delete process.env.AI_PRICE_VERSION;
delete process.env.AI_INPUT_MICROS_PER_MILLION;
delete process.env.AI_OUTPUT_MICROS_PER_MILLION;
delete process.env.AI_USER_DAILY_BUDGET_MICROS;
delete process.env.AI_SITE_DAILY_BUDGET_MICROS;
delete process.env.AI_HARD_BUDGET_MICROS;
delete process.env.AI_MAX_INPUT_TOKENS;
delete process.env.AI_MAX_OUTPUT_TOKENS;

await user.aiCharge.deleteMany({});
resetPaidAiCalls();
process.env.AI_MAX_CONCURRENT = "1";
let releaseGate = () => {};
const gate = new Promise<void>((resolve) => {
  releaseGate = resolve;
});
const running = withAiCharge({ learner: learnerA, requestId: "quota-flight-1844", kind: "probe" }, async () => {
  await gate;
  assertPaidAiMock();
  return { ok: true };
});
let sawPending = false;
for (let attempt = 0; attempt < 20 && !sawPending; attempt += 1) {
  sawPending = await user.aiCharge.count({ where: { requestId: "quota-flight-1844", status: "pending" } }) === 1;
  if (!sawPending) await new Promise((resolve) => setTimeout(resolve, 25));
}
let concurrentCode = "";
try {
  await spend(learnerA, "quota-flight-next-1844");
} catch (error) {
  concurrentCode = codeOf(error);
}
releaseGate();
await running;
process.env.AI_MAX_CONCURRENT = "4";
check("[并发] 达到并发上限时拒绝新的模型调用", sawPending && concurrentCode === "AI_CONCURRENCY" && paidAiCalls() === 1);

const recalled = await recallOwnLesson(learnerA, "lesson_quota_a", "heard the old sentence");
const cached = await explainOwnedPassage(learnerA, "museum", "museum", "After hours of driving, we finally found a quiet parking space behind the museum.", "quota-cache-1844");
const quotaBeforeOffline = await user.aiCharge.count();
check("[免费] 本地回忆和缓存命中不扣次数", recalled.accepted === true && cached.charged === false && cached.source === "cache" && await user.aiCharge.count() === quotaBeforeOffline && paidAiCalls() === 1);
process.env.AI_QUOTA_PAUSED = "1";
let pausedCode = "";
try {
  await spend(learnerA, "quota-paused-1844");
} catch (error) {
  pausedCode = codeOf(error);
}
delete process.env.AI_QUOTA_PAUSED;
check("[暂停] 暂停后不会预留或调用模型", pausedCode === "AI_PAUSED" && await user.aiCharge.count({ where: { requestId: "quota-paused-1844" } }) === 0 && paidAiCalls() === 1);

const runtime = createUserRuntimeApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = runtime.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
const origin = { Origin: "http://127.0.0.1:8797" };
async function signIn(email: string, password: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email, password }),
  });
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
}
try {
  const cookieA = await signIn("quota-a@lab.test", "quota-a-pass-1844");
  const cookieB = await signIn("quota-b@lab.test", "quota-b-pass-2755");
  const anonymous = await fetch(`http://127.0.0.1:${port}/api/ai/quota`);
  const quotaA = await fetch(`http://127.0.0.1:${port}/api/ai/quota?userId=${learnerB.learnerId}`, { headers: { cookie: cookieA, ...origin } });
  const quotaB = await fetch(`http://127.0.0.1:${port}/api/ai/quota`, { headers: { cookie: cookieB, ...origin } });
  const bodyA = await quotaA.json() as { userUsed: number; resetAt: string; costBudget: string };
  const bodyB = await quotaB.json() as { userUsed: number };
  const expectedReset = studyDayBounds(studyDate(new Date())).end.toISOString();
  check("[HTTP] 未登录和伪造身份都不能改额度", anonymous.status === 401 && quotaA.status === 200 && bodyA.userUsed > bodyB.userUsed && bodyA.costBudget === "unconfigured" && bodyA.resetAt === expectedReset && !JSON.stringify(bodyA).includes(learnerB.learnerId));
} finally {
  setPaidAiMock(null);
  setStudyClock(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectUserPrisma();
  await disconnectAuthPrisma();
}

check("[数据库] 原始用量、课程日期和 FSRS 没有被改写", (() => {
  const db = new DatabaseSync(runtimeFile, { readOnly: true });
  try {
    return Number(db.prepare("SELECT COUNT(*) AS n FROM AIUsageRecord WHERE userId = ?").get(originalLearnerId).n) === originalUsage
      && JSON.stringify(db.prepare("SELECT id, lessonDate, version, active FROM DailyLesson WHERE userId = ? ORDER BY id").all(originalLearnerId)) === originalLessons
      && JSON.stringify(db.prepare("SELECT id, due, lastReview, reps FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId)) === originalFsrs;
  } finally {
    db.close();
  }
})());
check("[数据库] lab.db 和 auth.db 没有变化", JSON.stringify(labBefore) === JSON.stringify(databaseStamp(labDatabasePath)) && JSON.stringify(labCountsBefore) === JSON.stringify(counts(labDatabasePath)) && JSON.stringify(authBefore) === JSON.stringify(databaseStamp(authDatabasePath)));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("user quota ok");
