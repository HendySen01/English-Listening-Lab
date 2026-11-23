import path from "node:path";
import { PrismaClient } from "./generated/auth/index.js";
import { dataDir } from "./paths.js";

const allowedFiles = new Set(["auth.db", "auth-selftest.db"]);

export function resolveAuthDatabaseUrl(env = process.env) {
  const configured = env.AUTH_DATABASE_URL?.trim();
  const url = configured || `file:${path.join(dataDir, "auth.db").replace(/\\/g, "/")}`;
  assertAuthDatabaseUrl(url);
  return url;
}

export function assertAuthDatabaseUrl(url: string) {
  if (!url.startsWith("file:")) throw new Error("认证数据库只允许本地 SQLite 文件。");
  const file = decodeURIComponent(url.slice("file:".length).replace(/^\/\//, "").split("?")[0]);
  const base = path.basename(file).toLowerCase();
  if (!allowedFiles.has(base) || file.toLowerCase().includes("lab.db") || url.toLowerCase().includes("neon")) {
    throw new Error("认证数据库必须是 auth.db 或 auth-selftest.db。");
  }
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
