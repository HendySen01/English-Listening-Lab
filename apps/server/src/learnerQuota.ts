// 次数、Token、并发和幂等始终生效。金额预算只在价格和硬预算都已配置时额外生效。
// 未配置金额预算不会单独拒绝请求。真实模型仍要单独授权，替身测试不能打到 DeepSeek。
import { AppError } from "./errors.js";
import type { VerifiedLearner } from "./learnerIdentity.js";
import { learnerTransactionOptions, lockLearnerScope } from "./learnerLock.js";
import { learnerDb, postgresRuntimeRequested } from "./runtimeClients.js";
import { studyDate, studyDayBounds, studyNow } from "./studyTime.js";

const requestIdPattern = /^[A-Za-z0-9_-]{8,80}$/;
const holding = ["pending", "succeeded", "unknown"] as const;
export function aiOutputTokenLimit() {
  return requiredInt("AI_MAX_OUTPUT_TOKENS", 6000);
}
export const aiKinds = ["lesson", "explain", "example", "simpler", "probe"] as const;
export type AiKind = (typeof aiKinds)[number];

let schemaReady = false;
let quotaFault: (() => void) | null = null;

export function setQuotaFault(next: (() => void) | null) {
  quotaFault = next;
}

function requiredInt(name: string, fallback: number) {
  const raw = process.env[name]?.trim() ?? "";
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new AppError(500, "BAD_AI_QUOTA", "额度配置不正确。");
  return value;
}

function optionalInt(name: string) {
  const raw = process.env[name]?.trim() ?? "";
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new AppError(500, "BAD_AI_QUOTA", "额度配置不正确。");
  return value;
}

function priceConfig() {
  const version = process.env.AI_PRICE_VERSION?.trim() ?? "";
  const inputRaw = process.env.AI_INPUT_MICROS_PER_MILLION?.trim() ?? "";
  const outputRaw = process.env.AI_OUTPUT_MICROS_PER_MILLION?.trim() ?? "";
  if (!version || !inputRaw || !outputRaw) return null;
  const inputRate = Number(inputRaw);
  const outputRate = Number(outputRaw);
  if (!Number.isInteger(inputRate) || !Number.isInteger(outputRate) || inputRate < 0 || outputRate < 0) {
    throw new AppError(500, "BAD_AI_PRICE", "模型价格配置不正确。");
  }
  return { version, inputRate, outputRate };
}

function budgetConfig() {
  const price = priceConfig();
  const user = optionalInt("AI_USER_DAILY_BUDGET_MICROS");
  const site = optionalInt("AI_SITE_DAILY_BUDGET_MICROS");
  const hard = optionalInt("AI_HARD_BUDGET_MICROS");
  if (!price || user == null || site == null || hard == null) return null;
  const inputTokens = requiredInt("AI_MAX_INPUT_TOKENS", 8000);
  const outputTokens = aiOutputTokenLimit();
  const worst = Math.ceil((inputTokens * price.inputRate) / 1_000_000) + Math.ceil((outputTokens * price.outputRate) / 1_000_000);
  return { ...price, user, site, hard, worst };
}

export function assertRealSpendAllowed() {
  if (process.env.AI_REAL_CALLS !== "1") {
    throw new AppError(403, "PAID_AI_DISABLED", "真实模型调用尚未单独授权，这次没有发送请求。");
  }
}

function normalizeRequestId(value: unknown) {
  if (value == null || value === "") return `auto-${crypto.randomUUID()}`;
  const text = String(value).trim();
  if (!requestIdPattern.test(text)) throw new AppError(400, "BAD_REQUEST_ID", "AI 请求号不正确。");
  return text;
}

