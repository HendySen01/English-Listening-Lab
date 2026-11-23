// 隔离运行时的付费调用必须先经过替身。没有替身时直接拒绝，不访问模型。
import { AppError } from "./errors.js";

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
  if (!mock) throw new AppError(403, "PAID_AI_DISABLED", "隔离运行时拒绝调用付费模型。");
  calls += 1;
  mock();
}
