import { execSync } from "node:child_process";
import path from "node:path";

const url = process.env.AUTH_DATABASE_URL?.trim() || "";
const file = decodeURIComponent(url.slice("file:".length).replace(/^\/\//, "").split("?")[0]);
const base = path.basename(file).toLowerCase();
const allowed = base === "auth.db" || base === "auth-selftest.db" || /^auth-runtime(?:-[a-z0-9-]+)?\.db$/.test(base);
if (!url.startsWith("file:") || !allowed || url.toLowerCase().includes("lab.db") || url.toLowerCase().includes("neon")) {
  console.error("拒绝：认证表只能写入 auth.db、auth-selftest.db 或 auth-runtime 副本。");
  process.exit(1);
}

execSync("npx prisma db push --schema prisma-auth/schema.prisma --skip-generate", {
  stdio: "inherit",
  env: process.env,
});
