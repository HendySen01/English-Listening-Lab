import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { repoRoot } from "./paths.ts";
import {
  assignLearnerOwnership,
  authDatabasePath,
  backupLabReadonly,
  databaseStamp,
  labDatabasePath,
  originalAuthUserId,
  originalLearnerId,
} from "../scripts/sqlite/assign-learner-ownership.mjs";

const runtimeFile = path.join(repoRoot, "data", "user-runtime.db");
const authRuntimeFile = path.join(repoRoot, "data", "auth-runtime.db");
const secret = "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2";
const sharedRequest = "sharedrate1844";

process.env.DATABASE_URL = `file:${path.join(repoRoot, "data", "selftest.db").replace(/\\/g, "/")}`;
process.env.USER_DATABASE_URL = `file:${runtimeFile.replace(/\\/g, "/")}`;
process.env.AUTH_DATABASE_URL = `file:${authRuntimeFile.replace(/\\/g, "/")}`;
process.env.USER_RUNTIME = "1";
process.env.BETTER_AUTH_SECRET = secret;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8797";
process.env.BETTER_AUTH_TRUSTED_ORIGINS = "http://127.0.0.1:8797,http://localhost:8797";
process.env.AUTH_SELFTEST = "1";
process.env.LLM_API_KEY = "";
process.env.TTS_API_KEY = "";
delete process.env.AI_REAL_CALLS;
delete process.env.ONLINE_TTS_ENABLED;

const { createPrivateTestAccount } = await import("./auth.ts");
const { disconnectAuthPrisma, getAuthPrisma } = await import("./authDatabase.ts");
const { paidAiCalls, resetPaidAiCalls, setPaidAiMock } = await import("./learnerAiGuard.ts");
const { ownLibrary, ownStats, rateOwnWord } = await import("./learnerApi.ts");
const { createUserRuntimeApp } = await import("./userRuntimeApp.ts");
const { directionGuidance, lessonLearningGoal, studyPreferences, updateStudyPreferences } = await import("./studyPreferences.ts");
const { disconnectUserPrisma, getUserPrisma } = await import("./userDatabase.ts");

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
}

const oldCet4 = { difficulty: "CET-4", listeningLevel: "match" };
const oldPrefs = studyPreferences(oldCet4);
check("[设置] 旧 CET-4 保留学习方向，以 B1 作为原词库基准", oldPrefs.learningDirection === "cet4" && oldPrefs.difficulty === "B1");
const guidance = Object.keys(directionGuidance).map(learningDirection => lessonLearningGoal({
  ...oldCet4, learningDirection, difficulty: "C2", customLearningGoal: "Travel vocabulary",
}));
check("[设置] 九个方向都各有提示且不限制 CEFR",
  guidance.length === 9 && new Set(guidance.map(item => item.material)).size === 9
  && updateStudyPreferences(oldCet4, { difficulty: "C2", learningDirection: "ielts" }).difficulty === "C2");
const custom = updateStudyPreferences(oldCet4, { learningDirection: "custom", customLearningGoal: "Travel\n" + "x".repeat(200) });
check("[设置] 自定义目标作为独立、有界的提示数据",
  custom.customLearningGoal.length === 160 && !custom.customLearningGoal.includes("\n")
  && lessonLearningGoal(custom).customGoal === custom.customLearningGoal);

function removeDatabase(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target);
  }
}

function readOnlyCounts(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const progress = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(reps), 0) AS reps FROM WordProgress").get() as { n: number; reps: number };
    return {
      lessons: Number(db.prepare("SELECT COUNT(*) AS n FROM DailyLesson").get().n),
      words: Number(db.prepare("SELECT COUNT(*) AS n FROM Vocabulary").get().n),
      progress: Number(progress.n),
      reps: Number(progress.reps),
      reviews: Number(db.prepare("SELECT COUNT(*) AS n FROM ReviewEvent").get().n),
    };
  } finally {
    db.close();
  }
}

