import { databaseStamp, labDatabasePath, authDatabasePath } from "../scripts/sqlite/assign-learner-ownership.mjs";
import { createPrivateTestAccount } from "./auth.ts";
import { setPaidAiMock } from "./learnerAiGuard.ts";
import { openVerifiedPostgres } from "./postgresUserDatabase.ts";
import { createUserRuntimeApp } from "./userRuntimeApp.ts";

process.env.BETTER_AUTH_SECRET = "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8798";
process.env.AUTH_SELFTEST = "1";
process.env.AI_SITE_DAILY_LIMIT = "1";
process.env.AI_USER_DAILY_LIMIT = "200";

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(detail ? `${name} :: ${detail}` : name);
  else console.log(`通过 ${name}`);
}

const opened = await openVerifiedPostgres();
const { user, auth } = opened;
const labBefore = databaseStamp(labDatabasePath);
const authBefore = databaseStamp(authDatabasePath);
const publicNames = ["DailyLesson", "Vocabulary", "WordProgress", "ReviewEvent", "ExplanationCache", "AIUsageRecord"];
async function publicCounts() {
  const counts: Record<string, number> = {};
  for (const name of publicNames) {
    const rows = await user.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."${name}"`) as Array<{ n: number }>;
    counts[name] = rows[0].n;
  }
  const migrations = await user.$queryRawUnsafe(`SELECT migration_name FROM public."_prisma_migrations" ORDER BY migration_name`) as Array<{ migration_name: string }>;
  return { counts, migrations };
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
const accountA = await createPrivateTestAccount({ email: "preview-a@lab.test", password: "preview-a-pass-1844", name: "Preview A" });
const accountB = await createPrivateTestAccount({ email: "preview-b@lab.test", password: "preview-b-pass-2755", name: "Preview B" });
const accountC = await createPrivateTestAccount({ email: "preview-c@lab.test", password: "preview-c-pass-3066", name: "Preview C" });

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
      listeningText: "A preview sentence.", listeningChunks: "[]", listeningGloss: "{}", createdAt,
    },
  });
  await user.vocabulary.create({
    data: {
      id: `vocab_${id}`, userId: id, lemma: "shared-lemma", pos: "noun", ipaNote: "", meaningZh: "测试", definitionEn: "test",
      collocation: "", example: "A preview sentence.", exampleZh: "测试", difficulty: "A2", theme: "Daily Life",
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
await seed("learner_preview_a", accountA.id);
await seed("learner_preview_b", accountB.id);
const progress = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_learner_preview_a" } });
const version = {
  due: progress.due.toISOString(),
  reps: progress.reps,
  lapses: progress.lapses,
  state: progress.state,
  lastReview: progress.lastReview,
  correctCount: progress.correctCount,
  incorrectCount: progress.incorrectCount,
};

setPaidAiMock(() => undefined);
const app = createUserRuntimeApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = app.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
check("[PostgreSQL][运行] 端到端服务没有占用 8787", port !== 8787 && port !== 0);

async function signIn(email: string, password: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8798" },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  return {
    status: response.status,
    cookie: response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; "),
    text: text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]").slice(0, 300),
  };
}
async function api(path: string, cookie: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Origin: "http://127.0.0.1:8798", cookie, ...(init.headers || {}) },
  });
}

try {
  const loginA = await signIn("preview-a@lab.test", "preview-a-pass-1844");
  const loginB = await signIn("preview-b@lab.test", "preview-b-pass-2755");
  const loginC = await signIn("preview-c@lab.test", "preview-c-pass-3066");
  const lessonsA = await api("/api/lessons?userId=learner_preview_b", loginA.cookie);
  const lessonsB = await api("/api/lessons", loginB.cookie);
  const anonymous = await api("/api/lessons", "");
  const unbound = await api("/api/lessons?userId=learner_preview_a", loginC.cookie);
  const bodyA = await lessonsA.json() as Array<{ id: string }>;
  const bodyB = await lessonsB.json() as Array<{ id: string }>;
  check(
    "[PostgreSQL][HTTP] 两个账号的课程隔离，未登录和未绑定被拒绝",
    loginA.status === 200 && loginB.status === 200 && lessonsA.status === 200 && lessonsB.status === 200
      && bodyA.every((item) => item.id.includes("preview_a")) && bodyB.every((item) => item.id.includes("preview_b"))
      && anonymous.status === 401 && unbound.status === 403,
    `${loginA.status}/${loginB.status}/${loginC.status}/${lessonsA.status}/${anonymous.status}/${unbound.status}`,
  );

  const raced = await Promise.all([0, 1].map((index) => api(`/api/review/vocab_learner_preview_a/rate`, loginA.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: "good", clientRequestId: `preview-race-${index}-1844`, progress: version }),
  }).then(async (response) => response.status)));
  const fresh = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_learner_preview_a" } });
  const rateBody = JSON.stringify({
    rating: "good",
    clientRequestId: "preview-rate-1844",
    progress: {
      due: fresh.due.toISOString(),
      reps: fresh.reps,
      lapses: fresh.lapses,
      state: fresh.state,
      lastReview: fresh.lastReview,
      correctCount: fresh.correctCount,
      incorrectCount: fresh.incorrectCount,
    },
    userId: "learner_preview_b",
  });
  const replay = await api("/api/review/vocab_learner_preview_a/rate", loginA.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rateBody,
  });
  const replayAgain = await api("/api/review/vocab_learner_preview_a/rate", loginA.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rateBody,
  });
  const reviews = await user.reviewEvent.count({ where: { userId: "learner_preview_a", clientRequestId: "preview-rate-1844" } });
  check("[PostgreSQL][HTTP] 同一进度并发只有一次成功", raced.filter((status) => status === 200).length === 1 && raced.includes(409), raced.join(","));
  check("[PostgreSQL][HTTP] 重复请求号不会再次计分", replay.status === 200 && replayAgain.status === 200 && reviews === 1, `${replay.status}/${reviews}`);

  const foreignSession = await api("/api/sessions", loginB.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonId: "lesson_learner_preview_a", module: "lesson", minutes: 5, userId: "learner_preview_a" }),
  });
  const ownSession = await api("/api/sessions", loginA.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonId: "lesson_learner_preview_a", module: "lesson", minutes: 5 }),
  });
  let triggerRejected = "";
  try {
    await user.studySession.create({
      data: { id: "session_cross", lessonId: "lesson_learner_preview_a", module: "lesson", minutes: 4, createdAt, userId: "learner_preview_b" },
    });
    triggerRejected = "created";
  } catch (error) {
    triggerRejected = error instanceof Error ? error.message : "";
  }
  check("[PostgreSQL][HTTP] 跨用户学习记录被拒绝，本人记录可以写入", foreignSession.status === 404 && ownSession.status === 200 && triggerRejected.includes("cross-user-link"), triggerRejected);

  const quota = await Promise.all([
    api("/api/ai/test", loginA.cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId: "preview-ai-a-1844" }) }).then((response) => response.status),
    api("/api/ai/test", loginB.cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId: "preview-ai-b-1844" }) }).then((response) => response.status),
  ]);
  const charges = await user.aiCharge.count({ where: { requestId: { in: ["preview-ai-a-1844", "preview-ai-b-1844"] }, status: { in: ["pending", "succeeded", "unknown"] } } });
  check("[PostgreSQL][HTTP] 全站最后一次 AI 预留只有一个成功", quota.filter((status) => status === 200).length === 1 && quota.includes(429) && charges === 1, quota.join(","));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const afterPublic = await publicCounts();
check("[PostgreSQL][保护] public 业务表和迁移记录没有变化", JSON.stringify(beforePublic) === JSON.stringify(afterPublic));
check("[SQLite] lab.db 和 auth.db 文件没有变化", JSON.stringify(labBefore) === JSON.stringify(databaseStamp(labDatabasePath)) && JSON.stringify(authBefore) === JSON.stringify(databaseStamp(authDatabasePath)));
let health = "not-running";
try {
  const response = await fetch("http://127.0.0.1:8787/api/health");
  health = response.ok ? await response.text() : String(response.status);
} catch {
  health = "not-running";
}
console.log(`8787 健康检查：${health}`);
await user.$disconnect();
await auth.$disconnect();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`postgres runtime ok ${opened.identity.endpoint} ${opened.identity.database}`);
