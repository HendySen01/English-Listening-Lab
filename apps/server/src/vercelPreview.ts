// Vercel Preview 的唯一 API 入口。只挂多用户 PostgreSQL 路由。
// 这里不监听端口，不读取本地凭据文件，也不执行数据库迁移。
import express from "express";
import { assertPreviewBoot } from "./previewBoot.js";
import { openVerifiedPostgres, openVerifiedProduction, stagePreviewDatabaseUrls } from "./postgresUserDatabase.js";
import { createUserRuntimeApp } from "./userRuntimeApp.js";

if (process.env.VERCEL !== "1") throw new Error("预览入口只能在 Vercel 或本地模拟中启动。");
if (process.env.VERCEL_ENV === "production") {
  await openVerifiedProduction();
} else {
  stagePreviewDatabaseUrls();
  const boot = assertPreviewBoot();
  if (boot.mode !== "postgres-guarded") throw new Error("预览入口拒绝单用户 SQLite。");
  const pooled = process.env.NEON_DATABASE_URL || "";
  const direct = process.env.NEON_DIRECT_URL || "";
  await openVerifiedPostgres({ DATABASE_URL: pooled, DIRECT_URL: direct });
}

const app = createUserRuntimeApp({ platform: "vercel" });
app.use((_req, res) => {
  res.status(404).json({ error: "找不到资源", code: "NOT_FOUND" });
});

export default app;
export { express };
