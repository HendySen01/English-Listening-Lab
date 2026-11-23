// Production 启动检查。只解析连接身份，不连接、不迁移。
function inviteConfigured(env: NodeJS.ProcessEnv) {
  const code = (env.AUTH_INVITE_CODE || "").trim();
  return code.length >= 8 && code.length <= 64 && !/\s/.test(code);
}

const developmentEndpoint = "ep-holy-flower-be2hbbj4";
const productionEndpoint = "ep-weathered-dream-bew7iwf0";

function platformHost(raw: string | undefined) {
  const host = (raw || "").trim().toLowerCase().replace(/^https?:\/\//, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/.test(host)) return "";
  return host;
}

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
  if (pooled.endpoint !== productionEndpoint) problems.push("endpoint is not the confirmed production endpoint");
  const schema = pooled.url.searchParams.get("schema") || direct.url.searchParams.get("schema") || "";
  if (schema === "public") problems.push("public schema");
  if (pooled.url.searchParams.get("sslmode") !== "require" || direct.url.searchParams.get("sslmode") !== "require") problems.push("sslmode");
  if (problems.length) throw new Error(`Production 数据库配置被拒绝：${problems.join(", ")}`);
  return { mode: "production-guarded" as const, endpoint: pooled.endpoint, database: "neondb" };
}

export function productionAuthBase(env: NodeJS.ProcessEnv = process.env) {
  const deploymentHost = platformHost(env.VERCEL_URL);
  const productionHost = platformHost(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!deploymentHost && !productionHost) throw new Error("Production 缺少平台分配的 https 域名。");
  const deployment = deploymentHost ? `https://${deploymentHost}` : "";
  const production = productionHost ? `https://${productionHost}` : "";
  const configured = env.BETTER_AUTH_URL?.trim() || "";
  if (configured && !configured.startsWith("https://")) {
    throw new Error("Production 的 BETTER_AUTH_URL 必须是 https 地址。");
  }
  if (configured && configured !== deployment && configured !== production) {
    throw new Error("BETTER_AUTH_URL 必须与当前 Production 域名一致。");
  }
  return configured || production || deployment;
}

export function productionTrustedOrigins(env: NodeJS.ProcessEnv = process.env) {
  const base = productionAuthBase(env);
  const extras = (env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  for (const origin of extras) {
    if (!origin.startsWith("https://") || origin.includes("*")) {
      throw new Error("Production 的受信来源必须是明确的 https 域名。");
    }
  }
  const deployment = platformHost(env.VERCEL_URL) ? `https://${platformHost(env.VERCEL_URL)}` : "";
  const production = platformHost(env.VERCEL_PROJECT_PRODUCTION_URL) ? `https://${platformHost(env.VERCEL_PROJECT_PRODUCTION_URL)}` : "";
  return [...new Set([base, deployment, production, ...extras].filter(Boolean))];
}
