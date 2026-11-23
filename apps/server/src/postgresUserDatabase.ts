// Neon development 的隔离 schema 客户端。
// 连接前必须通过 guard。启动只做只读核对，不执行迁移，也不回退到 SQLite。
import { PrismaClient as NeonAuth } from "./generated/neon-auth/index.js";
import { PrismaClient as NeonUser } from "./generated/neon-user/index.js";
import { assertDevelopmentPair, readDotenv } from "../scripts/neon-dev/guard.mjs";
import { assertProductionBoot } from "./productionBoot.js";
import { installPostgresClients } from "./runtimeClients.js";

const businessSchema = "lab_phase_h";
const authSchema = "lab_phase_h_auth";
const migrationName = "20261123203000_study_session_owner";

function phaseUrl(raw: string, schema: string, connectionLimit: string) {
  if (schema !== businessSchema && schema !== authSchema) throw new Error("拒绝未授权的 PostgreSQL schema。");
  const url = new URL(raw);
  if (url.searchParams.get("schema") && url.searchParams.get("schema") !== schema) {
    throw new Error("连接串里的 schema 与隔离空间不一致，已拒绝连接。");
  }
  url.searchParams.delete("options");
  url.searchParams.set("schema", schema);
  url.searchParams.set("connect_timeout", "30");
  url.searchParams.set("connection_limit", process.env.VERCEL === "1" ? "1" : connectionLimit);
  url.searchParams.set("pool_timeout", "20");
  if (process.env.VERCEL === "1") url.searchParams.set("pgbouncer", "true");
  return url.toString();
}

async function assertStudySessionGuard(db: NeonUser) {
  const applied = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "${businessSchema}"."_prisma_migrations" WHERE migration_name = '${migrationName}' AND rolled_back_at IS NULL`,
  ) as Array<{ n: number }>;
  const trigger = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.triggers
     WHERE event_object_schema = '${businessSchema}' AND event_object_table = 'StudySession'
     AND trigger_name = 'study_session_same_user_insert'`,
  ) as Array<{ n: number }>;
  const publicMigrations = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`,
  ) as Array<{ n: number }>;
  const leaked = publicMigrations[0].n === 0
    ? [{ n: 0 }]
    : await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM public."_prisma_migrations" WHERE migration_name = '${migrationName}'`,
    ) as Array<{ n: number }>;
  if (leaked[0].n !== 0) throw new Error("public 出现隔离迁移记录，已拒绝启动。");
  if (applied[0].n < 1 || trigger[0].n < 1) {
    throw new Error("StudySession 跨用户约束尚未在隔离 schema 执行。启动不会自动迁移。");
  }
}

export function stagePreviewDatabaseUrls(env: NodeJS.ProcessEnv = process.env) {
  const pooled = env.NEON_DATABASE_URL || "";
  const direct = env.NEON_DIRECT_URL || "";
  if (!pooled || !direct) throw new Error("缺少已核验的 development 连接，已拒绝启动。");
  assertDevelopmentPair({ DATABASE_URL: pooled, DIRECT_URL: direct });
  env.USER_DATABASE_URL = phaseUrl(pooled, businessSchema, "4");
  env.AUTH_DATABASE_URL = phaseUrl(pooled, authSchema, "1");
}

type NeonPair = { DATABASE_URL: string; DIRECT_URL: string };

export async function openVerifiedPostgres(source?: NeonPair) {
  if (process.env.VERCEL === "1" && !source) throw new Error("Vercel 不能读取本地凭据文件。");
  const fileEnv = readDotenv(new URL("../.env.neon.development", import.meta.url)) as Partial<NeonPair>;
  const env: NeonPair = source ?? {
    DATABASE_URL: fileEnv.DATABASE_URL || "",
    DIRECT_URL: fileEnv.DIRECT_URL || "",
  };
  const identity = assertDevelopmentPair(env);
  process.env.POSTGRES_RUNTIME = "1";
  process.env.NEON_DATABASE_URL = env.DATABASE_URL;
  process.env.NEON_DIRECT_URL = env.DIRECT_URL;
  process.env.USER_DATABASE_URL = phaseUrl(env.DATABASE_URL, businessSchema, "4");
  process.env.AUTH_DATABASE_URL = phaseUrl(env.DATABASE_URL, authSchema, "1");
  const user = new NeonUser({ datasources: { db: { url: process.env.USER_DATABASE_URL } } });
  const auth = new NeonAuth({ datasources: { db: { url: process.env.AUTH_DATABASE_URL } } });
  const located = await user.$queryRawUnsafe(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_name = 'Learner' AND table_schema IN ('${businessSchema}', 'public')`,
  ) as Array<{ table_schema: string; table_name: string }>;
  if (located.some((row) => row.table_schema === "public")) throw new Error("public 中出现 Learner，已拒绝继续。");
  if (!located.some((row) => row.table_schema === businessSchema)) throw new Error("隔离业务表不存在，已拒绝新建或改用 public。");
  const authTable = await auth.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = '${authSchema}' AND table_name = 'user'`,
  ) as Array<{ n: number }>;
  if (authTable[0].n !== 1) throw new Error("隔离认证表不存在，已拒绝连接 public。");
  await assertStudySessionGuard(user);
  installPostgresClients({ learner: user, auth });
  return { user, auth, identity };
}

export async function openVerifiedProduction() {
  const identity = assertProductionBoot();
  const pooled = process.env.NEON_DATABASE_URL || "";
  process.env.POSTGRES_RUNTIME = "1";
  process.env.USER_DATABASE_URL = phaseUrl(pooled, businessSchema, "4");
  process.env.AUTH_DATABASE_URL = phaseUrl(pooled, authSchema, "1");
  const user = new NeonUser({ datasources: { db: { url: process.env.USER_DATABASE_URL } } });
  const auth = new NeonAuth({ datasources: { db: { url: process.env.AUTH_DATABASE_URL } } });
  const located = await user.$queryRawUnsafe(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_name = 'Learner' AND table_schema IN ('${businessSchema}', 'public')`,
  ) as Array<{ table_schema: string; table_name: string }>;
  if (located.some((row) => row.table_schema === "public")) throw new Error("public 中出现 Learner，已拒绝继续。");
  if (!located.some((row) => row.table_schema === businessSchema)) throw new Error("Production 隔离业务表不存在。启动不会自动迁移。");
  const authTable = await auth.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = '${authSchema}' AND table_name = 'user'`,
  ) as Array<{ n: number }>;
  if (authTable[0].n !== 1) throw new Error("Production 隔离认证表不存在。启动不会自动迁移。");
  await assertStudySessionGuard(user);
  installPostgresClients({ learner: user, auth });
  return { user, auth, identity };
}
