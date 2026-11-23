import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { audioDir, previewCachePath, repoRoot } from "./paths.ts";
import { redactSecrets, reportServerError } from "./serverLog.ts";

const root = repoRoot;
const db = path.join(root, "data", "selftest.db");
process.env.DATABASE_URL = `file:${db.replace(/\\/g, "/")}`;
process.env.LLM_API_KEY = "";
process.env.TTS_API_KEY = "";
if (fs.existsSync(db)) fs.rmSync(db);

execSync("npx prisma db push --skip-generate", {
  cwd: path.join(root, "apps/server"),
  env: process.env,
  stdio: "inherit",
});

const { prisma } = await import("./prisma.ts");
const { ensureLesson, updateSettings, getSettings, rateWord, answerQuestion, presentLesson, applyFormalReview, practiceWord } = await import("./lessonService.ts");
const { estimateMinutes } = await import("./content.ts");
const { addDays, localISODate } = await import("./content.ts");

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
}

check("音频目录在项目 data 下", audioDir === path.join(root, "data", "audio"));
check("解析缓存仍在原来的数据文件", previewCachePath === path.join(root, "data", "preview-explanations.json"));
for (const relative of ["index.ts", "app.ts", "previewExplain.ts", "paths.ts"]) {
  const source = fs.readFileSync(new URL(`./${relative}`, import.meta.url), "utf8");
  check(`${relative} 没有写死本机绝对路径`, !source.includes("D:/Projects") && !source.includes("D:\\\\Projects"));
}
const secretUrl = "postgresql://lab:super-secret-password@localhost/neondb";
const redacted = redactSecrets(`connect ${secretUrl} and file:${path.join(root, "data", "lab.db")}`);
check("连接串会被脱敏", redacted.includes("[redacted-database-url]") && !redacted.includes("super-secret-password") && !redacted.includes("lab.db"));
const logMarker = `health-check-${Date.now()}`;
reportServerError(new Error(`${logMarker} ${secretUrl}`));
const serverLog = fs.readFileSync(path.join(root, "logs", "server.log"), "utf8");
check("错误日志不保留连接串", serverLog.includes(logMarker) && serverLog.includes("[redacted-database-url]") && !serverLog.includes("super-secret-password"));

