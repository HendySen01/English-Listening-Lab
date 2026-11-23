import path from "node:path";
import { PrismaClient } from "../../src/generated/neon/index.js";
import { readDotenv, redact } from "../neon-dev/guard.mjs";

const root = path.resolve("D:/Projects/English-Listening-Lab/apps/server");
const developmentEndpoint = "ep-holy-flower-be2hbbj4";
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

if (!pooled || !direct) {
  console.log(JSON.stringify({ ok: false, error: "production connection file is missing or incomplete" }));
  process.exit(1);
}

const pooledId = identityOf(pooled);
const directId = identityOf(direct);
if (pooledId.endpoint === developmentEndpoint || directId.endpoint === developmentEndpoint) {
  console.log(JSON.stringify({ ok: false, error: "refusing development endpoint" }));
  process.exit(1);
}
if (pooledId.endpoint !== directId.endpoint || pooledId.database !== "/neondb" || directId.database !== "/neondb" || !pooledId.pooler || directId.pooler) {
  console.log(JSON.stringify({ ok: false, error: "production connection pair is not usable" }));
  process.exit(1);
}

const url = new URL(direct);
url.searchParams.set("connect_timeout", "30");
url.searchParams.set("connection_limit", "1");
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
try {
  await db.$executeRawUnsafe("SET default_transaction_read_only = on");
  const schemas = await db.$queryRawUnsafe(`
    SELECT n.nspname AS schema, COUNT(c.oid)::int AS tables
    FROM pg_namespace n
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind = 'r'
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
    GROUP BY n.nspname
    ORDER BY n.nspname`);
  const migrationTables = await db.$queryRawUnsafe(`
    SELECT table_schema
    FROM information_schema.tables
    WHERE table_name = '_prisma_migrations'`);
  const names = [];
  for (const row of migrationTables) {
    const applied = await db.$queryRawUnsafe(`SELECT migration_name FROM "${row.table_schema}"."_prisma_migrations" ORDER BY migration_name`);
    names.push({ schema: row.table_schema, migrations: applied.map((item) => item.migration_name) });
  }
  console.log(JSON.stringify({
    ok: true,
    endpoint: pooledId.endpoint,
    sameAsDevelopment: false,
    database: "neondb",
    ssl: pooledId.ssl === "require" && directId.ssl === "require",
    configuredSchema: pooledId.schema || directId.schema || "(unset)",
    schemas,
    migrationTables: names,
  }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: redact(error?.message || error) }));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
