import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("D:/Projects/English-Listening-Lab");
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
const { ensureLesson, updateSettings, getSettings, rateWord, answerQuestion, presentLesson } = await import("./lessonService.ts");
const { estimateMinutes } = await import("./content.ts");
const { addDays, localISODate } = await import("./content.ts");

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
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
const rated = await rateWord(view.words[0].id, "good", "recall");
check("复习日期晚于现在", new Date(rated.due).getTime() > Date.now() - 1000);
const before = new Date(rated.due).getTime();
const { practiceWord } = await import("./lessonService.ts");
const practiced = await practiceWord(view.words[0].id, "again");
check("提前练习不改变排程", new Date(practiced.due).getTime() === before && practiced.changedSchedule === false);
const formal = await rateWord(view.words[0].id, "easy", "recall");
check("正式复习会更新排程", formal.changedSchedule === true && new Date(formal.due).getTime() !== before);
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
