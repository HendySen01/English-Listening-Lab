import "dotenv/config";
import fs from "node:fs";
import { createApp } from "./app.js";
import { audioDir, logDir } from "./paths.js";

fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const app = createApp();
const port = Number(process.env.PORT || 8787);
app.listen(port, "127.0.0.1", () => {
  console.log(`server http://127.0.0.1:${port}`);
});
