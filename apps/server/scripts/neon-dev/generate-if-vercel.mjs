import { spawnSync } from "node:child_process";
import { assertDevelopmentPair } from "./guard.mjs";

if (process.env.VERCEL !== "1") process.exit(0);

const pooled = process.env.NEON_DATABASE_URL || "";
const direct = process.env.NEON_DIRECT_URL || "";
if (process.env.VERCEL_ENV === "production") {
  const productionEndpoint = "ep-weathered-dream-bew7iwf0";
  const developmentEndpoint = "ep-holy-flower-be2hbbj4";
  function endpointOf(raw) {
    return new URL(raw).hostname.split(".")[0].replace(/-pooler$/, "");
  }
  if (endpointOf(pooled) !== productionEndpoint || endpointOf(direct) !== productionEndpoint) {
    console.error("Production 拒绝未确认的数据库端点。");
    process.exit(1);
  }
  if (endpointOf(pooled) === developmentEndpoint) {
    console.error("Production 拒绝 development 连接。");
    process.exit(1);
  }
} else {
  assertDevelopmentPair({ DATABASE_URL: pooled, DIRECT_URL: direct });
}

function withSchema(raw, schema) {
  const url = new URL(raw);
  if (url.searchParams.get("schema") && url.searchParams.get("schema") !== schema) {
    throw new Error("连接串 schema 与隔离空间不一致。");
  }
  url.searchParams.set("schema", schema);
  return url.toString();
}

const env = {
  ...process.env,
  NEON_USER_DATABASE_URL: withSchema(pooled, "lab_phase_h"),
  NEON_USER_DIRECT_URL: direct,
  NEON_AUTH_DATABASE_URL: withSchema(pooled, "lab_phase_h_auth"),
  NEON_AUTH_DIRECT_URL: direct,
};
function visible(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/\bep-[a-z0-9-]+/gi, "[endpoint]");
}

for (const schema of ["prisma-neon-user/schema.prisma", "prisma-neon-auth/schema.prisma"]) {
  const result = spawnSync("npx", ["prisma", "generate", "--schema", schema], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(visible(`${result.stdout || ""}\n${result.stderr || ""}`.trim() || "Prisma 客户端生成失败。"));
    process.exit(result.status || 1);
  }
}
