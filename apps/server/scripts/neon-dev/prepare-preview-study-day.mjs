import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "D:/Projects/English-Listening-Lab";
const learners = ["learner_vercel_a", "learner_vercel_b"];
const historicalDate = "2026-11-23";
const sqliteFiles = [path.join(root, "data/lab.db"), path.join(root, "data/auth.db")];

function stamp(file) {
  const stat = fs.statSync(file);
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function studyDate(instant = new Date()) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const sqliteBefore = Object.fromEntries(sqliteFiles.map((file) => [path.basename(file), stamp(file)]));
const { readDotenv, assertDevelopmentPair } = await import(pathToFileURL(path.join(root, "apps/server/scripts/neon-dev/guard.mjs")).href);
const env = readDotenv(pathToFileURL(path.join(root, "apps/server/.env.neon.development")));
const target = assertDevelopmentPair(env);
const pooled = new URL(env.DATABASE_URL);
if (pooled.searchParams.get("schema")) throw new Error("schema already set");
pooled.searchParams.set("schema", "lab_phase_h");
pooled.searchParams.set("sslmode", "require");
const direct = new URL(env.DIRECT_URL);
direct.searchParams.set("schema", "lab_phase_h");
direct.searchParams.set("sslmode", "require");
process.env.NEON_USER_DATABASE_URL = pooled.toString();
process.env.NEON_USER_DIRECT_URL = direct.toString();

const { PrismaClient } = await import(pathToFileURL(path.join(root, "apps/server/src/generated/neon-user/index.js")).href);
const db = new PrismaClient();
const today = studyDate();
try {
  if (today === historicalDate) throw new Error("study day still matches the historical lesson");
  const publicBefore = await db.$queryRaw`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
  const created = [];
  for (const userId of learners) {
    const learner = await db.learner.findUnique({ where: { id: userId } });
    if (!learner) throw new Error(`missing isolated learner ${userId}`);
    const historical = await db.dailyLesson.findMany({ where: { userId, lessonDate: historicalDate } });
    if (historical.length !== 1) throw new Error(`historical lesson count ${userId} ${historical.length}`);
    const historicalId = historical[0].id;
    const historicalStamp = historical[0].lessonDate;
    const current = await db.dailyLesson.findFirst({
      where: { userId, lessonDate: today, active: true },
      include: { words: true },
    });
    if (current && !(current.source === "offline" && current.words.length === 0 && current.progress === "{}")) {
      created.push(`${userId}:kept`);
    } else {
      if (current) {
        await db.dailyLesson.updateMany({
          where: { id: current.id, userId, lessonDate: today },
          data: { active: false },
        });
      }
      const lessonId = `lesson_${userId}_${today}_preview_1`;
      const vocabularyId = `vocab_${userId}_${today}`;
      const createdAt = new Date();
      await db.$transaction([
        db.dailyLesson.create({
          data: {
            id: lessonId,
            userId,
            lessonDate: today,
            version: (current?.version ?? 0) + 1,
            active: true,
            theme: "Daily Life",
            difficulty: "A2",
            newWordCount: 1,
            estimatedMinutes: 5,
            source: "preview",
            poolNote: "",
            progress: JSON.stringify({ step: "vocabulary" }),
            listeningTitle: userId,
            listeningText: "A private preview sentence.",
            listeningChunks: "[]",
            listeningGloss: "{}",
            createdAt,
          },
        }),
        db.vocabulary.create({
          data: {
            id: vocabularyId,
            userId,
            lessonId,
            lemma: "shared-lemma",
            pos: "noun",
            ipaNote: "",
            meaningZh: "测试",
            definitionEn: "test",
            collocation: "",
            example: "A private preview sentence.",
            exampleZh: "测试",
            difficulty: "A2",
            theme: "Daily Life",
            knownAlready: false,
            exampleFlagged: false,
            createdAt,
          },
        }),
      ]);
      created.push(`${userId}:created`);
    }
    const unchanged = await db.dailyLesson.findUnique({ where: { id: historicalId } });
    if (!unchanged || unchanged.lessonDate !== historicalStamp || unchanged.userId !== userId) {
      throw new Error(`historical lesson changed ${userId}`);
    }
  }
  const lessons = await db.dailyLesson.findMany({
    where: { userId: { in: learners }, lessonDate: today, active: true },
    select: { id: true, userId: true, lessonDate: true },
  });
  const isolated = learners.every((userId) => lessons.some((item) => item.userId === userId && item.id.includes(userId) && !item.id.includes(userId === learners[0] ? learners[1] : learners[0])));
  if (!isolated) throw new Error("today lessons are not isolated");
  const publicAfter = await db.$queryRaw`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
  if (Number(publicBefore[0].n) !== Number(publicAfter[0].n)) throw new Error("public learner count changed");
  const sqliteAfter = Object.fromEntries(sqliteFiles.map((file) => [path.basename(file), stamp(file)]));
  if (JSON.stringify(sqliteBefore) !== JSON.stringify(sqliteAfter)) throw new Error("sqlite files changed");
  console.log(`endpoint ${target.endpoint} schema lab_phase_h study-day ${today} public ${publicAfter[0].n} ${created.join(" ")}`);
} finally {
  await db.$disconnect();
}
