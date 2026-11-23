import "dotenv/config";
import { createUserRuntimeApp } from "./userRuntimeApp.js";
import { openVerifiedPostgres } from "./postgresUserDatabase.js";
import { assertPreviewBoot } from "./previewBoot.js";

const port = Number(process.env.POSTGRES_RUNTIME_PORT || 8798);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8787 || port === 8797) {
  throw new Error("PostgreSQL 运行时需要独立本机端口，不能使用 8787 或 8797。");
}
if (process.env.HOST && process.env.HOST !== "127.0.0.1" && process.env.HOST !== "localhost") {
  throw new Error("PostgreSQL 运行时只监听本机。");
}

await openVerifiedPostgres();
assertPreviewBoot();
const app = createUserRuntimeApp();
app.listen(port, "127.0.0.1", () => {
  console.log(`postgres-runtime http://127.0.0.1:${port}`);
});
