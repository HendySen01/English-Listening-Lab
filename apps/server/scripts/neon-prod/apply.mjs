import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../../src/generated/neon/index.js";
import { readDotenv, redact } from "../neon-dev/guard.mjs";

const root = path.resolve("D:/Projects/English-Listening-Lab/apps/server");
const productionEndpoint = "ep-weathered-dream-bew7iwf0";
const allowed = new Set(["lab_phase_h", "lab_phase_h_auth"]);
const env = readDotenv(path.join(root, ".env.neon.production"));
const pooled = env.DATABASE_URL || env.NEON_DATABASE_URL || "";
const direct = env.DIRECT_URL || env.NEON_DIRECT_URL || "";

function identityOf(raw) {
  const url = new URL(raw);
  return {
    endpoint: url.hostname.split(".")[0].replace(/-pooler$/, ""),
    pooler: url.hostname.includes("-pooler"),
    database: url.pathname,
    ssl: url.searchParams.get("sslmode") || "",
    schema: url.searchParams.get("schema") || "",
  };
}

function directUrl(raw) {
  const url = new URL(raw);
  url.searchParams.set("connect_timeout", "30");
  url.searchParams.set("connection_limit", "1");
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
  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  const counts = {};
  for (const row of tables) {
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."${row.table_name}"`);
    counts[row.table_name] = result[0].n;
  }
  return { tables: tables.map((row) => row.table_name), counts };
}

async function applyInit(connection, schema, sqlFile) {
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

async function applyOwner(connection) {
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl(connection) } } });
  const schema = "lab_phase_h";
  const name = "20261123203000_study_session_owner";
  const sqlFile = path.join(root, "prisma-neon-user", "migrations", name, "migration.sql");
  try {
    const applied = await prisma.$queryRawUnsafe(`SELECT migration_name FROM "${schema}"."_prisma_migrations"`);
    if (applied.some((row) => row.migration_name === name)) return "already-applied";
    const leaked = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`);
    if (leaked[0].n > 0) {
      const publicApplied = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."_prisma_migrations" WHERE migration_name = '${name}'`);
      if (publicApplied[0].n > 0) throw new Error("owner migration already exists in public");
    }
    const ownerSql = fs.readFileSync(sqlFile, "utf8")
      .replace(/^\uFEFF/, "")
      .split(/-- statement/)
      .map((item) => item.trim())
      .filter((item) => item && !item.startsWith("-- Isolated"));
    for (const statement of ownerSql) await prisma.$executeRawUnsafe(statement.replace(/;+\s*$/, ""));
    const checksum = crypto.createHash("sha256").update(fs.readFileSync(sqlFile)).digest("hex");
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
       VALUES ('${id}', '${checksum}', now(), '${name}', 4)`,
    );
    return "applied";
  } finally {
    await prisma.$disconnect();
  }
}

if (!pooled || !direct) {
  console.log(JSON.stringify({ ok: false, error: "production connection file is missing" }));
  process.exit(1);
}
const pooledId = identityOf(pooled);
const directId = identityOf(direct);
if (pooledId.endpoint !== productionEndpoint || directId.endpoint !== productionEndpoint) {
  console.log(JSON.stringify({ ok: false, error: "refusing unexpected production endpoint" }));
  process.exit(1);
}
if (pooledId.database !== "/neondb" || directId.database !== "/neondb" || !pooledId.pooler || directId.pooler || pooledId.schema === "public" || directId.schema === "public") {
  console.log(JSON.stringify({ ok: false, error: "production connection pair is not usable" }));
  process.exit(1);
}

const publicClient = new PrismaClient({ datasources: { db: { url: directUrl(direct) } } });
try {
  const before = await publicSnapshot(publicClient);
  const userSql = path.join(root, "prisma-neon-user", "migrations", "20261123194500_init", "migration.sql");
  const authSql = path.join(root, "prisma-neon-auth", "migrations", "20261123194500_init", "migration.sql");
  const user = await applyInit(direct, "lab_phase_h", userSql);
  const auth = await applyInit(direct, "lab_phase_h_auth", authSql);
  const owner = await applyOwner(direct);
  const after = await publicSnapshot(publicClient);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("public schema changed while applying the isolated schemas");
  }
  const located = await publicClient.$queryRaw`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name IN ('Learner', 'AiCharge', 'user', 'session')
    ORDER BY table_schema, table_name`;
  const trigger = await publicClient.$queryRaw`
    SELECT COUNT(*)::int AS n FROM information_schema.triggers
    WHERE event_object_schema = 'lab_phase_h' AND trigger_name = 'study_session_same_user_insert'`;
  console.log(JSON.stringify({
    ok: true,
    endpoint: productionEndpoint,
    database: "neondb",
    user,
    auth,
    owner,
    located,
    trigger: trigger[0].n,
    publicUnchanged: true,
    publicTables: after.tables,
  }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: redact(error?.message || error) }));
  process.exitCode = 1;
} finally {
  await publicClient.$disconnect();
}
