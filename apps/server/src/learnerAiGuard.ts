// 隔离运行时的付费调用必须先经过替身。没有替身时直接拒绝，不访问模型。
import { AppError } from "./errors.js";
import { assertRealSpendAllowed } from "./learnerQuota.js";

let mock: (() => void) | null = null;
let calls = 0;

export function setPaidAiMock(next: (() => void) | null) {
  mock = next;
}

export function resetPaidAiCalls() {
  calls = 0;
}

export function paidAiCalls() {
  return calls;
}

export function assertPaidAiMock() {
  if (!mock) {
    assertRealSpendAllowed();
    throw new AppError(403, "PAID_AI_DISABLED", "没有已授权的模型调用路径，这次没有发送请求。");
  }
  calls += 1;
  mock();
}

export async function sendAuthorizedModelProbe() {
  assertRealSpendAllowed();
  const key = process.env.DEEPSEEK_API_KEY?.trim() || "";
  if (!key) throw new AppError(403, "PAID_AI_DISABLED", "没有已授权的模型调用路径，这次没有发送请求。");
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with OK." }],
    }),
  });
  if (!response.ok) throw new AppError(502, "AI_UPSTREAM", "模型没有返回可用结果。");
  return { ok: true, mocked: false };
}
