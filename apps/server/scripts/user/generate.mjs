import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.USER_DATABASE_URL?.trim()) {
  const placeholder = path.join(serverRoot, "../../data/user-runtime-client-only.db");
  process.env.USER_DATABASE_URL = `file:${placeholder.replace(/\\/g, "/")}`;
}

execSync("npx prisma generate --schema prisma-user/schema.prisma", {
  cwd: serverRoot,
  stdio: "inherit",
  env: process.env,
});
