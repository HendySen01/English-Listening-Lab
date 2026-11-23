import { assertProductionBoot } from "./productionBoot.ts";
import { assertLocalServerAllowed, assertPreviewBoot } from "./previewBoot.ts";

const failures: string[] = [];
function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`通过 ${name}`);
}

check("[启动] 本地 SQLite 入口保持可用", assertPreviewBoot({}) .mode === "local-sqlite");

let localRejected = "";
try {
  assertLocalServerAllowed({ VERCEL: "1" });
} catch (error) {
  localRejected = error instanceof Error ? error.message : "";
}
check("[启动] Vercel 不能走本地 SQLite 入口", localRejected.includes("Vercel"));

let postgresOnSqlite = "";
try {
  assertLocalServerAllowed({ POSTGRES_RUNTIME: "1" });
} catch (error) {
  postgresOnSqlite = error instanceof Error ? error.message : "";
}
check("[启动] SQLite 入口拒绝 PostgreSQL 模式", postgresOnSqlite.includes("PostgreSQL"));

const development = {
  NEON_DATABASE_URL: "postgresql://user:secret@ep-holy-flower-be2hbbj4-pooler.neon.tech/neondb?sslmode=require",
  NEON_DIRECT_URL: "postgresql://user:secret@ep-holy-flower-be2hbbj4.neon.tech/neondb?sslmode=require",
  USER_DATABASE_URL: "postgresql://user:secret@ep-holy-flower-be2hbbj4-pooler.neon.tech/neondb?sslmode=require&schema=lab_phase_h",
  AUTH_DATABASE_URL: "postgresql://user:secret@ep-holy-flower-be2hbbj4-pooler.neon.tech/neondb?sslmode=require&schema=lab_phase_h_auth",
  BETTER_AUTH_SECRET: "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2",
  POSTGRES_RUNTIME: "1",
};
check("[启动] 隔离 development 配置可以通过启动检查", assertPreviewBoot(development).database === "neondb");

function rejected(env: Record<string, string>) {
  try {
    assertPreviewBoot(env);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "error";
  }
}
check("[启动] 缺少密钥时拒绝", rejected({ ...development, BETTER_AUTH_SECRET: "" }).includes("密钥"));
check("[启动] public schema 被拒绝", rejected({ ...development, USER_DATABASE_URL: development.USER_DATABASE_URL.replace("lab_phase_h", "public") }).includes("业务库"));
check("[启动] SQLite 文件被拒绝", rejected({ ...development, USER_DATABASE_URL: "file:./data/lab.db" }).includes("SQLite"));
check("[启动] production 主机被拒绝", rejected({
  ...development,
  NEON_DATABASE_URL: "postgresql://user:secret@production.example/neondb?sslmode=require",
  NEON_DIRECT_URL: "postgresql://user:secret@production.example/neondb?sslmode=require",
}).includes("Refusing"));
check("[启动] 携带付费模型密钥被拒绝", rejected({ ...development, DEEPSEEK_API_KEY: "sk-test" }).includes("付费"));
check("[启动] 打开公开注册被拒绝", rejected({ ...development, AUTH_SIGNUP: "open" }).includes("注册"));
check("[启动] Preview 可以单独启用注册开关", assertPreviewBoot({
  ...development,
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "english-listening-lab-preview.vercel.app",
  AUTH_SIGNUP_ENABLED: "1",
}).mode === "postgres-guarded");
check("[启动] Production 环境被拒绝", rejected({ ...development, VERCEL: "1", VERCEL_ENV: "production", BETTER_AUTH_URL: "https://lab.example" }).includes("Production"));
check("[启动] Preview 缺少 https 域名被拒绝", rejected({ ...development, VERCEL: "1", VERCEL_ENV: "preview", BETTER_AUTH_URL: "http://lab.example" }).includes("https"));
check("[启动] Preview 使用平台域名", assertPreviewBoot({
  ...development,
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "english-listening-lab-preview.vercel.app",
}).mode === "postgres-guarded");
check("[启动] Preview 拒绝其他域名", rejected({
  ...development,
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "english-listening-lab-preview.vercel.app",
  BETTER_AUTH_URL: "https://production.example",
}).includes("一致"));
check("[启动] 本机模拟可以使用回环地址", assertPreviewBoot({
  ...development,
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_SIMULATION: "1",
  BETTER_AUTH_URL: "http://127.0.0.1:8798",
}).mode === "postgres-guarded");

const production = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  BETTER_AUTH_SECRET: "production-secret-production-secret-32",
  VERCEL_URL: "english-listening-lab-senberto.vercel.app",
  NEON_DATABASE_URL: "postgresql://user:secret@ep-weathered-dream-bew7iwf0-pooler.neon.tech/neondb?sslmode=require",
  NEON_DIRECT_URL: "postgresql://user:secret@ep-weathered-dream-bew7iwf0.neon.tech/neondb?sslmode=require",
};
check("[启动] Production 拒绝 development 连接", (() => {
  try {
    assertProductionBoot({ ...production, NEON_DATABASE_URL: "postgresql://user:secret@ep-holy-flower-be2hbbj4-pooler.neon.tech/neondb?sslmode=require", NEON_DIRECT_URL: "postgresql://user:secret@ep-holy-flower-be2hbbj4.neon.tech/neondb?sslmode=require" });
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("development");
  }
})());
check("[启动] Production 没有邀请码时不能开放注册", (() => {
  try {
    assertProductionBoot({ ...production, AUTH_SIGNUP_ENABLED: "1" });
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("邀请码");
  }
})());
check("[启动] Production 有邀请码时可以通过启动检查", assertProductionBoot({ ...production, AUTH_SIGNUP_ENABLED: "1", AUTH_INVITE_CODE: "invite-test-24" }).mode === "production-guarded");
check("[启动] Production 拒绝未知端点", (() => {
  try {
    assertProductionBoot({
      ...production,
      NEON_DATABASE_URL: "postgresql://user:secret@ep-other-pooler.neon.tech/neondb?sslmode=require",
      NEON_DIRECT_URL: "postgresql://user:secret@ep-other.neon.tech/neondb?sslmode=require",
    });
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("confirmed production");
  }
})());

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("preview boot ok");
