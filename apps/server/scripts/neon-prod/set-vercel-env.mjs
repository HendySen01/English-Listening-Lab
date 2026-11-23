import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readDotenv } from "../neon-dev/guard.mjs";

const root = path.resolve("D:/Projects/English-Listening-Lab/apps/server");
const repo = path.resolve("D:/Projects/English-Listening-Lab");
const productionEndpoint = "ep-weathered-dream-bew7iwf0";
const neon = readDotenv(path.join(root, ".env.neon.production"));
const local = readDotenv(path.join(root, ".env"));
const pooled = neon.DATABASE_URL || neon.NEON_DATABASE_URL || "";
const direct = neon.DIRECT_URL || neon.NEON_DIRECT_URL || "";
const llmKey = local.DEEPSEEK_API_KEY || local.LLM_API_KEY || "";
const llmBase = local.DEEPSEEK_BASE_URL || local.LLM_BASE_URL || "https://api.deepseek.com";
const llmModel = local.DEEPSEEK_MODEL || local.LLM_MODEL || "deepseek-chat";

function endpointOf(raw) {
  const url = new URL(raw);
  return url.hostname.split(".")[0].replace(/-pooler$/, "");
}

if (!pooled || !direct) throw new Error("production connection file is missing");
if (endpointOf(pooled) !== productionEndpoint || endpointOf(direct) !== productionEndpoint) {
  throw new Error("refusing unexpected production endpoint");
}
if (!llmKey) throw new Error("local DeepSeek key is missing");

const inviteFile = path.join(root, ".invite.production");
const existingInvite = fs.existsSync(inviteFile) ? fs.readFileSync(inviteFile, "utf8").trim() : "";
const invite = existingInvite.length >= 8 ? existingInvite : crypto.randomBytes(24).toString("base64url").replace(/[^A-Za-z0-9]/g, "A").slice(0, 32);
if (!existingInvite) fs.writeFileSync(inviteFile, `${invite}\n`, { encoding: "utf8" });
const secret = crypto.randomBytes(48).toString("base64url");

function add(name, value, sensitive) {
  const args = ["--yes", "vercel", "env", "add", name, "--environment", "production", "--value", value, "--yes", "--project", "english-listening-lab"];
  if (sensitive) args.push("--sensitive");
  else args.push("--no-sensitive");
  const result = spawnSync("npx", args, { cwd: repo, encoding: "utf8", shell: true });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (/Added\s+/.test(text) || /already exists/i.test(text)) return name;
  throw new Error(`failed to set ${name}: ${text.slice(0, 400)}`);
}

const names = [
  add("AUTH_SIGNUP_ENABLED", "1", false),
  add("AUTH_INVITE_CODE", invite, true),
  add("BETTER_AUTH_SECRET", secret, true),
  add("NEON_DATABASE_URL", pooled, true),
  add("NEON_DIRECT_URL", direct, true),
  add("DATABASE_URL", "file:/tmp/lab-prisma-generate.db", false),
  add("AUTH_DATABASE_URL", "file:/tmp/lab-prisma-generate-auth.db", false),
  add("AI_REAL_CALLS", "1", false),
  add("AI_USER_DAILY_LIMIT", "200", false),
  add("AI_SITE_DAILY_LIMIT", "1500", false),
  add("STUDY_TIMEZONE", "Asia/Shanghai", false),
  add("DEEPSEEK_API_KEY", llmKey, true),
  add("DEEPSEEK_BASE_URL", llmBase.replace(/\/$/, ""), true),
  add("DEEPSEEK_MODEL", llmModel, false),
];

console.log(JSON.stringify({
  ok: true,
  project: "english-listening-lab",
  environment: "production",
  endpoint: productionEndpoint,
  names,
  inviteFile: "apps/server/.invite.production",
}));
