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
