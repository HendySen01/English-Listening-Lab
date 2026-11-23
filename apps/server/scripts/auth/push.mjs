import { execSync } from "node:child_process";
import path from "node:path";

const url = process.env.AUTH_DATABASE_URL?.trim() || "";
const file = decodeURIComponent(url.slice("file:".length).replace(/^\/\//, "").split("?")[0]);
const base = path.basename(file).toLowerCase();
if (!url.startsWith("file:") || (base !== "auth.db" && base !== "auth-selftest.db") || url.toLowerCase().includes("lab.db")) {
  console.error("拒绝：认证表只能写入 auth.db 或 auth-selftest.db。");
  process.exit(1);
}

execSync("npx prisma db push --schema prisma-auth/schema.prisma --skip-generate", {
  stdio: "inherit",
  env: process.env,
});
