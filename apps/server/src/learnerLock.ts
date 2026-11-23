// PostgreSQL 用事务级咨询锁串行化同一范围的读写。
// SQLite 仍由文件锁串行化，这里不执行 PostgreSQL 函数。
import { createHash } from "node:crypto";

const lockName = /^[A-Za-z0-9:_-]+$/;

export async function lockLearnerScope(tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number> }, name: string) {
  if (process.env.POSTGRES_RUNTIME !== "1") return;
  if (!name || !lockName.test(name)) throw new Error("拒绝未命名的数据库锁。");
  const key = name.length <= 80 ? name : createHash("sha256").update(name).digest("hex");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

export function learnerTransactionOptions() {
  if (process.env.POSTGRES_RUNTIME !== "1") return undefined;
  return { maxWait: 20_000, timeout: 20_000 };
}
