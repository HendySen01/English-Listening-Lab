import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(sourceDir, "../../..");
export const dataDir = path.join(repoRoot, "data");
export const audioDir = path.join(dataDir, "audio");
export const logDir = path.join(repoRoot, "logs");
export const serverLogPath = path.join(logDir, "server.log");
export const previewCachePath = path.join(dataDir, "preview-explanations.json");
