import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../../src/generated/neon/index.js";
import { assertDevelopmentPair, readDotenv, redact } from "./guard.mjs";

const root = path.resolve("D:/Projects/English-Listening-Lab/apps/server");
const env = readDotenv(path.join(root, ".env.neon.development"));
const identity = assertDevelopmentPair(env);
const allowed = new Set(["lab_phase_h", "lab_phase_h_auth"]);

function directUrl(raw) {
  const url = new URL(raw);
  url.searchParams.set("connect_timeout", "30");
  return url.toString();
}

function qualify(sql, schema) {
  if (!allowed.has(schema)) throw new Error("Refusing unexpected PostgreSQL schema");
  return sql
    .replaceAll("CREATE TABLE \"", `CREATE TABLE "${schema}"."`)
    .replaceAll("ALTER TABLE \"", `ALTER TABLE "${schema}"."`)
    .replaceAll(" ON \"", ` ON "${schema}"."`)
    .replaceAll("REFERENCES \"", `REFERENCES "${schema}"."`);
}

function statements(file) {
  return fs.readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\r?\n|$)/)
    .map((item) => item.trim())
    .filter((item) => item && !/^CREATE SCHEMA IF NOT EXISTS "public"$/i.test(item));
}

async function publicSnapshot(prisma) {
  const names = ["UserSettings", "DailyLesson", "Vocabulary", "WordProgress", "QuizQuestion", "QuizAttempt", "StudySession", "ReviewEvent", "AIUsageRecord", "ExplanationCache"];
  const counts = {};
  for (const name of names) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."${name}"`);
    counts[name] = rows[0].n;
  }
  const migrations = await prisma.$queryRaw`SELECT migration_name FROM public."_prisma_migrations" ORDER BY migration_name`;
  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  return { counts, migrations, tables };
}

async function applySchema(connection, schema, sqlFile) {
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl(connection) } } });
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const existing = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '_prisma_migrations'`,
    );
    if (existing[0].n > 0) {
      const applied = await prisma.$queryRawUnsafe(`SELECT migration_name FROM "${schema}"."_prisma_migrations"`);
      if (applied.some((row) => row.migration_name === "20261123194500_init")) return "already-applied";
    }
    const sql = statements(sqlFile).map((statement) => qualify(statement, schema));
    const checksum = crypto.createHash("sha256").update(fs.readFileSync(sqlFile)).digest("hex");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${schema}"."_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )
    `);
    for (const statement of sql) await prisma.$executeRawUnsafe(statement);
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
       VALUES ('${id}', '${checksum}', now(), '20261123194500_init', ${sql.length})`,
    );
    return "applied";
  } finally {
    await prisma.$disconnect();
  }
}

const publicClient = new PrismaClient({ datasources: { db: { url: directUrl(env.DIRECT_URL) } } });
try {
  const before = await publicSnapshot(publicClient);
  const userSql = path.join(root, "prisma-neon-user", "migrations", "20261123194500_init", "migration.sql");
  const authSql = path.join(root, "prisma-neon-auth", "migrations", "20261123194500_init", "migration.sql");
  const user = await applySchema(env.DIRECT_URL, "lab_phase_h", userSql);
  const auth = await applySchema(env.DIRECT_URL, "lab_phase_h_auth", authSql);
  const after = await publicSnapshot(publicClient);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("public schema changed while applying the isolated schemas");
  }
  const located = await publicClient.$queryRaw`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name IN ('Learner', 'AiCharge', 'user', 'session')
    ORDER BY table_schema, table_name`;
  console.log(JSON.stringify({ ok: true, identity, user, auth, located, publicUnchanged: true }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: redact(error?.message || error) }));
  process.exitCode = 1;
} finally {
  await publicClient.$disconnect();
}
