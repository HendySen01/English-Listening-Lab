// Neon development 的隔离 schema 客户端。
// 连接前必须通过 guard。不读取或改写 public 业务表，也不回退到 SQLite。
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient as NeonAuth } from "./generated/neon-auth/index.js";
import { PrismaClient as NeonUser } from "./generated/neon-user/index.js";
import { assertDevelopmentPair, readDotenv } from "../scripts/neon-dev/guard.mjs";
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
  url.searchParams.set("connection_limit", connectionLimit);
  url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

async function publicCounts(db: { $queryRawUnsafe: (query: string) => Promise<Array<{ n: number }>> }) {
  const names = ["DailyLesson", "Vocabulary", "WordProgress", "ReviewEvent", "ExplanationCache", "AIUsageRecord"];
  const counts: Record<string, number> = {};
  for (const name of names) {
    const rows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."${name}"`);
    counts[name] = rows[0].n;
  }
  return counts;
}

async function ensureStudySessionGuard(db: NeonUser) {
  const before = await publicCounts(db);
  const sqlPath = fileURLToPath(new URL("../prisma-neon-user/migrations/20261123203000_study_session_owner/migration.sql", import.meta.url));
  const sql = fs.readFileSync(sqlPath, "utf8").replace(/^\uFEFF/, "");
  if (!sql.includes(`ON ${businessSchema}."StudySession"`) || /public\s*\./i.test(sql.replace(/^--.*$/gm, ""))) {
    throw new Error("学习记录保护 SQL 没有限定隔离 schema，已停止。");
  }
  const statements = sql.split("-- statement").map((item) => item.replace(/^--.*$/gm, "").trim()).filter(Boolean);
  const applied = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "${businessSchema}"."_prisma_migrations" WHERE migration_name = '${migrationName}' AND rolled_back_at IS NULL`,
  ) as Array<{ n: number }>;
  if (applied[0].n === 0) {
    for (const statement of statements) await db.$executeRawUnsafe(statement);
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    await db.$executeRawUnsafe(
      `INSERT INTO "${businessSchema}"."_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
       VALUES ('${crypto.randomUUID()}', '${checksum}', now(), '${migrationName}', ${statements.length})`,
    );
  }
  const after = await publicCounts(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("隔离保护改动了 public 业务计数，已停止。");
}

export async function openVerifiedPostgres(env = readDotenv(new URL("../.env.neon.development", import.meta.url))) {
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
  await ensureStudySessionGuard(user);
  installPostgresClients({ learner: user, auth });
  return { user, auth, identity };
}
