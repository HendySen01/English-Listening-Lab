import fs from "node:fs";
import path from "node:path";

const serverRoot = path.resolve("D:/Projects/English-Listening-Lab/apps/server");
const appEnvPath = path.join(serverRoot, ".env");
const neonEnvPath = path.join(serverRoot, ".env.neon.development");
const sqliteUrl = "file:D:/Projects/English-Listening-Lab/data/lab.db";
const expectedEndpoint = "ep-holy-flower-be2hbbj4";

export function redact(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]")
    .replace(/ep-[a-z0-9-]+(?:-pooler)?\.[a-z0-9.-]*neon\.tech/gi, "[redacted-host]")
    .replace(/\bnpg_[A-Za-z0-9]+\b/g, "[redacted]");
}

export function readDotenv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, index).trim()] = value;
  }
  return env;
}

function endpointOf(raw) {
  const url = new URL(raw);
  const endpoint = url.hostname.split(".")[0].replace(/-pooler$/, "");
  return { url, endpoint, pooler: url.hostname.includes("-pooler") };
}

export function assertDevelopmentPair(env) {
  const pooled = endpointOf(env.DATABASE_URL || "");
  const direct = endpointOf(env.DIRECT_URL || "");
  const problems = [];
  if (pooled.url.protocol !== "postgresql:") problems.push("pooled protocol");
  if (direct.url.protocol !== "postgresql:") problems.push("direct protocol");
  if (pooled.url.pathname !== "/neondb" || direct.url.pathname !== "/neondb") problems.push("database");
  if (!pooled.pooler) problems.push("pooled host missing pooler");
  if (direct.pooler) problems.push("direct host uses pooler");
  if (pooled.endpoint !== direct.endpoint) problems.push("endpoint mismatch");
  if (pooled.endpoint !== expectedEndpoint) problems.push("endpoint is not the confirmed development endpoint");
  if (/production/i.test(pooled.url.hostname) || /production/i.test(direct.url.hostname)) problems.push("production host");
  if (!pooled.url.password || !direct.url.password) problems.push("missing password");
  if (pooled.url.searchParams.get("sslmode") !== "require" || direct.url.searchParams.get("sslmode") !== "require") {
    problems.push("sslmode");
  }
  if (problems.length) {
    throw new Error(`Refusing Neon connection: ${problems.join(", ")}`);
  }
  return { endpoint: pooled.endpoint, database: "neondb" };
}

function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function isolateNeonEnvFromAppEnv() {
  const current = readDotenv(appEnvPath);
  if (String(current.DATABASE_URL || "").startsWith("postgresql:")) {
    assertDevelopmentPair(current);
    fs.writeFileSync(
      neonEnvPath,
      `DATABASE_URL=${quote(current.DATABASE_URL)}\nDIRECT_URL=${quote(current.DIRECT_URL)}\n`,
      { encoding: "utf8" },
    );
    const lines = fs.readFileSync(appEnvPath, "utf8").split(/\r?\n/);
    const next = [];
    let replaced = false;
    for (const line of lines) {
      if (/^\s*DIRECT_URL\s*=/.test(line)) continue;
      if (/^\s*DATABASE_URL\s*=/.test(line)) {
        next.push(`DATABASE_URL="${sqliteUrl}"`);
        replaced = true;
        continue;
      }
      next.push(line);
    }
    if (!replaced) next.unshift(`DATABASE_URL="${sqliteUrl}"`);
    fs.writeFileSync(appEnvPath, next.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").replace(/\n?$/, "\n"));
  }
  if (!fs.existsSync(neonEnvPath)) throw new Error("Missing development connection file");
  const neon = readDotenv(neonEnvPath);
  const identity = assertDevelopmentPair(neon);
  const app = readDotenv(appEnvPath);
  if (!String(app.DATABASE_URL || "").startsWith("file:")) {
    throw new Error("App env is not pointing at the local SQLite file");
  }
  if (app.DIRECT_URL) throw new Error("App env still contains DIRECT_URL");
  return { neon, identity, appDatabase: "sqlite" };
}
