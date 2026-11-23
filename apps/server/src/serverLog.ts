import fs from "node:fs";
import { logDir, serverLogPath } from "./paths.js";

export function redactSecrets(text: string) {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/\bfile:(?:\/\/)?\S+/gi, "[redacted-database-url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]");
}

export function reportServerError(error: unknown) {
  const message = error instanceof Error ? error.message : "服务器内部错误";
  const line = `${new Date().toISOString()} ${redactSecrets(message)}\n`;
  console.error(line.trim());
  if (process.env.VERCEL) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(serverLogPath, line);
  } catch (logError) {
    const reason = logError instanceof Error ? logError.message : "无法写日志";
    console.error(redactSecrets(reason));
  }
}
