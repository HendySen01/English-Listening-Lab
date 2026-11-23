import { PrismaClient } from "../../src/generated/neon/index.js";
import { assertDevelopmentPair, readDotenv, redact } from "./guard.mjs";

const env = readDotenv(new URL("../../.env.neon.development", import.meta.url));
const identity = assertDevelopmentPair(env);

function withTimeout(raw) {
  const url = new URL(raw);
  url.searchParams.set("connect_timeout", "30");
  return url.toString();
}

async function connect(label, raw) {
  const prisma = new PrismaClient({ datasources: { db: { url: withTimeout(raw) } } });
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1 AS ok`;
      return prisma;
    } catch (error) {
      last = error;
      await prisma.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`${label} connection failed: ${redact(last?.message || last)}`);
}

const prisma = await connect("development", env.DIRECT_URL);

try {
  const schemas = await prisma.$queryRaw`
    SELECT nspname AS schema
    FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
    ORDER BY nspname`;
  const tables = await prisma.$queryRaw`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name`;
  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count
    FROM "_prisma_migrations"
    ORDER BY started_at`;
  const counts = await prisma.$queryRaw`
    SELECT relname AS name, reltuples::bigint AS estimate
    FROM pg_class
    WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
    ORDER BY relname`;
  const exact = {};
  for (const name of ["DailyLesson", "Vocabulary", "WordProgress", "ReviewEvent", "QuizQuestion", "QuizAttempt", "StudySession", "AIUsageRecord", "ExplanationCache", "UserSettings"]) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${name}"`);
    exact[name] = rows[0].n;
  }
  const due = await prisma.$queryRaw`
    SELECT data_type, datetime_precision
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'WordProgress' AND column_name = 'due'`;
  const reviewFk = await prisma.$queryRaw`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public."ReviewEvent"'::regclass AND contype = 'f'`;
  const cache = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE "schemaVersion" IS NOT NULL)::int AS versioned
    FROM "ExplanationCache"`;
  console.log(JSON.stringify({
    ok: true,
    identity,
    schemas,
    tables,
    migrations,
    estimates: counts,
    exact,
    due,
    reviewForeignKeys: reviewFk,
    cache,
  }, (_, value) => typeof value === "bigint" ? Number(value) : value, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: redact(error?.message || error) }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