async function ensureSchema() {
  if (schemaReady) return;
  if (postgresRuntimeRequested()) {
    schemaReady = true;
    return;
  }
  const db = learnerDb();
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AiCharge" (
      "id" TEXT NOT NULL PRIMARY KEY,
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
      "createdAt" DATETIME NOT NULL,
      "settledAt" DATETIME,
      CONSTRAINT "AiCharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Learner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AiCharge_userId_requestId_key" ON "AiCharge"("userId", "requestId")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiCharge_studyDate_status_idx" ON "AiCharge"("studyDate", "status")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiCharge_userId_studyDate_status_idx" ON "AiCharge"("userId", "studyDate", "status")`);
  schemaReady = true;
}

function heldCost(rows: Array<{ reservedCostMicros: number | null; actualCostMicros: number | null; status: string }>) {
  return rows.reduce((sum, row) => sum + (row.status === "succeeded" && row.actualCostMicros != null ? row.actualCostMicros : row.reservedCostMicros ?? 0), 0);
}

export async function ownQuota(learner: VerifiedLearner, now = studyNow()) {
  await ensureSchema();
  const date = studyDate(now);
  const db = learnerDb();
  const limits = {
    user: requiredInt("AI_USER_DAILY_LIMIT", 200),
    site: requiredInt("AI_SITE_DAILY_LIMIT", 1500),
  };
  const budget = budgetConfig();
  const [userRows, siteRows, hardRows] = await Promise.all([
    db.aiCharge.findMany({ where: { userId: learner.learnerId, studyDate: date, status: { in: [...holding] } } }),
    db.aiCharge.findMany({ where: { studyDate: date, status: { in: [...holding] } } }),
    db.aiCharge.findMany({ where: { status: { in: [...holding] } }, select: { reservedCostMicros: true, actualCostMicros: true, status: true } }),
  ]);
  const userUsed = userRows.length;
  const siteUsed = siteRows.length;
  const warning = userUsed >= limits.user * 0.8 ? "user" : siteUsed >= limits.site * 0.8 ? "site" : budget && heldCost(userRows) >= budget.user * 0.8 ? "budget" : null;
  return {
    studyDate: date,
    resetAt: studyDayBounds(date, "Asia/Shanghai").end.toISOString(),
    userUsed,
    userRemaining: Math.max(0, limits.user - userUsed),
    userLimit: limits.user,
    siteUsed,
    siteRemaining: Math.max(0, limits.site - siteUsed),
    siteLimit: limits.site,
    warning,
    paused: process.env.AI_QUOTA_PAUSED === "1",
    costBudget: budget ? "active" : "unconfigured",
    userBudgetRemainingMicros: budget ? Math.max(0, budget.user - heldCost(userRows)) : null,
    siteBudgetRemainingMicros: budget ? Math.max(0, budget.site - heldCost(siteRows)) : null,
  };
}

export async function withAiCharge<T>(
  input: { learner: VerifiedLearner; requestId: unknown; kind: AiKind; model?: string; now?: Date; inputTokens?: number; outputTokens?: number },
  work: () => Promise<T>,
): Promise<{ replayed: boolean; value: T }> {
  if (process.env.AI_QUOTA_PAUSED === "1") throw new AppError(503, "AI_PAUSED", "AI 请求已暂停，这次没有调用模型。");
  const maxInput = requiredInt("AI_MAX_INPUT_TOKENS", 8000);
  const maxOutput = aiOutputTokenLimit();
  if (input.inputTokens != null && (!Number.isInteger(input.inputTokens) || input.inputTokens < 0 || input.inputTokens > maxInput)) {
    throw new AppError(400, "AI_TOKEN_LIMIT", "这次请求超过输入 Token 上限，没有调用模型。");
  }
  if (input.outputTokens != null && (!Number.isInteger(input.outputTokens) || input.outputTokens < 0 || input.outputTokens > maxOutput)) {
    throw new AppError(400, "AI_TOKEN_LIMIT", "这次请求超过输出 Token 上限，没有调用模型。");
  }
  const requestId = normalizeRequestId(input.requestId);
  const now = input.now ?? studyNow();
  const date = studyDate(now);
  const model = input.model || "mock";
  const budget = budgetConfig();
  await ensureSchema();
  const db = learnerDb();
  const reserve = async (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => {
    await lockLearnerScope(tx, `ai:${date}`);
    if (quotaFault) quotaFault();
    const prior = await tx.aiCharge.findFirst({ where: { userId: input.learner.learnerId, requestId } });
    if (prior) return { fresh: false, row: prior };
    const userUsed = await tx.aiCharge.count({ where: { userId: input.learner.learnerId, studyDate: date, status: { in: [...holding] } } });
    const siteUsed = await tx.aiCharge.count({ where: { studyDate: date, status: { in: [...holding] } } });
    const userInFlight = await tx.aiCharge.count({ where: { userId: input.learner.learnerId, status: { in: ["pending", "unknown"] } } });
    const siteInFlight = await tx.aiCharge.count({ where: { status: { in: ["pending", "unknown"] } } });
    if (userUsed >= requiredInt("AI_USER_DAILY_LIMIT", 200)) throw new AppError(429, "USER_QUOTA", "今天的个人 AI 次数已经用完。");
    if (siteUsed >= requiredInt("AI_SITE_DAILY_LIMIT", 1500)) throw new AppError(429, "SITE_QUOTA", "今天的全站 AI 次数已经用完。");
    if (userInFlight >= requiredInt("AI_MAX_CONCURRENT", 4)) throw new AppError(429, "AI_CONCURRENCY", "同时进行的 AI 请求太多，这次没有调用模型。");
    if (siteInFlight >= requiredInt("AI_SITE_MAX_CONCURRENT", 20)) throw new AppError(429, "AI_CONCURRENCY", "同时进行的 AI 请求太多，这次没有调用模型。");
    if (budget) {
      const userRows = await tx.aiCharge.findMany({ where: { userId: input.learner.learnerId, studyDate: date, status: { in: [...holding] } } });
      const siteRows = await tx.aiCharge.findMany({ where: { studyDate: date, status: { in: [...holding] } } });
      const hardRows = await tx.aiCharge.findMany({ where: { status: { in: [...holding] } }, select: { reservedCostMicros: true, actualCostMicros: true, status: true } });
      if (heldCost(userRows) + budget.worst > budget.user || heldCost(siteRows) + budget.worst > budget.site || heldCost(hardRows) + budget.worst > budget.hard) {
        throw new AppError(429, "COST_BUDGET", "费用预算不足，这次没有调用模型。");
      }
    }
    const created = await tx.aiCharge.create({
      data: {
        id: `charge_${input.learner.learnerId}_${requestId}`,
        userId: input.learner.learnerId,
        requestId,
        model,
        kind: input.kind,
        studyDate: date,
        status: "pending",
        reservedCount: 1,
        reservedCostMicros: budget ? budget.worst : null,
        actualCostMicros: null,
        priceVersion: budget?.version ?? null,
        createdAt: new Date(),
      },
    });
    return { fresh: true, row: created };
  };
  const options = learnerTransactionOptions();
  const existing = await (options ? db.$transaction(reserve, options) : db.$transaction(reserve)).catch(async (error: unknown) => {
    if (error instanceof AppError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "P2002") {
      const prior = await db.aiCharge.findFirst({ where: { userId: input.learner.learnerId, requestId } });
      if (prior) return { fresh: false, row: prior };
    }
    throw new AppError(503, "AI_QUOTA_UNAVAILABLE", "额度服务暂时不可用，这次没有调用模型。");
  });

  if (!existing.fresh) {
    if (existing.row.status === "succeeded") {
      if (existing.row.kind !== input.kind) throw new AppError(409, "AI_REQUEST_CONFLICT", "请求号已用于其他 AI 操作。");
      if (!existing.row.resultJson) throw new AppError(502, "AI_RESPONSE_REJECTED", "这次模型请求未返回可用结果。");
      return { replayed: true, value: JSON.parse(existing.row.resultJson) as T };
    }
    if (existing.row.status === "failed") throw new AppError(409, "AI_REQUEST_CLOSED", "这次请求已确认没有产生费用，没有再次预留。");
    if (existing.row.status === "unknown") throw new AppError(409, "AI_UNKNOWN", "上次请求的费用结果还不明确，没有再次调用模型。");
    throw new AppError(409, "AI_PENDING", "这个请求还在处理，没有再次预留。");
  }

  try {
    const value = await work();
    await db.aiCharge.update({
      where: { id: existing.row.id },
      data: {
        status: "succeeded",
        resultJson: JSON.stringify(value),
        settledAt: new Date(),
      },
    });
    return { replayed: false, value };
  } catch (error) {
    const unsent = error instanceof AppError && (error.code === "PAID_AI_DISABLED" || error.code === "AI_NOT_SENT");
    await db.aiCharge.update({
      where: { id: existing.row.id },
      data: unsent
        ? { status: "failed", reservedCostMicros: 0, settledAt: new Date() }
        : { status: error instanceof AppError && error.code === "AI_RESPONSE_REJECTED" ? "succeeded" : "unknown", settledAt: new Date() },
    });
    throw error;
  }
}
