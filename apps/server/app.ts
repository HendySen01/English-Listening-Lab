import express from "express";
import previewApp from "./src/vercelPreview.js";

// Vercel 的 Express 构建会优先选择根目录的 app.ts。
// 这个文件只导出受保护的 Preview 入口，避免把 src/app.ts 的单用户应用部署出去。
void express;

export default previewApp;