const labBefore = databaseStamp(labDatabasePath);
const authBefore = databaseStamp(authDatabasePath);
const labCountsBefore = readOnlyCounts(labDatabasePath);
removeDatabase(runtimeFile);
removeDatabase(authRuntimeFile);
await backupLabReadonly(runtimeFile);
const migrated = new DatabaseSync(runtimeFile);
assignLearnerOwnership(migrated);
migrated.exec(fs.readFileSync(path.join(repoRoot, "apps/server/prisma-neon-user/migrations/20261125120000_learning_direction/migration.sql"), "utf8"));
const originalProgress = JSON.stringify(migrated.prepare("SELECT id, due, stability, reps, lapses, state, lastReview FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId));
migrated.close();
execSync("node scripts/auth/push.mjs", { cwd: path.join(repoRoot, "apps/server"), env: process.env, stdio: "inherit" });

const alpha = await createPrivateTestAccount({ email: "scope-a@lab.test", password: "scope-a-pass-1844", name: "Scope A" });
const beta = await createPrivateTestAccount({ email: "scope-b@lab.test", password: "scope-b-pass-2755", name: "Scope B" });
const guest = await createPrivateTestAccount({ email: "scope-c@lab.test", password: "scope-c-pass-3066", name: "Scope C" });
const broken = await createPrivateTestAccount({ email: "scope-d@lab.test", password: "scope-d-pass-4177", name: "Scope D" });
const user = getUserPrisma();
const createdAt = new Date("2026-11-23T01:00:00.000Z");
const due = new Date("2020-01-01T00:00:00.000Z");

async function seed(input: { id: string; authUserId: string; boundAt: Date | null; reps: number; stability: number; mirror: boolean }) {
  await user.learner.create({ data: { id: input.id, authUserId: input.authUserId, boundAt: input.boundAt, createdAt } });
  if (!input.boundAt) return;
  const lessonId = `lesson_${input.id}`;
  const vocabId = `vocab_${input.id}`;
  await user.dailyLesson.create({
    data: {
      id: lessonId,
      lessonDate: "2026-11-23",
      version: 1,
      active: true,
      theme: input.id,
      difficulty: "A2",
      newWordCount: 1,
      estimatedMinutes: 5,
      source: "runtime",
      poolNote: "",
      progress: "{}",
      listeningTitle: input.id,
      listeningText: `${input.id} listening text`,
      listeningChunks: "[]",
      listeningGloss: "{}",
      createdAt,
      userId: input.id,
    },
  });
  const word = {
    lemma: "shared-lemma",
    pos: "noun",
    ipaNote: "",
    meaningZh: "测试",
    definitionEn: "runtime",
    collocation: "",
    example: "A shared lemma sentence.",
    exampleZh: "测试",
    difficulty: "A2",
    theme: input.id,
    knownAlready: false,
    exampleFlagged: false,
    createdAt,
    lessonId,
    userId: input.id,
  };
  await user.vocabulary.create({ data: { id: vocabId, ...word } });
  await user.wordProgress.create({
    data: {
      id: `progress_${input.id}`,
      vocabularyId: vocabId,
      due,
      stability: input.stability,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reps: input.reps,
      lapses: 0,
      state: 1,
      firstLearnedAt: createdAt,
      correctCount: 0,
      incorrectCount: 0,
      familiarity: "new",
      recallAbility: "again",
      userId: input.id,
    },
  });
  if (input.mirror) {
    await user.vocabulary.create({ data: { ...word, id: `${vocabId}_mirror` } });
    await user.wordProgress.create({
      data: {
        id: `progress_${input.id}_mirror`,
        vocabularyId: `${vocabId}_mirror`,
        due,
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state: 1,
        firstLearnedAt: createdAt,
        correctCount: 0,
        incorrectCount: 0,
        familiarity: "new",
        recallAbility: "again",
        userId: input.id,
      },
    });
  }
  await user.quizQuestion.create({
    data: {
      id: `question_${input.id}`,
      lessonId,
      sortOrder: 1,
      kind: "meaning",
      prompt: input.id,
      options: JSON.stringify(["yes", "no"]),
      answerIndex: 0,
      explanationEn: "runtime",
      explanationZh: "测试",
      simplerZh: "更简单",
      evidence: "runtime",
      whyWrong: "[]",
      userId: input.id,
    },
  });
}

await seed({ id: "learner_scope_a", authUserId: alpha.id, boundAt: createdAt, reps: 2, stability: 1.5, mirror: true });
await seed({ id: "learner_scope_b", authUserId: beta.id, boundAt: createdAt, reps: 5, stability: 4.5, mirror: false });
await seed({ id: "learner_scope_d", authUserId: broken.id, boundAt: null, reps: 0, stability: 1, mirror: false });
const learnerA = { learnerId: "learner_scope_a", authUserId: alpha.id, boundAt: createdAt };
const learnerB = { learnerId: "learner_scope_b", authUserId: beta.id, boundAt: createdAt };
const libraryA = await ownLibrary(learnerA);
const wordA = libraryA.find((item) => item.id === "vocab_learner_scope_a");
const beforeB = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_b" } });
if (!wordA) throw new Error("缺少 A 的词汇");
const rated = await rateOwnWord(learnerA, wordA.id, "good", "recall", sharedRequest, wordA);
const mirrored = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_a_mirror" } });
const afterB = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_b" } });
check("[服务] A 的正式评分使用事务并镜像到自己的同形词", rated.changedSchedule === true && mirrored.reps === (await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: wordA.id } })).reps);
check("[服务] A 的评分不改变 B 的 FSRS", afterB.reps === beforeB.reps && afterB.stability === beforeB.stability && afterB.due.getTime() === beforeB.due.getTime());
let foreignRejected = false;
try {
  await rateOwnWord(learnerA, "vocab_learner_scope_b", "good", "recall", "another-request-1844", wordA);
} catch (error) {
  foreignRejected = error instanceof Error && "code" in error && error.code === "NOT_FOUND";
}
check("[服务] 不能按别人的词汇 ID 评分", foreignRejected && (await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_b" } })).reps === beforeB.reps);
const statsA = await ownStats(learnerA);
const statsB = await ownStats(learnerB);
check("[服务] 统计只包含当前用户", statsA.words === 2 && statsB.words === 1 && statsA.minutes === 0 && statsB.minutes === 0);

const appSource = fs.readFileSync(path.join(repoRoot, "apps/server/src/app.ts"), "utf8");
const businessSource = fs.readFileSync(path.join(repoRoot, "apps/server/src/learnerApi.ts"), "utf8");
check("[数据库] 旧应用没有改接多用户客户端", !appSource.includes("learnerApi") && !appSource.includes("getUserPrisma"));
check("[数据库] 隔离业务层不调用付费客户端", !businessSource.includes("chatJson") && !businessSource.includes("TTS_API_KEY"));

const runtime = createUserRuntimeApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = runtime.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const origin = { Origin: "http://127.0.0.1:8797" };

function cookieFrom(response: Response) {
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
}
async function signIn(email: string, password: string) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email, password }),
  });
  return cookieFrom(response);
}
async function api(pathname: string, cookie = "", init: RequestInit = {}) {
  return fetch(`${base}${pathname}`, { ...init, headers: { cookie, ...origin, ...(init.headers || {}) } });
}

