import path from "node:path";
import { PrismaClient } from "./generated/auth/index.js";
import { dataDir } from "./paths.js";

const allowedFiles = new Set(["auth.db", "auth-selftest.db"]);
const runtimeAuthFile = /^auth-runtime(?:-[a-z0-9-]+)?\.db$/;

export function resolveAuthDatabaseUrl(env = process.env) {
  const configured = env.AUTH_DATABASE_URL?.trim();
  const url = configured || `file:${path.join(dataDir, "auth.db").replace(/\\/g, "/")}`;
  assertAuthDatabaseUrl(url);
  return url;
}

export function assertAuthDatabaseUrl(url: string) {
  if (!url.startsWith("file:")) throw new Error("认证数据库只允许本地 SQLite 文件。");
  const file = sqliteFile(url);
  const base = path.basename(file).toLowerCase();
  const runtimeCopy = runtimeAuthFile.test(base);
  if ((!allowedFiles.has(base) && !runtimeCopy) || file.toLowerCase().includes("lab.db") || url.toLowerCase().includes("neon")) {
    throw new Error("认证数据库必须是 auth.db、auth-selftest.db 或 auth-runtime 副本。");
  }
}

export function resolveRuntimeAuthDatabaseUrl(env = process.env) {
  const configured = env.AUTH_DATABASE_URL?.trim() || "";
  if (!configured) throw new Error("缺少 AUTH_DATABASE_URL，多用户运行时拒绝连接 auth.db。");
  assertAuthDatabaseUrl(configured);
  const file = sqliteFile(configured);
  const base = path.basename(file).toLowerCase();
  if (!runtimeAuthFile.test(base)) throw new Error("多用户运行时的认证库必须是 auth-runtime 副本。");
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(dataDir) + path.sep)) throw new Error("认证运行库必须位于 data 目录。");
  if (path.basename(resolved).toLowerCase() === "auth.db" || path.basename(resolved).toLowerCase() === "lab.db") {
    throw new Error("多用户运行时拒绝连接真实认证库或学习库。");
  }
  return configured;
}

function sqliteFile(url: string) {
  return decodeURIComponent(url.slice("file:".length).replace(/^\/\//, "").split("?")[0]);
}

const clients = new Map<string, PrismaClient>();

export function getAuthPrisma() {
  const url = resolveAuthDatabaseUrl();
  const existing = clients.get(url);
  if (existing) return existing;
  const client = new PrismaClient({ datasources: { db: { url } } });
  clients.set(url, client);
  return client;
}

export async function disconnectAuthPrisma() {
  await Promise.all([...clients.values()].map((client) => client.$disconnect()));
  clients.clear();
}
