import fs from "node:fs";
import { readDotenv } from "../scripts/neon-dev/guard.mjs";
import { databaseStamp, labDatabasePath, authDatabasePath } from "../scripts/sqlite/assign-learner-ownership.mjs";
import { createPrivateTestAccount } from "./auth.ts";
import { setPaidAiMock } from "./learnerAiGuard.ts";

const source = fs.readFileSync(new URL("./vercelPreview.ts", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const detectedSource = fs.readFileSync(new URL("../app.ts", import.meta.url), "utf8");
const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(detail ? `${name} :: ${detail}` : name);
  else console.log(`通过 ${name}`);
}
check("[入口] 预览入口不挂载旧的单用户应用", !source.includes("createApp") && !source.includes("listen(") && !source.includes("migrate"));
check("[入口] 8787 入口不引用预览应用", indexSource.includes("8787") && !indexSource.includes("vercelPreview"));
check("[入口] Express 优先选择预览入口", detectedSource.includes('from "./src/vercelPreview.js"') && detectedSource.includes('import express'));

const envFile = readDotenv(new URL("../.env.neon.development", import.meta.url));
function withSchema(raw: string, schema: string) {
  const url = new URL(raw);
  url.searchParams.set("schema", schema);
  url.searchParams.set("sslmode", "require");
  return url.toString();
}
process.env.VERCEL = "1";
process.env.VERCEL_ENV = "preview";
process.env.VERCEL_SIMULATION = "1";
process.env.POSTGRES_RUNTIME = "1";
process.env.NEON_DATABASE_URL = envFile.DATABASE_URL;
process.env.NEON_DIRECT_URL = envFile.DIRECT_URL;
process.env.USER_DATABASE_URL = withSchema(envFile.DATABASE_URL, "lab_phase_h");
process.env.AUTH_DATABASE_URL = withSchema(envFile.DATABASE_URL, "lab_phase_h_auth");
process.env.BETTER_AUTH_SECRET = "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8798";
process.env.AUTH_SELFTEST = "1";
process.env.AI_SITE_DAILY_LIMIT = "1";
process.env.AI_USER_DAILY_LIMIT = "200";
delete process.env.DEEPSEEK_API_KEY;

const { default: app } = await import("./vercelPreview.ts");
const { learnerDb, authDb } = await import("./runtimeClients.ts");
const user = learnerDb();
const auth = authDb();
const labBefore = databaseStamp(labDatabasePath);
const authBefore = databaseStamp(authDatabasePath);
async function publicCounts() {
  const names = ["DailyLesson", "Vocabulary", "WordProgress", "ReviewEvent", "ExplanationCache"];
  const counts: Record<string, number> = {};
  for (const name of names) {
    const rows = await user.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."${name}"`) as Array<{ n: number }>;
    counts[name] = rows[0].n;
  }
  return counts;
}
const beforePublic = await publicCounts();

await user.reviewEvent.deleteMany({});
await user.aiCharge.deleteMany({});
await user.quizAttempt.deleteMany({});
await user.studySession.deleteMany({});
await user.wordProgress.deleteMany({});
await user.quizQuestion.deleteMany({});
await user.vocabulary.deleteMany({});
await user.dailyLesson.deleteMany({});
await user.userSettings.deleteMany({});
await user.learner.deleteMany({});
await auth.session.deleteMany({});
await auth.account.deleteMany({});
await auth.user.deleteMany({});
await auth.rateLimit.deleteMany({});

const createdAt = new Date("2026-05-01T00:00:00.000Z");
const due = new Date("2026-04-01T03:04:05.000Z");
setPaidAiMock(() => undefined);
const accountA = await createPrivateTestAccount({ email: "vercel-a@lab.test", password: "vercel-a-pass-1844", name: "Vercel A" });
const accountB = await createPrivateTestAccount({ email: "vercel-b@lab.test", password: "vercel-b-pass-2755", name: "Vercel B" });
async function seed(id: string, authUserId: string) {
  await user.learner.create({ data: { id, authUserId, boundAt: createdAt, createdAt } });
  await user.userSettings.create({
    data: {
      id: `settings_${id}`, userId: id, dailyNewWords: 8, difficulty: "A2", listeningLevel: "match", dailyMinutes: 60,
      theme: "Daily Life", customTheme: "", autoGenerate: true, ttsVoice: "en-US", speechRate: 1, locale: "zh-CN",
      colorMode: "system", wordPartsEnabled: true, recommendationsEnabled: true, updatedAt: createdAt,
    },
  });
  await user.dailyLesson.create({
    data: {
      id: `lesson_${id}`, userId: id, lessonDate: "2026-11-23", version: 1, active: true, theme: "Daily Life", difficulty: "A2",
      newWordCount: 1, estimatedMinutes: 5, source: "preview", poolNote: "", progress: "{}", listeningTitle: id,
      listeningText: "A private preview sentence.", listeningChunks: "[]", listeningGloss: "{}", createdAt,
    },
  });
  await user.vocabulary.create({
    data: {
      id: `vocab_${id}`, userId: id, lemma: "shared-lemma", pos: "noun", ipaNote: "", meaningZh: "测试", definitionEn: "test",
      collocation: "", example: "A private preview sentence.", exampleZh: "测试", difficulty: "A2", theme: "Daily Life",
      knownAlready: false, exampleFlagged: false, createdAt, lessonId: `lesson_${id}`,
    },
  });
  await user.wordProgress.create({
    data: {
      id: `progress_${id}`, vocabularyId: `vocab_${id}`, userId: id, due, stability: 1.5, difficulty: 5, elapsedDays: 0,
      scheduledDays: 1, learningSteps: 0, reps: 2, lapses: 0, state: 1, firstLearnedAt: createdAt, correctCount: 0,
      incorrectCount: 0, familiarity: "new", recallAbility: "again",
    },
  });
}
await seed("learner_vercel_a", accountA.id);
await seed("learner_vercel_b", accountB.id);
const progress = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_learner_vercel_a" } });
const version = {
  due: progress.due.toISOString(), reps: progress.reps, lapses: progress.lapses, state: progress.state,
  lastReview: progress.lastReview, correctCount: progress.correctCount, incorrectCount: progress.incorrectCount,
};

const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = app.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
check("[模拟] 预览服务没有占用 8787", port !== 8787 && port !== 0);
const origin = { Origin: "http://127.0.0.1:8798" };

async function signIn(email: string, password: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email, password }),
  });
  await response.arrayBuffer();
  return { status: response.status, cookie: response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ") };
}
async function call(path: string, cookie: string, init: RequestInit = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { ...origin, cookie, ...(init.headers || {}) },
  });
  const text = await response.text();
  return { status: response.status, text };
}

try {
  const anonymous = await call("/api/lessons", "");
  const loginA = await signIn("vercel-a@lab.test", "vercel-a-pass-1844");
  const loginB = await signIn("vercel-b@lab.test", "vercel-b-pass-2755");
  const lessonsA = await call("/api/lessons?userId=learner_vercel_b", loginA.cookie);
  const lessonsB = await call("/api/lessons", loginB.cookie);
  const libraryA = await call("/api/library", loginA.cookie);
  const libraryB = await call("/api/library?userId=learner_vercel_a", loginB.cookie);
  const bodyA = JSON.parse(lessonsA.text) as Array<{ id: string; listeningText?: string }>;
  const wordsA = JSON.parse(libraryA.text) as Array<{ id: string; lemma: string }>;
  const wordsB = JSON.parse(libraryB.text) as Array<{ id: string }>;
  check(
    "[模拟] 未登录不返回课程正文，两个账号的课程和词汇隔离",
    anonymous.status === 401 && !anonymous.text.includes("private preview") && loginA.status === 200 && loginB.status === 200
      && bodyA.every((item) => item.id.includes("vercel_a")) && !lessonsA.text.includes("vercel_b")
      && wordsA.some((item) => item.lemma === "shared-lemma" && item.id.includes("vercel_a"))
      && wordsB.every((item) => item.id.includes("vercel_b")),
    `${anonymous.status}/${loginA.status}/${lessonsB.status}`,
  );
  const raced = await Promise.all([0, 1].map((index) => call("/api/review/vocab_learner_vercel_a/rate", loginA.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: "good", clientRequestId: `vercel-race-${index}-1844`, progress: version }),
  }).then((response) => response.status)));
  check("[模拟] FSRS 并发只有一次成功", raced.filter((status) => status === 200).length === 1 && raced.includes(409), raced.join(","));
  const statsA = await call("/api/stats", loginA.cookie);
  const statsB = await call("/api/stats", loginB.cookie);
  const parsedA = JSON.parse(statsA.text) as { words: number; days: { reviews: Array<{ total: number }> } };
  const parsedB = JSON.parse(statsB.text) as { words: number; days: { reviews: Array<{ total: number }> } };
  const reviewTotal = (rows: Array<{ total: number }>) => rows.reduce((sum, item) => sum + item.total, 0);
  check("[模拟] 统计只包含当前用户", statsA.status === 200 && statsB.status === 200 && parsedA.words === 1 && parsedB.words === 1 && reviewTotal(parsedA.days.reviews) >= 1 && reviewTotal(parsedB.days.reviews) === 0);
  const quota = await Promise.all([
    call("/api/ai/test", loginA.cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId: "vercel-ai-a-1844" }) }).then((response) => response.status),
    call("/api/ai/test", loginB.cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId: "vercel-ai-b-1844" }) }).then((response) => response.status),
  ]);
  check("[模拟] Mock AI 的最后一次全站额度只有一个成功", quota.filter((status) => status === 200).length === 1 && quota.includes(429), quota.join(","));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const afterPublic = await publicCounts();
check("[保护] public 计数没有变化", JSON.stringify(beforePublic) === JSON.stringify(afterPublic));
check("[保护] lab.db 和 auth.db 没有变化", JSON.stringify(labBefore) === JSON.stringify(databaseStamp(labDatabasePath)) && JSON.stringify(authBefore) === JSON.stringify(databaseStamp(authDatabasePath)));
await user.$disconnect();
await auth.$disconnect();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("vercel preview simulation ok");
