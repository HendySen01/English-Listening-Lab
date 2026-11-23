// 启动前的拒绝条件。这里只解析配置，不连接数据库。
import { assertDevelopmentPair } from "../scripts/neon-dev/guard.mjs";

const businessSchema = "lab_phase_h";
const authSchema = "lab_phase_h_auth";

function schemaOf(raw: string) {
  return new URL(raw).searchParams.get("schema") || "";
}

function platformHost(raw: string | undefined) {
  const host = (raw || "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/.test(host)) return "";
  return host;
}

export function previewAuthBase(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.BETTER_AUTH_URL?.trim() || "";
  const simulation = env.VERCEL_SIMULATION === "1" && /^http:\/\/127\.0\.0\.1:\d+$/.test(configured);
  if (simulation) return configured;
  const deploymentHost = platformHost(env.VERCEL_URL);
  if (!deploymentHost) throw new Error("Preview 缺少平台分配的 https 域名。");
  const deployment = `https://${deploymentHost}`;
  const branchHost = platformHost(env.VERCEL_BRANCH_URL);
  const branch = branchHost ? `https://${branchHost}` : "";
  if (configured && !configured.startsWith("https://")) {
    throw new Error("Preview 的 BETTER_AUTH_URL 必须是当前预览域名的 https 地址。");
  }
  if (configured && configured !== deployment && configured !== branch) {
    throw new Error("BETTER_AUTH_URL 必须与当前 Preview 域名一致。");
  }
  return configured || deployment;
}

export function previewTrustedOrigins(env: NodeJS.ProcessEnv = process.env) {
  const base = previewAuthBase(env);
  const extras = (env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  for (const origin of extras) {
    if (!origin.startsWith("https://") || origin.includes("*")) {
      throw new Error("Preview 的受信来源必须是明确的 https 域名。");
    }
  }
  const deployment = platformHost(env.VERCEL_URL) ? `https://${platformHost(env.VERCEL_URL)}` : "";
  const branch = platformHost(env.VERCEL_BRANCH_URL) ? `https://${platformHost(env.VERCEL_BRANCH_URL)}` : "";
  return [...new Set([base, deployment, branch, ...extras].filter(Boolean))];
}

export function assertLocalServerAllowed(env = process.env) {
  if (env.VERCEL === "1") throw new Error("本地 SQLite 入口不能在 Vercel 启动。");
  if (env.POSTGRES_RUNTIME === "1") throw new Error("本地 SQLite 入口不能连接 PostgreSQL。");
}

export function assertPreviewBoot(env = process.env) {
  const vercel = env.VERCEL === "1";
  const postgres = env.POSTGRES_RUNTIME === "1";
  if (!vercel && !postgres) return { mode: "local-sqlite" as const };
  if (vercel && env.VERCEL_ENV === "production") throw new Error("Production 环境拒绝启动预览入口。");
  if (vercel && env.VERCEL_ENV !== "preview" && env.VERCEL_ENV !== "development") {
    throw new Error("只有 Preview 或 Development 环境可以启动预览入口。");
  }
  if ((env.BETTER_AUTH_SECRET || "").trim().length < 32) throw new Error("缺少认证密钥，已拒绝启动。");
  if (env.AUTH_SIGNUP === "open") throw new Error("公开注册保持关闭，已拒绝启动。");
  if (vercel) previewAuthBase(env);
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
