import { execFileSync } from "node:child_process";
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
  originalLearnerId,
} from "../scripts/sqlite/assign-learner-ownership.mjs";

const runtimeFile = path.join(repoRoot, "data", "user-runtime.db");
const authRuntimeFile = path.join(repoRoot, "data", "auth-runtime.db");
process.env.DATABASE_URL = `file:${path.join(repoRoot, "data", "selftest.db").replace(/\\/g, "/")}`;
process.env.USER_DATABASE_URL = `file:${runtimeFile.replace(/\\/g, "/")}`;
process.env.AUTH_DATABASE_URL = `file:${authRuntimeFile.replace(/\\/g, "/")}`;
process.env.USER_RUNTIME = "1";
process.env.STUDY_TIMEZONE = "Asia/Shanghai";
process.env.BETTER_AUTH_SECRET = "c4e8b1a9d2f64c0e8b7a5d3f1c9e2746ab0d18f2";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8797";
process.env.BETTER_AUTH_TRUSTED_ORIGINS = "http://127.0.0.1:8797,http://localhost:8797";
process.env.AUTH_SELFTEST = "1";
process.env.LLM_API_KEY = "";
process.env.TTS_API_KEY = "";

const { AppError } = await import("./errors.ts");
const { createPrivateTestAccount } = await import("./auth.ts");
const { disconnectAuthPrisma } = await import("./authDatabase.ts");
const { createUserRuntimeApp } = await import("./userRuntimeApp.ts");
const { disconnectUserPrisma, getUserPrisma } = await import("./userDatabase.ts");
const { addStudyDays, readStudyTimeZone, sameStudyDay, setStudyClock, studyDate, studyDayBounds } = await import("./studyTime.ts");
const { ownStats } = await import("./learnerApi.ts");

const failures: string[] = [];
function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`通过 ${name}`);
}

const beforeMidnight = new Date("2026-11-23T15:59:59.999Z");
const afterMidnight = new Date("2026-11-23T16:00:00.000Z");
check("[时区] 上海午夜前仍是 2026-11-23", studyDate(beforeMidnight) === "2026-11-23");
check("[时区] 上海午夜后进入 2026-11-24", studyDate(afterMidnight) === "2026-11-24");
check("[时区] UTC 午夜附近仍属于上海 11 月 23 日", studyDate(new Date("2026-11-23T00:00:00.000Z")) === "2026-11-23" && sameStudyDay(new Date("2026-11-23T00:00:00.000Z"), beforeMidnight));
check("[时区] 同一上海学习日的不同 UTC 时间相同", sameStudyDay(new Date("2026-11-22T16:00:00.000Z"), beforeMidnight) && !sameStudyDay(beforeMidnight, afterMidnight));
check("[时区] 月末跨入下一月", studyDate(new Date("2026-01-31T16:00:00.000Z")) === "2026-02-01" && studyDate(new Date("2026-01-31T15:59:59.999Z")) === "2026-01-31");
check("[时区] 年末跨入下一年", studyDate(new Date("2026-12-31T15:59:59.999Z")) === "2026-12-31" && studyDate(new Date("2026-12-31T16:00:00.000Z")) === "2027-01-01");
const june = studyDayBounds("2026-06-15");
const december = studyDayBounds("2026-12-15");
const november = studyDayBounds("2026-11-23");
const nextDay = studyDayBounds("2026-11-24");
check("[时区] 6 月和 12 月的上海日都从 UTC 16:00 开始", june.start.toISOString() === "2026-06-14T16:00:00.000Z" && december.start.toISOString() === "2026-12-14T16:00:00.000Z");
check("[时区] 相邻学习日首尾相接且不重叠", november.end.getTime() === nextDay.start.getTime() && studyDate(new Date(november.end.getTime() - 1)) === "2026-11-23" && studyDate(november.end) === "2026-11-24");
check("[时区] 日历加减不依赖服务器本地时区", addStudyDays("2026-01-31", 1) === "2026-02-01" && addStudyDays("2026-12-31", 1) === "2027-01-01");
let invalid: unknown = null;
try {
  readStudyTimeZone("Not/AZone");
} catch (error) {
  invalid = error;
}
check("[时区] 无效 IANA 时区被拒绝", invalid instanceof AppError && invalid.code === "BAD_STUDY_TIMEZONE" && !String(invalid.message).includes("本地"));
const savedZone = process.env.STUDY_TIMEZONE;
delete process.env.STUDY_TIMEZONE;
check("[时区] 未配置时使用 Asia/Shanghai", readStudyTimeZone() === "Asia/Shanghai" && studyDate(afterMidnight) === "2026-11-24");
process.env.STUDY_TIMEZONE = savedZone;

