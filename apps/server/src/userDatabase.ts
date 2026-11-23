// 多用户业务客户端。只连接明确配置的 user-runtime 副本。
// 缺少配置时直接拒绝，不回退到 data/lab.db。
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "./generated/user/index.js";
import { resolveRuntimeAuthDatabaseUrl } from "./authDatabase.js";
import { dataDir } from "./paths.js";

const runtimeUserFile = /^user-runtime(?:-[a-z0-9-]+)?\.db$/;

export function sqlitePathFromFileUrl(url: string) {
  return decodeURIComponent(url.slice("file:".length).replace(/^\/\//, "").split("?")[0]);
}

export function assertUserDatabaseUrl(url: string) {
  if (!url.startsWith("file:")) throw new Error("多用户业务库只允许本地 SQLite 文件。");
  if (url.toLowerCase().includes("neon") || url.toLowerCase().includes("postgres")) {
    throw new Error("多用户业务库拒绝连接 Neon 或 PostgreSQL。");
  }
  const file = sqlitePathFromFileUrl(url);
  const base = path.basename(file).toLowerCase();
  if (!runtimeUserFile.test(base) || base === "lab.db" || base === "auth.db") {
    throw new Error("多用户业务库文件名必须是 user-runtime 副本。");
  }
  const resolved = path.resolve(file);
  const root = path.resolve(dataDir);
  if (!resolved.startsWith(root + path.sep)) throw new Error("多用户业务库必须位于 data 目录。");
  if (resolved === path.resolve(dataDir, "lab.db") || resolved === path.resolve(dataDir, "auth.db")) {
    throw new Error("多用户业务库拒绝连接真实学习库或认证库。");
  }
}

export function resolveUserDatabaseUrl(env = process.env) {
  const configured = env.USER_DATABASE_URL?.trim() || "";
  if (!configured) throw new Error("缺少 USER_DATABASE_URL，已拒绝连接真实学习库。");
  assertUserDatabaseUrl(configured);
  return configured;
}

export function assertUserRuntimeEnabled(env = process.env) {
  if (env.USER_RUNTIME !== "1") throw new Error("多用户运行时必须显式设置 USER_RUNTIME=1。");
  const userUrl = resolveUserDatabaseUrl(env);
  const authUrl = resolveRuntimeAuthDatabaseUrl(env);
  const userFile = path.resolve(sqlitePathFromFileUrl(userUrl));
  const authFile = path.resolve(sqlitePathFromFileUrl(authUrl));
  if (!fs.existsSync(userFile)) throw new Error("多用户业务库不存在，已拒绝新建或回退。");
  if (!fs.existsSync(authFile)) throw new Error("认证运行库不存在，已拒绝新建或回退到 auth.db。");
  if (userFile === authFile) throw new Error("业务库和认证库不能是同一个文件。");
  return { userUrl, authUrl };
}

const clients = new Map<string, PrismaClient>();

export function getUserPrisma() {
  const url = resolveUserDatabaseUrl();
  const file = path.resolve(sqlitePathFromFileUrl(url));
  if (!fs.existsSync(file)) throw new Error("多用户业务库不存在，已拒绝新建或回退。");
  const existing = clients.get(url);
  if (existing) return existing;
  const client = new PrismaClient({ datasources: { db: { url } } });
  clients.set(url, client);
  return client;
}

export async function disconnectUserPrisma() {
  await Promise.all([...clients.values()].map((client) => client.$disconnect()));
  clients.clear();
}
