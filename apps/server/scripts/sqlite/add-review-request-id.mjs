import { DatabaseSync } from "node:sqlite";

export function upgradeReviewRequestId(db) {
  const columns = db.prepare("PRAGMA table_info(ReviewEvent)").all();
  if (!columns.length) throw new Error("ReviewEvent 表不存在，升级已停止。");
  const before = db.prepare("SELECT COUNT(*) AS n FROM ReviewEvent").get().n;
  db.exec("BEGIN");
  try {
    if (!columns.some((column) => column.name === "clientRequestId")) {
      db.exec("ALTER TABLE ReviewEvent ADD COLUMN clientRequestId TEXT");
    }
    const indexes = db.prepare("PRAGMA index_list(ReviewEvent)").all();
    const hasUnique = indexes.some((index) => index.name === "ReviewEvent_clientRequestId_key" && index.unique === 1);
    if (!hasUnique) {
      db.exec('CREATE UNIQUE INDEX "ReviewEvent_clientRequestId_key" ON "ReviewEvent"("clientRequestId")');
    }
    const after = db.prepare("SELECT COUNT(*) AS n FROM ReviewEvent").get().n;
    if (after !== before) throw new Error("升级改变了复习事件数量，已回滚。");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && process.argv[1].endsWith("add-review-request-id.mjs")) {
  const file = process.argv[2];
  if (!file) {
    console.error("需要 SQLite 文件路径。");
    process.exit(1);
  }
  const db = new DatabaseSync(file);
  try {
    upgradeReviewRequestId(db);
  } finally {
    db.close();
  }
}
