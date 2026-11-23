import "dotenv/config";
import { createUserRuntimeApp } from "./userRuntimeApp.js";
import { assertUserRuntimeEnabled } from "./userDatabase.js";

assertUserRuntimeEnabled();
const port = Number(process.env.USER_RUNTIME_PORT || 8797);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8787) {
  throw new Error("多用户运行时需要独立端口，不能使用 8787。");
}

const app = createUserRuntimeApp();
app.listen(port, "127.0.0.1", () => {
  console.log(`user-runtime http://127.0.0.1:${port}`);
});
