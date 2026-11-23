// 业务和认证客户端的唯一选择点。
// PostgreSQL 只有在显式运行时完成 development 核验后才能安装。
import { getAuthPrisma } from "./authDatabase.js";
import { assertUserRuntimeEnabled, getUserPrisma } from "./userDatabase.js";

type RuntimeClient = {
  $disconnect?: () => Promise<void>;
};

let learnerOverride: RuntimeClient | null = null;
let authOverride: RuntimeClient | null = null;

export function postgresRuntimeRequested(env = process.env) {
  return env.POSTGRES_RUNTIME === "1";
}

export function installPostgresClients(input: { learner: RuntimeClient; auth: RuntimeClient }) {
  if (!postgresRuntimeRequested()) throw new Error("只有显式 PostgreSQL 运行时可以安装 Neon 客户端。");
  learnerOverride = input.learner;
  authOverride = input.auth;
}

export function learnerDb() {
  if (postgresRuntimeRequested()) {
    if (!learnerOverride) throw new Error("PostgreSQL 业务库尚未通过 development 核验，已拒绝连接。");
    return learnerOverride as ReturnType<typeof getUserPrisma>;
  }
  return getUserPrisma();
}

export function authDb() {
  if (postgresRuntimeRequested()) {
    if (!authOverride) throw new Error("PostgreSQL 认证库尚未通过 development 核验，已拒绝连接。");
    return authOverride as ReturnType<typeof getAuthPrisma>;
  }
  return getAuthPrisma();
}

export function assertConfiguredRuntime() {
  if (postgresRuntimeRequested()) {
    learnerDb();
    authDb();
    return;
  }
  if ((process.env.USER_DATABASE_URL || "").startsWith("postgres")) {
    throw new Error("SQLite 多用户入口拒绝 PostgreSQL。");
  }
  assertUserRuntimeEnabled();
}