const { createApp } = await import("./app.ts");
const app = createApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = app.listen(0, "127.0.0.1", () => resolve(started));
});
try {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  const body = await response.json() as { ok?: boolean; database?: string };
  const text = JSON.stringify(body);
  check(
    "健康检查只有可用状态",
    response.status === 200 && body.ok === true && body.database === undefined && !text.includes("file:") && !text.includes("postgres"),
  );
  const previousVercel = process.env.VERCEL;
  const previousTtsKey = process.env.TTS_API_KEY;
  const previousTtsBase = process.env.TTS_BASE_URL;
  process.env.VERCEL = "1";
  process.env.TTS_API_KEY = "test-key";
  process.env.TTS_BASE_URL = "https://api.deepseek.com";
  try {
    const ttsResponse = await fetch(`http://127.0.0.1:${port}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", rate: 1, useOnline: true }),
    });
    const ttsBody = await ttsResponse.json() as { mode?: string; url?: string };
    check("部署环境不保存在线音频", ttsResponse.status === 200 && ttsBody.mode === "browser" && ttsBody.url === undefined);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousTtsKey === undefined) delete process.env.TTS_API_KEY;
    else process.env.TTS_API_KEY = previousTtsKey;
    if (previousTtsBase === undefined) delete process.env.TTS_BASE_URL;
    else process.env.TTS_BASE_URL = previousTtsBase;
  }
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const today = localISODate();
const lesson = await ensureLesson(today);
const view = presentLesson(lesson);
check("示范课 6 个词", view.words.length === 6, String(view.words.length));
check("来源是离线示范", view.source === "demo");
check("刷新不新建", (await ensureLesson(today)).id === lesson.id);
const usage = await prisma.aIUsageRecord.count();
check("离线课没有 AI 调用", usage === 0);
for (const word of view.words) {
  check(`${word.lemma} 出现在例句`, word.example.toLowerCase().includes(word.lemma.toLowerCase()));
  check(`${word.lemma} 例句不长`, word.example.split(/\s+/).length <= 14, word.example);
}
const morph = view.words.filter((word) => word.morphology);
check("词根不超过 2 个", morph.length > 0 && morph.length <= 2, String(morph.length));
check(
  "词根确实在词里",
  morph.every((word) => word.lemma.toLowerCase().includes(word.morphology.root.toLowerCase())),
);
check("听力有文本", view.listening.text.length > 40 && view.listening.chunks.length >= 3);
check("答案未提前返回", view.questions.every((question) => question.answerIndex === null));
const first = lesson.questions[0];
const graded = await answerQuestion(first.id, first.answerIndex);
check("提交后有解析", Boolean(graded?.explanationZh && graded.answerIndex === first.answerIndex));
const { AppError } = await import("./errors.ts");
const rated = await rateWord(view.words[0].id, "good", "recall");
check("复习日期晚于现在", new Date(rated.due).getTime() > Date.now() - 1000);
const before = new Date(rated.due).getTime();
const practiced = await practiceWord(view.words[0].id, "again");
check("提前练习不改变排程", new Date(practiced.due).getTime() === before && practiced.changedSchedule === false);
const formal = await rateWord(view.words[0].id, "easy", "recall");
check("正式复习会更新排程", formal.changedSchedule === true && new Date(formal.due).getTime() !== before);
const legacyEvents = await prisma.reviewEvent.count({ where: { clientRequestId: null } });
check("没有请求号的记录仍可留下", legacyEvents >= 2);

const idemWord = view.words[1];
const idemKey = "idem-good-0001";
const idemFirst = await rateWord(idemWord.id, "good", "recall", idemKey);
const idemAgain = await rateWord(idemWord.id, "good", "recall", idemKey);
const idemCount = await prisma.reviewEvent.count({ where: { clientRequestId: idemKey } });
const idemProgress = await prisma.wordProgress.findUnique({ where: { vocabularyId: idemWord.id } });
check(
  "相同请求号只计分一次",
  idemFirst.replayed === false && idemAgain.replayed === true && idemCount === 1 && new Date(idemAgain.due).getTime() === new Date(idemFirst.due).getTime() && idemProgress?.reps === 1,
);
let reused = false;
try {
  await rateWord(idemWord.id, "easy", "recall", idemKey);
} catch (error) {
  reused = error instanceof AppError && error.code === "REQUEST_REUSED";
}
const idemAfterReject = await prisma.reviewEvent.count({ where: { vocabularyId: idemWord.id, mode: "formal" } });
check("同一请求号不能改记另一次评分", reused && idemAfterReject === 1);

const practiceWordId = view.words[2].id;
const practiceBefore = await prisma.wordProgress.findUnique({ where: { vocabularyId: practiceWordId } });
const practiceKey = "practice-again-01";
await practiceWord(practiceWordId, "again", practiceKey);
const practiceReplay = await practiceWord(practiceWordId, "again", practiceKey);
const practiceAfter = await prisma.wordProgress.findUnique({ where: { vocabularyId: practiceWordId } });
const practiceCount = await prisma.reviewEvent.count({ where: { clientRequestId: practiceKey } });
check(
  "重复的提前练习不改变排程",
  practiceReplay.replayed === true && practiceReplay.changedSchedule === false && practiceCount === 1 && practiceAfter?.reps === practiceBefore?.reps && practiceAfter?.due.getTime() === practiceBefore?.due.getTime(),
);

const rollbackWord = view.words[3];
const rollbackBefore = await prisma.wordProgress.findUnique({ where: { vocabularyId: rollbackWord.id } });
const rollbackEvents = await prisma.reviewEvent.count({ where: { vocabularyId: rollbackWord.id } });
let rollbackThrew = false;
try {
  await prisma.$transaction(async (tx) => {
    await applyFormalReview(tx, rollbackWord.id, "good", "recall", "rollback-request-01", false);
    rollbackThrew = true;
    throw new Error("rollback-test");
  });
} catch (error) {
  check("正式复习事务会在失败时回滚", rollbackThrew && error instanceof Error && error.message === "rollback-test");
}
const rollbackAfter = await prisma.wordProgress.findUnique({ where: { vocabularyId: rollbackWord.id } });
const rollbackEventsAfter = await prisma.reviewEvent.count({ where: { vocabularyId: rollbackWord.id } });
check(
  "回滚后进度和事件都保持原样",
  rollbackAfter?.reps === rollbackBefore?.reps && rollbackAfter?.due.getTime() === rollbackBefore?.due.getTime() && rollbackEventsAfter === rollbackEvents,
);

const concurrentWord = view.words[4];
const concurrentBefore = await prisma.wordProgress.findUnique({ where: { vocabularyId: concurrentWord.id } });
await Promise.all([
  rateWord(concurrentWord.id, "again", "recall", "concurrent-again-01"),
  rateWord(concurrentWord.id, "good", "recall", "concurrent-good-001"),
  rateWord(concurrentWord.id, "easy", "recall", "concurrent-easy-001"),
]);
const concurrentAfter = await prisma.wordProgress.findUnique({ where: { vocabularyId: concurrentWord.id } });
const concurrentEvents = await prisma.reviewEvent.count({ where: { vocabularyId: concurrentWord.id, mode: "formal" } });
check(
  "并发评分各保存一次",
  concurrentEvents === 3 && concurrentAfter?.reps === (concurrentBefore?.reps ?? 0) + 3 && concurrentAfter?.correctCount === (concurrentBefore?.correctCount ?? 0) + 2 && concurrentAfter?.incorrectCount === (concurrentBefore?.incorrectCount ?? 0) + 1,
);

let badRequest = false;
try {
  await rateWord(view.words[5].id, "good", "recall", "short");
} catch (error) {
  badRequest = error instanceof AppError && error.status === 400;
}
const untouched = await prisma.reviewEvent.count({ where: { vocabularyId: view.words[5].id } });
check("无效请求号不会写入复习", badRequest && untouched === 0);
check("6 个词的预计时间是 60 分钟", estimateMinutes(6, 0, true) === 60);
check("20 个词明显更久", estimateMinutes(20, 0, true) > estimateMinutes(6, 0, true));

await updateSettings({
  ...(await getSettings()),
  dailyNewWords: 8,
  difficulty: "B1",
  theme: "Education",
  autoGenerate: true,
  wordPartsEnabled: true,
  recommendationsEnabled: true,
});
const tomorrow = addDays(today, 1);
const next = presentLesson(await ensureLesson(tomorrow));
check("下一次课程是 8 个词", next.words.length === 8, String(next.words.length));
check("难度已变成 B1", next.difficulty === "B1");
check("不是同一节课", next.id !== lesson.id);
check("改设置后今天的课不变", (await ensureLesson(today)).newWordCount === 6);
check("第二次生成仍无 AI", (await prisma.aIUsageRecord.count()) === 0);

const report = {
  passed: failures.length === 0,
  failures,
  todayWords: view.words.map((word) => word.lemma),
  nextWords: next.words.map((word) => word.lemma),
};
fs.mkdirSync(path.join(root, "logs"), { recursive: true });
fs.writeFileSync(path.join(root, "logs", "selftest.json"), JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("selftest ok");
