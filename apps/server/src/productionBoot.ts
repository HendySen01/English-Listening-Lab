// Production 启动检查。只解析连接身份，不连接、不迁移。
import { inviteConfigured } from "./auth.js";

const developmentEndpoint = "ep-holy-flower-be2hbbj4";

function endpointOf(raw: string) {
  const url = new URL(raw);
  return {
    url,
    endpoint: url.hostname.split(".")[0].replace(/-pooler$/, ""),
    pooler: url.hostname.includes("-pooler"),
  };
}

export function assertProductionBoot(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") throw new Error("Production 入口拒绝非生产环境。");
  if ((env.BETTER_AUTH_SECRET || "").trim().length < 32) throw new Error("缺少认证密钥，已拒绝启动。");
  if (env.AUTH_SIGNUP === "open") throw new Error("公开注册保持关闭，已拒绝启动。");
  if (env.AUTH_SIGNUP_ENABLED === "1" && !inviteConfigured(env)) throw new Error("Production 注册必须配置邀请码。");
  const pooled = endpointOf(env.NEON_DATABASE_URL || "");
  const direct = endpointOf(env.NEON_DIRECT_URL || "");
  const problems: string[] = [];
  if (pooled.url.protocol !== "postgresql:" || direct.url.protocol !== "postgresql:") problems.push("protocol");
  if (pooled.url.pathname !== "/neondb" || direct.url.pathname !== "/neondb") problems.push("database");
  if (!pooled.pooler) problems.push("pooled host");
  if (direct.pooler) problems.push("direct host");
  if (pooled.endpoint !== direct.endpoint) problems.push("endpoint mismatch");
  if (!pooled.endpoint || pooled.endpoint === developmentEndpoint) problems.push("development endpoint");
  const schema = pooled.url.searchParams.get("schema") || direct.url.searchParams.get("schema") || "";
  if (schema === "public") problems.push("public schema");
  if (pooled.url.searchParams.get("sslmode") !== "require" || direct.url.searchParams.get("sslmode") !== "require") problems.push("sslmode");
  if (problems.length) throw new Error(`Production 数据库配置被拒绝：${problems.join(", ")}`);
  return { mode: "production-guarded" as const, endpoint: pooled.endpoint, database: "neondb" };
}
