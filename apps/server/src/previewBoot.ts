// 启动前的拒绝条件。这里只解析配置，不连接数据库。
import { assertDevelopmentPair } from "../scripts/neon-dev/guard.mjs";

const businessSchema = "lab_phase_h";
const authSchema = "lab_phase_h_auth";

function schemaOf(raw: string) {
  return new URL(raw).searchParams.get("schema") || "";
}

export function assertLocalServerAllowed(env = process.env) {
  if (env.VERCEL === "1") throw new Error("本地 SQLite 入口不能在 Vercel 启动。");
  if (env.POSTGRES_RUNTIME === "1") throw new Error("本地 SQLite 入口不能连接 PostgreSQL。");
}

export function assertPreviewBoot(env = process.env) {
  const vercel = env.VERCEL === "1";
  const postgres = env.POSTGRES_RUNTIME === "1";
  if (!vercel && !postgres) return { mode: "local-sqlite" as const };
  if ((env.BETTER_AUTH_SECRET || "").trim().length < 32) throw new Error("缺少认证密钥，已拒绝启动。");
  if (env.AUTH_SIGNUP === "open") throw new Error("公开注册保持关闭，已拒绝启动。");
  const userUrl = env.USER_DATABASE_URL || "";
  const authUrl = env.AUTH_DATABASE_URL || "";
  if (!userUrl.startsWith("postgresql:") || !authUrl.startsWith("postgresql:")) {
    throw new Error("多用户 PostgreSQL 运行时拒绝 SQLite 文件。");
  }
  if (schemaOf(userUrl) !== businessSchema) throw new Error("业务库不是隔离 schema，已拒绝启动。");
  if (schemaOf(authUrl) !== authSchema) throw new Error("认证库不是隔离 schema，已拒绝启动。");
  if (!env.NEON_DATABASE_URL || !env.NEON_DIRECT_URL) throw new Error("缺少已核验的 development 连接，已拒绝启动。");
  const identity = assertDevelopmentPair({
    DATABASE_URL: env.NEON_DATABASE_URL,
    DIRECT_URL: env.NEON_DIRECT_URL,
  });
  if (env.DEEPSEEK_API_KEY?.trim()) throw new Error("预览启动拒绝携带可直接调用的付费模型密钥。");
  return { mode: "postgres-guarded" as const, endpoint: identity.endpoint, database: identity.database };
}