try {
  const anonymousLessons = await api("/api/lessons");
  const anonymousAi = await api("/api/lessons/ai-version", "", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("[HTTP] 未登录查询私人课程返回 401", anonymousLessons.status === 401);
  check("[HTTP] 未登录 AI 请求没有调用模型", anonymousAi.status === 401 && paidAiCalls() === 0);
  const alphaCookie = await signIn("scope-a@lab.test", "scope-a-pass-1844");
  const betaCookie = await signIn("scope-b@lab.test", "scope-b-pass-2755");
  const guestCookie = await signIn("scope-c@lab.test", "scope-c-pass-3066");
  const brokenCookie = await signIn("scope-d@lab.test", "scope-d-pass-4177");
  const lessonsA = await (await api("/api/lessons?userId=learner_scope_b", alphaCookie, { headers: { "x-user-id": "learner_scope_b" } })).json() as Array<{ id: string }>;
  const foreignLesson = await api("/api/lessons/lesson_learner_scope_b", alphaCookie);
  const foreignBody = await foreignLesson.json() as { code?: string };
  check("[HTTP] A 能读取自己的课程", lessonsA.some((item) => item.id === "lesson_learner_scope_a") && lessonsA.every((item) => item.id.includes("learner_scope_a")));
  check("[HTTP] A 读取 B 的课程返回 404", foreignLesson.status === 404 && foreignBody.code === "NOT_FOUND");
  const activate = await api("/api/lessons/lesson_learner_scope_b/activate", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "learner_scope_b" }) });
  const stillActive = await user.dailyLesson.findFirstOrThrow({ where: { id: "lesson_learner_scope_b" } });
  check("[HTTP] A 不能修改 B 的课程版本", activate.status === 404 && stillActive.active === true);
  const library = await (await api("/api/library?userId=learner_scope_b", alphaCookie)).json() as Array<{ id: string; userId: string }>;
  const foreignProgress = await api("/api/review", alphaCookie);
  const reviewBody = await foreignProgress.json() as { items: Array<{ id: string; userId: string }> };
  check("[HTTP] A 无法读取 B 的词汇和进度", library.every((item) => item.userId === "learner_scope_a") && !library.some((item) => item.id === "vocab_learner_scope_b") && reviewBody.items.every((item) => item.userId === "learner_scope_a"));
  const quiz = await api("/api/quiz/question_learner_scope_b/answer", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected: 0, userId: "learner_scope_b" }) });
  const attemptsB = await user.quizAttempt.count({ where: { userId: "learner_scope_b" } });
  check("[HTTP] A 无法提交 B 的测验", quiz.status === 404 && attemptsB === 0);
  const ownQuiz = await api("/api/quiz/question_learner_scope_a/answer", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected: 0 }) });
  check("[HTTP] A 可以提交自己的测验", ownQuiz.status === 200 && await user.quizAttempt.count({ where: { userId: "learner_scope_a" } }) === 1);
  const session = await api("/api/sessions", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessonId: "lesson_learner_scope_a", module: "lesson", minutes: 10, userId: "learner_scope_b" }) });
  const statsAfter = await (await api("/api/stats?userId=learner_scope_a", betaCookie)).json() as { minutes: number; words: number; quizTotal: number };
  const statsOwn = await (await api("/api/stats", alphaCookie)).json() as { minutes: number; words: number; quizTotal: number };
  check("[HTTP] 学习时长和统计按用户分开", session.status === 200 && statsOwn.minutes === 10 && statsOwn.words === 2 && statsOwn.quizTotal === 1 && statsAfter.minutes === 0 && statsAfter.words === 1 && statsAfter.quizTotal === 0);
  const foreignSession = await api("/api/sessions", betaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessonId: "lesson_learner_scope_a", minutes: 12 }) });
  check("[HTTP] B 不能把学习时长记到 A 的课程", foreignSession.status === 404 && (await ownStats(learnerB)).minutes === 0);
  const progressB = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_b" } });
  const rateB = await api("/api/review/vocab_learner_scope_b/rate", betaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rating: "hard",
      clientRequestId: sharedRequest,
      userId: "learner_scope_a",
      progress: { due: progressB.due, reps: progressB.reps, lapses: progressB.lapses, state: progressB.state, lastReview: progressB.lastReview, correctCount: progressB.correctCount, incorrectCount: progressB.incorrectCount },
    }),
  });
  const progressA = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_a" } });
  const rateAgain = await api("/api/review/vocab_learner_scope_a/rate", alphaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rating: "good",
      clientRequestId: sharedRequest,
      progress: { due: progressA.due, reps: progressA.reps, lapses: progressA.lapses, state: progressA.state, lastReview: progressA.lastReview, correctCount: progressA.correctCount, incorrectCount: progressA.incorrectCount },
    }),
  });
  const replay = await rateAgain.json() as { replayed?: boolean };
  const sharedCount = await user.reviewEvent.count({ where: { clientRequestId: sharedRequest } });
  const progressAAfter = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_a" } });
  check("[HTTP] 两个用户可以使用同一个请求号", rateB.status === 200 && sharedCount === 2);
  check("[HTTP] 重复请求号不会再次改变 A 的进度", rateAgain.status === 200 && replay.replayed === true && progressAAfter.reps === progressA.reps);
  const practiceBefore = progressAAfter.due.getTime();
  const practice = await api("/api/review/vocab_learner_scope_a/practice", alphaCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: "again", clientRequestId: "practice-a-184400" }),
  });
  const practiceBody = await practice.json() as { changedSchedule?: boolean };
  const practiceAfter = await user.wordProgress.findFirstOrThrow({ where: { vocabularyId: "vocab_learner_scope_a" } });
  check("[HTTP] 提前练习不改变正式排程", practice.status === 200 && practiceBody.changedSchedule === false && practiceAfter.due.getTime() === practiceBefore && practiceAfter.reps === progressAAfter.reps);
  resetPaidAiCalls();
  setPaidAiMock(() => undefined);
  const foreignAi = await api("/api/vocabulary/vocab_learner_scope_b/easier", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const foreignExplain = await api("/api/preview/explain", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passageId: "lesson_learner_scope_b", word: "shared-lemma", sentence: "secret" }) });
  check("[HTTP] 登录后访问其他用户的 AI 资源被拒绝且未调用模型", foreignAi.status === 404 && foreignExplain.status === 404 && paidAiCalls() === 0);
  const ownAi = await api("/api/lessons/ai-version", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmCost: true, userId: "learner_scope_b" }) });
  const versionsB = await user.dailyLesson.count({ where: { userId: "learner_scope_b" } });
  check("[HTTP] 付费课程生成只写入当前用户", ownAi.status === 200 && paidAiCalls() === 1 && versionsB === 1);
  const evil = await api("/api/sessions", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ minutes: 9 }) });
  check("[HTTP] 恶意来源的写入被拒绝", evil.status === 403 && (await ownStats(learnerA)).minutes === 10);
  const settingsResponse = await api("/api/settings", alphaCookie, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyNewWords: 8, theme: "Health", userId: "learner_scope_b" }) });
  const settingsOwn = await settingsResponse.json() as { dailyNewWords?: number; userId?: string };
  const settingsB = await (await api("/api/settings", betaCookie)).json() as { dailyNewWords?: number; userId?: string };
  const dashboardA = await (await api("/api/dashboard", alphaCookie)).json() as { lesson?: { id?: string } | null };
  const dashboardB = await (await api("/api/dashboard", betaCookie)).json() as { lesson?: { id?: string } | null };
  check("[HTTP] 设置和仪表盘只属于当前用户", settingsResponse.status === 200 && settingsOwn.dailyNewWords === 8 && settingsOwn.userId === "learner_scope_a" && settingsB.dailyNewWords === 6 && settingsB.userId === "learner_scope_b" && dashboardA.lesson?.id !== dashboardB.lesson?.id);
  const anonymousTts = await api("/api/tts", "", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello", useOnline: true }) });
  const onlineTts = await api("/api/tts", alphaCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello", useOnline: true }) });
  check("[HTTP] 在线语音不能匿名调用，隔离运行时拒绝联网", anonymousTts.status === 401 && onlineTts.status === 403);
  const fetchHttp = globalThis.fetch;
  let lessonCalls = 0;
  let explanationCalls = 0;
  let thinkingMode: unknown;
  let speechCalls = 0;
  let deepseekSpeechCalls = 0;
  let deepseekSpeechBody: Record<string, unknown> = {};
  let modelSettings: Record<string, unknown> = {};
  const words = ["clinic", "rest", "water"].map((lemma) => ({
    lemma, pos: "noun", meaningZh: "词义", definitionEn: "A short definition.",
    collocation: `some ${lemma}`, example: `We talked about ${lemma} today.`, exampleZh: "我们今天聊过这个话题。",
  }));
  const questions = ["context", "sentence", "listening"].map((kind) => ({
    kind, prompt: "选择答案。", options: ["A", "B", "C"], answerIndex: 0,
    explanationEn: "First option.", explanationZh: "选第一项。", simplerZh: "第一项。",
    evidence: "I went to the clinic.", whyWrong: ["", "第二项不符。", "第三项不符。"],
  }));
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://ai-unit.invalid/chat/completions") {
      const request = JSON.parse(String(init?.body));
      if (String(request.messages[0].content).includes("词源与语境解析专家")) {
        explanationCalls += 1;
        const content = JSON.stringify({
          text: "clinic", type: "word", pronunciation: "", partOfSpeech: "名词", definition: "诊所", usage: "表示就诊地点。",
          etymology: { origin: "来源待证实", originalImage: "就诊地点" },
          semanticRoutes: ["地点", "机构", "服务"].map(label => ({ label, steps: "延伸", modernMeaning: label })),
          comparisons: [], examples: [{ text: "Visit the clinic.", translation: "去诊所。" }, { text: "The clinic is open.", translation: "诊所开门了。" }],
        });
        return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
      }
      lessonCalls += 1;
      thinkingMode = request.thinking?.type;
      modelSettings = JSON.parse(request.messages[1].content);
      const content = JSON.stringify({
        words, questions, listeningTitle: "A visit",
        listeningChunks: ["I went to the clinic.", "The doctor asked me to rest.", "I drank some water at home."],
      });
      return Response.json({ choices: [{ finish_reason: lessonCalls === 1 ? "stop" : "length", message: { content } }] });
    }
    if (url === "https://api.openai.com/v1/audio/speech") {
      speechCalls += 1;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    }
    if (url === "https://api.deepseek.com/v1/tools/tts") {
      deepseekSpeechCalls += 1;
      deepseekSpeechBody = JSON.parse(String(init?.body));
      const wav = Buffer.alloc(46);
      wav.write("RIFF", 0);
      wav.writeUInt32LE(38, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(24000, 24);
      wav.writeUInt32LE(48000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(2, 40);
      return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav" } });
    }
    if (!url.startsWith("http://127.0.0.1:")) throw new Error("Unexpected outbound fetch in selftest");
    return fetchHttp(input, init);
  };
  try {
    process.env.AI_REAL_CALLS = "1";
    process.env.DEEPSEEK_API_KEY = "fake-model-key";
    process.env.DEEPSEEK_BASE_URL = "https://ai-unit.invalid";
    process.env.DEEPSEEK_MODEL = "deepseek-flash";
    process.env.ONLINE_TTS_ENABLED = "1";
    process.env.ONLINE_TTS_API_KEY = "fake-speech-key";
    delete process.env.ONLINE_TTS_PROVIDER;
    process.env.TTS_VOICE = "tide";
    await api("/api/settings", alphaCookie, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyNewWords: 3, theme: "Custom", customTheme: "Health visits", difficulty: "A2", listeningLevel: "A1", wordPartsEnabled: false, learningDirection: "ielts" }),
    });
    const generate = (requestId: string) => api("/api/lessons/ai-version", alphaCookie, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmCost: true, clientRequestId: requestId }),
    });
    const generated = await generate("course-real-path-1");
    const lesson = await generated.json() as { id: string; words: Array<Record<string, unknown> & { id: string; lemma: string; example: string }>; questions?: unknown[] };
    const replay = await generate("course-real-path-1");
    const replayed = await replay.json() as { id: string };
    const rejected = await generate("course-real-path-2");
    const saved = await user.dailyLesson.findUnique({ where: { id: lesson.id || "missing" } });
    const charged = await user.aiCharge.count({ where: { requestId: { startsWith: "course-real-path-" }, status: "succeeded" } });
    check("[HTTP] 整课真实路径在模拟模型下校验、隔离保存并支持重放",
      generated.status === 200 && lesson.words?.length === 3 && lesson.questions?.length === 3
      && replayed.id === lesson.id && lessonCalls === 2 && saved?.userId === "learner_scope_a", String(generated.status));
    check("[HTTP] 截断的课程计一次请求并保留已激活课程", rejected.status === 502 && saved?.active === true && charged === 2);
    check("[HTTP] DeepSeek Flash 生成整课时显式关闭思考模式", thinkingMode === "disabled");
    check("[HTTP] 整课模型使用保存的词数、主题、难度、听力和词根设置",
      modelSettings.count === 3 && modelSettings.theme === "Health visits"
      && modelSettings.difficulty === "A2" && modelSettings.listeningLevel === "A1"
      && modelSettings.listeningLength === "short" && modelSettings.morphology === "Always null"
      && saved?.theme === "Health visits" && saved?.difficulty === "A2"
      && (modelSettings.learningGoal as { direction?: string })?.direction === "ielts");
    const reloaded = await (await api("/api/settings", alphaCookie)).json() as { learningDirection?: string; difficulty?: string };
    const untouched = await (await api("/api/settings", betaCookie)).json() as { learningDirection?: string };
    check("[HTTP] 学习方向独立于 CEFR，保存后可刷新且隔离",
      reloaded.learningDirection === "ielts" && reloaded.difficulty === "A2" && untouched.learningDirection === "general");
    const first = lesson.words.find(word => word.lemma === "clinic")!;
    const progressPatch = await api(`/api/lessons/${lesson.id}/progress`, alphaCookie, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ progress: { step: "words", completed: ["words"] } }),
    });
    const library = await (await api("/api/library", alphaCookie)).json() as typeof lesson.words;
    const due = await (await api("/api/review?filter=due", alphaCookie)).json() as { items: typeof lesson.words };
    const all = await (await api("/api/review?filter=all", alphaCookie)).json() as { items: typeof lesson.words };
    const target = due.items.find(word => word.id === first.id)!;
    check("[HTTP] 课程词汇进入词库、到期和全部队列，首次复习前 reps 为 0",
      progressPatch.status === 200 && !!first.ipa && target?.reps === 0 && library.some(word => word.id === target.id && word.due === target.due)
      && all.items.some(word => word.id === target.id));
    const statsBefore = await (await api("/api/stats", alphaCookie)).json() as { reviews: number };
    const practice = await api(`/api/review/${target.id}/practice`, alphaCookie, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: "good" }),
    });
    const firstRating = await api(`/api/review/${target.id}/rate`, alphaCookie, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "good", clientRequestId: "first-review-isolated", progress: target }),
    });
    const refreshed = await (await api("/api/library", alphaCookie)).json() as typeof lesson.words;
    const statsAfter = await (await api("/api/stats", alphaCookie)).json() as { reviews: number };
    check("[HTTP] 提前练习不改排程，首次正式复习更新词库和统计",
      practice.status === 200 && firstRating.status === 200 && refreshed.some(word => word.id === target.id && word.reps === 1 && word.due !== target.due)
      && statsAfter.reviews === statsBefore.reviews + 1);

    const analysisInput = { passageId: `lesson:${lesson.id}:word:${first.id}`, word: first.lemma, sentence: first.example };
    const explain = (cookie: string) => api("/api/preview/explain", cookie, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(analysisInput),
    });
    const streamed = await explain(alphaCookie);
    const replayedAnalysis = await (await explain(alphaCookie)).json() as { source?: string; charged?: boolean };
    const cachedAnalysis = await (await api("/api/preview/explain?" + new URLSearchParams(analysisInput), alphaCookie)).json() as { source?: string };
    const changedContext = await (await api("/api/preview/explain?" + new URLSearchParams({ ...analysisInput, sentence: "I went to the clinic." }), alphaCookie)).json() as { source?: string };
    check("[HTTP] 解析只调用一次且 GET/POST 命中无扣次，句子与用户隔离",
      streamed.status === 200 && replayedAnalysis.source === "cache" && replayedAnalysis.charged === false
      && cachedAnalysis.source === "cache" && changedContext.source === "miss" && explanationCalls === 1
      && (await explain(betaCookie)).status === 404);
    const chargesBeforeSpeech = await user.aiCharge.count();
    const synthesize = () => api("/api/tts", alphaCookie, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", useOnline: true, rate: 1.2 }),
    });
    const speechResult = await synthesize();
    const speech = await speechResult.json() as { url?: string; rate?: number; sourceLabel?: string };
    const system = await (await api("/api/system", alphaCookie)).json() as { ttsHost: string; ttsVoice: string; ttsUsable: boolean };
    check("[HTTP] 优先使用同一 DeepSeek 密钥，返回私有 WAV 并提供真实服务状态",
      speechResult.status === 200 && speech.rate === 1.2 && Boolean(speech.url?.startsWith("data:audio/wav;base64,"))
      && Boolean(speech.sourceLabel?.includes("DeepSeek")) && speechResult.headers.get("cache-control") === "no-store"
      && system.ttsHost === "DeepSeek" && system.ttsVoice === "tide" && system.ttsUsable && deepseekSpeechCalls === 1
      && deepseekSpeechBody.voice_id === "tide" && deepseekSpeechBody.text === "hello" && deepseekSpeechBody.format === "wav");
    process.env.ONLINE_TTS_PROVIDER = "openai";
    const openaiResult = await synthesize();
    const openai = await openaiResult.json() as { url?: string; sourceLabel?: string };
    check("[HTTP] 显式选择 OpenAI 时保留原 MP3 路径", openaiResult.status === 200
      && openai.url === "data:audio/mpeg;base64,AQID" && Boolean(openai.sourceLabel?.includes("OpenAI")) && speechCalls === 1);
    const speechCounter = await getAuthPrisma().rateLimit.findUnique({ where: { key: "lab-tts:user:learner_scope_a" } });
    const sharedAudio = await api("/api/audio/test.mp3", betaCookie);
    check("[HTTP] 在线语音独立扣次且无共享音频读取入口",
      speechCounter?.count === 2 && await user.aiCharge.count() === chargesBeforeSpeech && sharedAudio.status === 403);
  } finally {
    globalThis.fetch = fetchHttp;
    delete process.env.AI_REAL_CALLS;
    delete process.env.ONLINE_TTS_ENABLED;
    delete process.env.ONLINE_TTS_PROVIDER;
  }
  const unbound = await api("/api/lessons", guestCookie);
  const invalid = await api("/api/stats", brokenCookie);
  const brokenRow = await user.learner.findUniqueOrThrow({ where: { id: "learner_scope_d" } });
  check("[HTTP] 未绑定学习者不能读取业务数据", unbound.status === 403);
  check("[HTTP] 异常绑定不会被自动修复", invalid.status === 409 && brokenRow.boundAt === null && brokenRow.authUserId === broken.id);
  const savedSecret = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = "short";
  const locked = await api("/api/lessons", alphaCookie);
  const lockedText = await locked.text();
  process.env.BETTER_AUTH_SECRET = savedSecret;
  check("[HTTP] 缺少认证密钥时不会退回匿名业务数据", locked.status === 503 && !lockedText.includes("listening"));
  const unknown = await api("/api/not-a-real-route", alphaCookie);
  check("[HTTP] 未隔离的接口默认拒绝", unknown.status === 403);
  const liveHealth = await fetch("http://127.0.0.1:8787/api/health");
  const liveRuntime = await fetch("http://127.0.0.1:8787/api/user-runtime/lessons");
  check("[HTTP] 8787 仍是原来的服务", liveHealth.status === 200 && await liveHealth.text() === "{\"ok\":true}" && liveRuntime.status === 404);
} finally {
  setPaidAiMock(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectUserPrisma();
  await disconnectAuthPrisma();
}

const verify = new DatabaseSync(runtimeFile, { readOnly: true });
const progressNow = JSON.stringify(verify.prepare("SELECT id, due, stability, reps, lapses, state, lastReview FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId));
const originalNow = verify.prepare("SELECT authUserId, boundAt FROM Learner WHERE id = ?").get(originalLearnerId) as { authUserId: string; boundAt: number | null };
const sharedRows = Number(verify.prepare("SELECT COUNT(*) AS n FROM ReviewEvent WHERE clientRequestId = ?").get(sharedRequest).n);
verify.close();
check("[数据库] 原始学习者和 FSRS 没有被改写", progressNow === originalProgress && originalNow.authUserId === originalAuthUserId && originalNow.boundAt === null);
check("[数据库] 同一个请求号在两个用户下各有一条", sharedRows === 2);
check("[数据库] lab.db 文件和计数没有变化", JSON.stringify(labBefore) === JSON.stringify(databaseStamp(labDatabasePath)) && JSON.stringify(labCountsBefore) === JSON.stringify(readOnlyCounts(labDatabasePath)));
check("[数据库] auth.db 文件没有变化", JSON.stringify(authBefore) === JSON.stringify(databaseStamp(authDatabasePath)));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("user api ok");