function zoneOutput(tz: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "--eval", "import { studyDate } from './src/studyTime.ts'; const instant = new Date('2026-11-23T16:00:00.000Z'); const local = instant.getFullYear() + '-' + String(instant.getMonth() + 1).padStart(2, '0') + '-' + String(instant.getDate()).padStart(2, '0'); console.log(studyDate(instant) + ' ' + local);"], {
    cwd: path.join(repoRoot, "apps", "server"),
    env: { ...process.env, TZ: tz, STUDY_TIMEZONE: "Asia/Shanghai" },
    encoding: "utf8",
  }).trim();
}
const utcZone = zoneOutput("UTC");
const honoluluZone = zoneOutput("Pacific/Honolulu");
const shanghaiZone = zoneOutput("Asia/Shanghai");
check("[时区] UTC、火奴鲁鲁和上海进程得到同一个学习日", utcZone.startsWith("2026-11-24") && honoluluZone.startsWith("2026-11-24") && shanghaiZone.startsWith("2026-11-24"));
check("[时区] 对照进程的本地日期确实不同", utcZone.endsWith("2026-11-23") && honoluluZone.endsWith("2026-11-23") && shanghaiZone.endsWith("2026-11-24"));

function removeDatabase(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(`${file}${suffix}`)) fs.rmSync(`${file}${suffix}`);
}
function counts(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return {
      lessons: Number(db.prepare("SELECT COUNT(*) AS n FROM DailyLesson").get().n),
      progress: Number(db.prepare("SELECT COUNT(*) AS n FROM WordProgress").get().n),
      reviews: Number(db.prepare("SELECT COUNT(*) AS n FROM ReviewEvent").get().n),
    };
  } finally {
    db.close();
  }
}
const labBefore = databaseStamp(labDatabasePath);
const authBefore = databaseStamp(authDatabasePath);
const labCountsBefore = counts(labDatabasePath);
removeDatabase(runtimeFile);
removeDatabase(authRuntimeFile);
await backupLabReadonly(runtimeFile);
const migrated = new DatabaseSync(runtimeFile);
assignLearnerOwnership(migrated);
const originalLessons = JSON.stringify(migrated.prepare("SELECT id, lessonDate, version, active FROM DailyLesson WHERE userId = ? ORDER BY id").all(originalLearnerId));
const originalFsrs = JSON.stringify(migrated.prepare("SELECT id, due, lastReview, stability, difficulty, reps, lapses, state FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId));
migrated.close();
execFileSync(process.execPath, ["scripts/auth/push.mjs"], { cwd: path.join(repoRoot, "apps", "server"), env: process.env, stdio: "inherit" });

const alpha = await createPrivateTestAccount({ email: "day-a@lab.test", password: "day-a-pass-1844", name: "Day A" });
const beta = await createPrivateTestAccount({ email: "day-b@lab.test", password: "day-b-pass-2755", name: "Day B" });
const user = getUserPrisma();
const createdAt = new Date("2026-05-01T00:00:00.000Z");
const learnerA = { learnerId: "learner_day_a", authUserId: alpha.id, boundAt: createdAt };
const learnerB = { learnerId: "learner_day_b", authUserId: beta.id, boundAt: createdAt };
for (const learner of [learnerA, learnerB]) {
  await user.learner.create({ data: { id: learner.learnerId, authUserId: learner.authUserId, boundAt: createdAt, createdAt } });
}
await user.dailyLesson.create({
  data: {
    id: "lesson_day_a_history", lessonDate: "2020-05-06", version: 1, active: true, theme: "Daily Life", difficulty: "A2",
    newWordCount: 1, estimatedMinutes: 5, source: "runtime", poolNote: "", progress: "{}",
    listeningTitle: "history", listeningText: "An old sentence.", listeningChunks: "[]", listeningGloss: "{}",
    createdAt, userId: learnerA.learnerId,
  },
});
await user.vocabulary.create({
  data: {
    id: "vocab_day_a", lemma: "calendar", pos: "noun", ipaNote: "", meaningZh: "日历", definitionEn: "calendar",
    collocation: "", example: "A calendar sentence.", exampleZh: "日历", difficulty: "A2", theme: "Daily Life",
    knownAlready: false, exampleFlagged: false, createdAt, lessonId: "lesson_day_a_history", userId: learnerA.learnerId,
  },
});
const due = new Date("2026-04-01T03:04:05.000Z");
await user.wordProgress.create({
  data: {
    id: "progress_day_a", vocabularyId: "vocab_day_a", due, stability: 2.5, difficulty: 5, elapsedDays: 1, scheduledDays: 2,
    learningSteps: 0, reps: 3, lapses: 1, state: 2, lastReview: new Date("2026-03-01T01:02:03.000Z"), firstLearnedAt: createdAt,
    correctCount: 2, incorrectCount: 1, familiarity: "remembered", recallAbility: "recall", userId: learnerA.learnerId,
  },
});
await user.studySession.create({ data: { id: "session_day_before", lessonId: "lesson_day_a_history", module: "lesson", minutes: 12, createdAt: beforeMidnight, userId: learnerA.learnerId } });
await user.studySession.create({ data: { id: "session_day_after", lessonId: "lesson_day_a_history", module: "lesson", minutes: 7, createdAt: afterMidnight, userId: learnerA.learnerId } });
await user.studySession.create({ data: { id: "session_day_b", lessonId: null, module: "lesson", minutes: 9, createdAt: afterMidnight, userId: learnerB.learnerId } });
await user.reviewEvent.create({
  data: {
    id: "review_day_a", vocabularyId: "vocab_day_a", clientRequestId: "day-review-a-1844", mode: "formal", rating: "good",
    dueBefore: due, dueAfter: due, changedSchedule: false, createdAt: beforeMidnight, userId: learnerA.learnerId,
  },
});
await user.aIUsageRecord.create({
  data: { id: "usage_day_a", kind: "test", model: "mock", promptTokens: 1, completionTokens: 1, success: true, error: null, createdAt: afterMidnight, userId: learnerA.learnerId },
});

const statsA = await ownStats(learnerA);
const statsB = await ownStats(learnerB);
check("[统计] 时长按上海学习日整段归类", statsA.days.sessions.some((item) => item.date === "2026-11-23" && item.total === 12) && statsA.days.sessions.some((item) => item.date === "2026-11-24" && item.total === 7));
check("[统计] 复习和 AI 记录按上海学习日分组且不扣额度", statsA.days.reviews.some((item) => item.date === "2026-11-23" && item.total === 1) && statsA.days.usage.some((item) => item.date === "2026-11-24" && item.total === 1) && statsA.days.lessons.some((item) => item.date === "2020-05-06" && item.total === 1));
check("[统计] B 的学习日统计不含 A", statsB.minutes === 9 && statsB.days.sessions.every((item) => item.total === 9) && !JSON.stringify(statsB.days).includes("2020-05-06"));

const runtime = createUserRuntimeApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = runtime.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const origin = { Origin: "http://127.0.0.1:8797" };
async function signIn(email: string, password: string) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email, password }),
  });
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
}
async function send(pathname: string, cookie: string, method = "GET") {
  const response = await fetch(`${base}${pathname}`, { method, headers: { cookie, ...origin } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
}
try {
  const dueBefore = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_day_a" } });
  const cookieA = await signIn("day-a@lab.test", "day-a-pass-1844");
  const cookieB = await signIn("day-b@lab.test", "day-b-pass-2755");
  setStudyClock(beforeMidnight);
  const todayA = await send("/api/lessons/today?userId=learner_day_b", cookieA, "POST");
  const versionsBefore = await send("/api/lessons/today/versions?userId=learner_day_b", cookieA);
  setStudyClock(afterMidnight);
  const todayAfter = await send("/api/lessons/today", cookieA, "POST");
  const versionsAfter = await send("/api/lessons/today/versions", cookieA);
  const todayB = await send("/api/lessons/today?userId=learner_day_a", cookieB, "POST");
  const lessonsA = await send("/api/lessons?userId=learner_day_b", cookieA);
  const lessonsB = await send("/api/lessons", cookieB);
  const dashboardA = await send("/api/dashboard?userId=learner_day_b", cookieA);
  const dashboardB = await send("/api/dashboard", cookieB);
  const history = await user.dailyLesson.findFirstOrThrow({ where: { id: "lesson_day_a_history" } });
  const dueAfter = await user.wordProgress.findFirstOrThrow({ where: { id: "progress_day_a" } });
  const lessonA = todayA.body as { lessonDate?: string; id?: string; version?: number };
  const lessonAfter = todayAfter.body as { lessonDate?: string; id?: string };
  const lessonB = todayB.body as { lessonDate?: string; id?: string };
  const listA = lessonsA.body as Array<{ id: string; lessonDate: string; version: number; active: boolean }>;
  const listB = lessonsB.body as Array<{ id: string; lessonDate: string }>;
  const dashA = dashboardA.body as { date?: string; lesson?: { lessonDate?: string }; history?: Array<{ date: string }>; week?: Array<{ date: string; minutes: number }> };
  const dashB = dashboardB.body as { date?: string; lesson?: { id?: string } };
  check("[HTTP] 午夜前今日课程使用 2026-11-23", todayA.status === 200 && lessonA.lessonDate === "2026-11-23" && Array.isArray(versionsBefore.body) && (versionsBefore.body as Array<{ id: string }>).every((item) => item.id === lessonA.id));
  check("[HTTP] 午夜后进入新的学习日", todayAfter.status === 200 && lessonAfter.lessonDate === "2026-11-24" && lessonAfter.id !== lessonA.id && Array.isArray(versionsAfter.body) && (versionsAfter.body as Array<{ id: string }>).some((item) => item.id === lessonAfter.id));
  check("[HTTP] 历史 lessonDate、版本和 active 保持原值", history.lessonDate === "2020-05-06" && history.version === 1 && history.active === true && listA.some((item) => item.id === "lesson_day_a_history" && item.lessonDate === "2020-05-06" && item.version === 1 && item.active === true));
  check("[HTTP] A 和 B 可以拥有相同学习日且课程不混用", lessonB.lessonDate === "2026-11-24" && lessonB.id !== lessonAfter.id && listA.every((item) => item.id.includes("day_a")) && listB.every((item) => item.id.includes("day_b")));
  check("[HTTP] 伪造 userId 不能改变 A 的日期结果", dashA.date === "2026-11-24" && dashA.lesson?.lessonDate === "2026-11-24" && dashB.lesson?.id !== dashA.lesson?.id && dashA.history?.some((item) => item.date === "2020-05-06"));
  check("[HTTP] 仪表盘时长使用上海日界", dashA.week?.some((item) => item.date === "2026-11-23" && item.minutes === 12) === true && dashA.week?.some((item) => item.date === "2026-11-24" && item.minutes === 7) === true && dashB.date === "2026-11-24");
  check("[FSRS] 学习日调整没有改写 due 和 lastReview", dueAfter.due.getTime() === dueBefore.due.getTime() && dueAfter.lastReview?.getTime() === dueBefore.lastReview?.getTime() && dueAfter.reps === 3 && dueAfter.stability === 2.5);
} finally {
  setStudyClock(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectUserPrisma();
  await disconnectAuthPrisma();
}

check("[数据库] 原始课程日期和 FSRS 没有被改写", (() => {
  const db = new DatabaseSync(runtimeFile, { readOnly: true });
  try {
    return JSON.stringify(db.prepare("SELECT id, lessonDate, version, active FROM DailyLesson WHERE userId = ? ORDER BY id").all(originalLearnerId)) === originalLessons
      && JSON.stringify(db.prepare("SELECT id, due, lastReview, stability, difficulty, reps, lapses, state FROM WordProgress WHERE userId = ? ORDER BY id").all(originalLearnerId)) === originalFsrs;
  } finally {
    db.close();
  }
})());
check("[数据库] lab.db 和 auth.db 没有变化", JSON.stringify(labBefore) === JSON.stringify(databaseStamp(labDatabasePath)) && JSON.stringify(labCountsBefore) === JSON.stringify(counts(labDatabasePath)) && JSON.stringify(authBefore) === JSON.stringify(databaseStamp(authDatabasePath)));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("user study time ok");
