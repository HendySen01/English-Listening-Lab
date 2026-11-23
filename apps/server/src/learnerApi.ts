// 业务读写只接受已经验证的 Learner。资源 ID 先按当前用户查找。
import type { VerifiedLearner } from "./learnerIdentity.js";
import { assertPaidAiMock } from "./learnerAiGuard.js";
import { ownQuota, withAiCharge } from "./learnerQuota.js";
import { lookupPreviewExplanation } from "./previewExplain.js";
import { practiceOwnWord, rateOwnWord } from "./learnerReview.js";
import { AppError } from "./errors.js";
import { THEME_ZH } from "./content.js";
import { addStudyDays, readStudyTimeZone, studyDate, studyDayBounds, studyNow } from "./studyTime.js";
import type { RatingName } from "./srs.js";
import { learnerDb } from "./runtimeClients.js";

function db() {
  return learnerDb();
}

const lessonFields = {
  id: true,
  lessonDate: true,
  version: true,
  active: true,
  theme: true,
  difficulty: true,
  newWordCount: true,
  estimatedMinutes: true,
  source: true,
  model: true,
  listeningTitle: true,
  listeningText: true,
  listeningChunks: true,
  listeningGloss: true,
  progress: true,
  userId: true,
} as const;

function presentLesson(lesson: {
  id: string;
  lessonDate: string;
  version: number;
  active: boolean;
  theme: string;
  difficulty: string;
  newWordCount: number;
  estimatedMinutes: number;
  source: string;
  model: string | null;
  listeningTitle: string;
  listeningText: string;
  listeningChunks: string;
  listeningGloss: string;
  progress: string;
  words?: Array<{ id: string; lemma: string; meaningZh: string; progress: { reps: number; due: Date; familiarity: string } | null }>;
  questions?: Array<{ id: string; prompt: string; options: string; answerIndex: number; attempts: Array<{ selected: number; correct: boolean }> }>;
}) {
  return {
    id: lesson.id,
    lessonDate: lesson.lessonDate,
    version: lesson.version,
    active: lesson.active,
    theme: lesson.theme,
    themeLabel: THEME_ZH[lesson.theme] || lesson.theme,
    difficulty: lesson.difficulty,
    newWordCount: lesson.newWordCount,
    estimatedMinutes: lesson.estimatedMinutes,
    source: lesson.source,
    model: lesson.model,
    progress: JSON.parse(lesson.progress),
    listening: {
      title: lesson.listeningTitle,
      text: lesson.listeningText,
      chunks: JSON.parse(lesson.listeningChunks) as string[],
      gloss: JSON.parse(lesson.listeningGloss) as Record<string, string>,
    },
    words: (lesson.words || []).map((word) => ({
      id: word.id,
      lemma: word.lemma,
      meaningZh: word.meaningZh,
      reps: word.progress?.reps ?? 0,
      due: word.progress?.due ?? null,
      familiarity: word.progress?.familiarity ?? "new",
    })),
    questions: (lesson.questions || []).map((question) => {
      const attempt = question.attempts[question.attempts.length - 1];
      return {
        id: question.id,
        prompt: question.prompt,
        options: JSON.parse(question.options) as string[],
        answered: Boolean(attempt),
        selected: attempt?.selected ?? null,
        correct: attempt?.correct ?? null,
        answerIndex: attempt ? question.answerIndex : null,
      };
    }),
  };
}

const lessonInclude = {
  words: { include: { progress: true }, orderBy: { createdAt: "asc" as const } },
  questions: { include: { attempts: true }, orderBy: { sortOrder: "asc" as const } },
};

export async function ownLessons(learner: VerifiedLearner) {
  const lessons = await db().dailyLesson.findMany({
    where: { userId: learner.learnerId },
    select: lessonFields,
    orderBy: [{ lessonDate: "desc" }, { version: "desc" }],
  });
  return lessons.map((lesson) => ({
    id: lesson.id,
    lessonDate: lesson.lessonDate,
    version: lesson.version,
    active: lesson.active,
    theme: THEME_ZH[lesson.theme] || lesson.theme,
    difficulty: lesson.difficulty,
    newWordCount: lesson.newWordCount,
    source: lesson.source,
    listeningTitle: lesson.listeningTitle,
  }));
}

export async function ownLesson(learner: VerifiedLearner, id: string) {
  const lesson = await db().dailyLesson.findFirst({ where: { id, userId: learner.learnerId }, include: lessonInclude });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到资源");
  return presentLesson(lesson);
}

export async function ownLessonVersions(learner: VerifiedLearner, lessonDate: string) {
  return db().dailyLesson.findMany({
    where: { userId: learner.learnerId, lessonDate },
    select: { id: true, version: true, active: true, source: true, model: true, createdAt: true },
    orderBy: { version: "asc" },
  });
}

export async function activateOwnLesson(learner: VerifiedLearner, id: string) {
  const lesson = await db().dailyLesson.findFirst({ where: { id, userId: learner.learnerId } });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到资源");
  await db().$transaction([
    db().dailyLesson.updateMany({ where: { userId: learner.learnerId, lessonDate: lesson.lessonDate }, data: { active: false } }),
    db().dailyLesson.updateMany({ where: { id, userId: learner.learnerId }, data: { active: true } }),
  ]);
  return ownLesson(learner, id);
}

export async function saveOwnLessonProgress(learner: VerifiedLearner, id: string, progress: unknown) {
  if (!progress || typeof progress !== "object") throw new AppError(400, "BAD_PROGRESS", "进度格式不正确");
  const updated = await db().dailyLesson.updateMany({
    where: { id, userId: learner.learnerId },
    data: { progress: JSON.stringify(progress) },
  });
  if (updated.count !== 1) throw new AppError(404, "NOT_FOUND", "找不到资源");
  return ownLesson(learner, id);
}

async function createOfflineLesson(learner: VerifiedLearner, lessonDate: string, source: string) {
  const latest = await db().dailyLesson.findFirst({
    where: { userId: learner.learnerId, lessonDate },
    orderBy: { version: "desc" },
  });
  const id = `lesson_${learner.learnerId}_${lessonDate}_${source}_${(latest?.version ?? 0) + 1}`;
  await db().$transaction([
    db().dailyLesson.updateMany({ where: { userId: learner.learnerId, lessonDate }, data: { active: false } }),
    db().dailyLesson.create({
      data: {
        id,
        lessonDate,
        version: (latest?.version ?? 0) + 1,
        active: true,
        theme: "Daily Life",
        difficulty: "A2",
        newWordCount: 1,
        estimatedMinutes: 5,
        source,
        model: source === "ai" ? "mock" : null,
        poolNote: "",
        progress: "{}",
        listeningTitle: source,
        listeningText: "A short runtime sentence.",
        listeningChunks: "[]",
        listeningGloss: "{}",
        createdAt: new Date(),
        userId: learner.learnerId,
      },
    }),
  ]);
  return ownLesson(learner, id);
}

export async function ensureOwnToday(learner: VerifiedLearner, now = studyNow()) {
  const lessonDate = studyDate(now);
  const existing = await db().dailyLesson.findFirst({
    where: { userId: learner.learnerId, lessonDate, active: true },
    include: lessonInclude,
  });
  if (existing) return presentLesson(existing);
  return createOfflineLesson(learner, lessonDate, "offline");
}

export async function createOwnAiVersion(learner: VerifiedLearner, clientRequestId?: unknown, inputTokens?: unknown, now = studyNow()) {
  const declared = typeof inputTokens === "number" ? inputTokens : undefined;
  const result = await withAiCharge({ learner, requestId: clientRequestId, kind: "lesson", now, inputTokens: declared }, async () => {
    assertPaidAiMock();
    return createOfflineLesson(learner, studyDate(now), "ai");
  });
  return result.value;
}

export async function ownLibrary(learner: VerifiedLearner) {
  const words = await db().vocabulary.findMany({
    where: { userId: learner.learnerId },
    include: { progress: true, lesson: { select: { id: true, lessonDate: true, listeningTitle: true, version: true } } },
    orderBy: { createdAt: "desc" },
  });
  return words.map((word) => ({
    id: word.id,
    lemma: word.lemma,
    meaningZh: word.meaningZh,
    example: word.example,
    familiarity: word.progress?.familiarity ?? "new",
    reps: word.progress?.reps ?? 0,
    lapses: word.progress?.lapses ?? 0,
    state: word.progress?.state ?? 0,
    due: word.progress?.due ?? null,
    lastReview: word.progress?.lastReview ?? null,
    correctCount: word.progress?.correctCount ?? 0,
    incorrectCount: word.progress?.incorrectCount ?? 0,
    stability: word.progress?.stability ?? null,
    lessonId: word.lesson?.id ?? null,
    lessonDate: word.lesson?.lessonDate ?? null,
    userId: word.userId,
  }));
}

export async function answerOwnQuestion(learner: VerifiedLearner, questionId: string, selected: number) {
  const question = await db().quizQuestion.findFirst({ where: { id: questionId, userId: learner.learnerId } });
  if (!question) throw new AppError(404, "NOT_FOUND", "找不到资源");
  const options = JSON.parse(question.options) as string[];
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) {
    throw new AppError(400, "BAD_ANSWER", "请选择一个有效选项");
  }
  const existing = await db().quizAttempt.findFirst({ where: { questionId, userId: learner.learnerId }, orderBy: { createdAt: "desc" } });
  if (!existing) {
    await db().quizAttempt.create({
      data: {
        id: `attempt_${learner.learnerId}_${questionId}`,
        questionId,
        selected,
        correct: selected === question.answerIndex,
        createdAt: new Date(),
        userId: learner.learnerId,
      },
    });
  }
  return { id: questionId, selected, correct: selected === question.answerIndex, userId: learner.learnerId };
}

export async function addOwnSession(learner: VerifiedLearner, lessonId: string | null, module: string, minutes: number) {
  const safe = Math.max(0, Math.min(40, Math.round(minutes)));
  if (!safe) return { ok: true };
  if (lessonId) {
    const lesson = await db().dailyLesson.findFirst({ where: { id: lessonId, userId: learner.learnerId }, select: { id: true } });
    if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到资源");
  }
  await db().studySession.create({
    data: {
      id: `session_${learner.learnerId}_${crypto.randomUUID()}`,
      lessonId,
      module,
      minutes: safe,
      createdAt: new Date(),
      userId: learner.learnerId,
    },
  });
  // StudySession 只有 createdAt 和 minutes。整段时长归入 createdAt 所在的上海学习日，不拆分跨午夜时段。
  return { ok: true };
}

export async function ownStats(learner: VerifiedLearner) {
  const userId = learner.learnerId;
  const words = await db().vocabulary.count({ where: { userId } });
  const known = await db().vocabulary.count({ where: { userId, knownAlready: true } });
  const attempts = await db().quizAttempt.findMany({ where: { userId } });
  const reviews = await db().wordProgress.count({ where: { userId, reps: { gt: 0 } } });
  const minutes = await db().studySession.aggregate({ where: { userId }, _sum: { minutes: true } });
  const usage = await db().aIUsageRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });
  const sessions = await db().studySession.findMany({ where: { userId }, select: { createdAt: true, minutes: true } });
  const reviewEvents = await db().reviewEvent.findMany({ where: { userId }, select: { createdAt: true } });
  const lessons = await db().dailyLesson.findMany({ where: { userId }, select: { lessonDate: true } });
  return {
    words,
    known,
    reviews,
    minutes: minutes._sum.minutes ?? 0,
    quizTotal: attempts.length,
    quizCorrect: attempts.filter((item) => item.correct).length,
    usage: usage.map((item) => ({ kind: item.kind, model: item.model, success: item.success, createdAt: item.createdAt })),
    studyTimeZone: readStudyTimeZone(),
    days: {
      lessons: countBy(lessons, (item) => item.lessonDate),
      sessions: sumBy(sessions, (item) => studyDate(item.createdAt), (item) => item.minutes),
      reviews: countBy(reviewEvents, (item) => studyDate(item.createdAt)),
      usage: countBy(usage, (item) => studyDate(item.createdAt)),
    },
  };
}

function countBy<T>(rows: T[], dateOf: (row: T) => string) {
  return sumBy(rows, dateOf, () => 1);
}

function sumBy<T>(rows: T[], dateOf: (row: T) => string, valueOf: (row: T) => number) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const date = dateOf(row);
    totals.set(date, (totals.get(date) ?? 0) + valueOf(row));
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, total]) => ({ date, total }));
}

const settingDefaults = {
  dailyNewWords: 6,
  difficulty: "A2+",
  listeningLevel: "match",
  dailyMinutes: 60,
  theme: "Daily Life",
  customTheme: "",
  autoGenerate: true,
  ttsVoice: "en-US",
  speechRate: 1,
  locale: "zh-CN",
  colorMode: "system",
  wordPartsEnabled: true,
  recommendationsEnabled: true,
};

export async function ownSettings(learner: VerifiedLearner) {
  const current = await db().userSettings.findUnique({ where: { userId: learner.learnerId } });
  if (current) return current;
  return db().userSettings.create({
    data: { id: `settings_${learner.learnerId}`, userId: learner.learnerId, ...settingDefaults, updatedAt: new Date() },
  });
}

export async function updateOwnSettings(learner: VerifiedLearner, input: Record<string, unknown>) {
  const current = await ownSettings(learner);
  const themes = Object.keys(THEME_ZH);
  return db().userSettings.update({
    where: { userId: learner.learnerId },
    data: {
      dailyNewWords: clamp(input.dailyNewWords, 3, 20, current.dailyNewWords),
      dailyMinutes: clamp(input.dailyMinutes, 20, 180, current.dailyMinutes),
      theme: themes.includes(String(input.theme)) ? String(input.theme) : current.theme,
      customTheme: String(input.customTheme ?? current.customTheme).slice(0, 40),
      updatedAt: new Date(),
    },
  });
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export async function ownDashboard(learner: VerifiedLearner, now = studyNow()) {
  const settings = await ownSettings(learner);
  const today = studyDate(now);
  const lesson = await db().dailyLesson.findFirst({
    where: { userId: learner.learnerId, lessonDate: today, active: true },
    select: { id: true, lessonDate: true, theme: true, newWordCount: true },
  });
  const dueCount = await db().wordProgress.count({
    where: { userId: learner.learnerId, reps: { gt: 0 }, due: { lte: now } },
  });
  const historyRows = await db().dailyLesson.findMany({
    where: { userId: learner.learnerId },
    select: { id: true, lessonDate: true, version: true, active: true },
    orderBy: [{ lessonDate: "desc" }, { version: "desc" }],
  });
  const history = [...new Set(historyRows.map((item) => item.lessonDate))].map((date) => ({
    date,
    lessons: historyRows.filter((item) => item.lessonDate === date).map((item) => ({ id: item.id, version: item.version, active: item.active })),
  }));
  const week = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addStudyDays(today, -offset);
    const bounds = studyDayBounds(date);
    const sessions = await db().studySession.findMany({
      where: { userId: learner.learnerId, createdAt: { gte: bounds.start, lt: bounds.end } },
    });
    const lessonCount = historyRows.filter((item) => item.lessonDate === date).length;
    week.push({ date, minutes: sessions.reduce((sum, item) => sum + item.minutes, 0), lessonCount, hasLesson: lessonCount > 0 });
  }
  return { date: today, studyTimeZone: readStudyTimeZone(), dueCount, lesson, week, history, settings: { theme: settings.theme, dailyNewWords: settings.dailyNewWords } };
}

export async function ownReviewQueue(learner: VerifiedLearner, now = new Date()) {
  const rows = await db().wordProgress.findMany({
    where: { userId: learner.learnerId, reps: { gt: 0 }, due: { lte: now } },
    include: { vocabulary: true },
    orderBy: { due: "asc" },
  });
  return {
    dueCount: rows.length,
    items: rows.map((row) => ({
      id: row.vocabularyId,
      lemma: row.vocabulary.lemma,
      reps: row.reps,
      due: row.due,
      stability: row.stability,
      userId: row.userId,
    })),
  };
}

export async function easierOwnExample(learner: VerifiedLearner, vocabularyId: string, clientRequestId?: unknown, inputTokens?: unknown) {
  const word = await db().vocabulary.findFirst({ where: { id: vocabularyId, userId: learner.learnerId } });
  if (!word) throw new AppError(404, "NOT_FOUND", "找不到资源");
  const declared = typeof inputTokens === "number" ? inputTokens : undefined;
  const result = await withAiCharge({ learner, requestId: clientRequestId, kind: "example", inputTokens: declared }, async () => {
    assertPaidAiMock();
    const example = `Mock ${word.lemma} example.`;
    const updated = await db().vocabulary.updateMany({
      where: { id: vocabularyId, userId: learner.learnerId },
      data: { example, exampleZh: "测试例句", exampleFlagged: true },
    });
    if (updated.count !== 1) throw new AppError(404, "NOT_FOUND", "找不到资源");
    return { example, exampleZh: "测试例句", source: "mock" };
  });
  return result.value;
}

export async function simplerOwnQuestion(learner: VerifiedLearner, questionId: string, clientRequestId?: unknown, inputTokens?: unknown) {
  const question = await db().quizQuestion.findFirst({ where: { id: questionId, userId: learner.learnerId } });
  if (!question) throw new AppError(404, "NOT_FOUND", "找不到资源");
  const declared = typeof inputTokens === "number" ? inputTokens : undefined;
  const result = await withAiCharge({ learner, requestId: clientRequestId, kind: "simpler", inputTokens: declared }, async () => {
    assertPaidAiMock();
    return { mode: "mock", text: question.simplerZh };
  });
  return result.value;
}

export async function recallOwnLesson(learner: VerifiedLearner, lessonId: string, text: string) {
  const lesson = await db().dailyLesson.findFirst({ where: { id: lessonId, userId: learner.learnerId } });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到资源");
  if (text.trim().length < 2) throw new AppError(400, "EMPTY", "请先用简短的话写下你听到的主要内容");
  return { mode: "local-heuristic", accepted: true };
}

export async function explainOwnedPassage(learner: VerifiedLearner, passageId: string, word = "", sentence = "", clientRequestId?: unknown, inputTokens?: unknown) {
  const owned = await db().dailyLesson.findFirst({ where: { id: passageId, userId: learner.learnerId }, select: { id: true } });
  if (!owned) {
    const other = await db().dailyLesson.count({ where: { id: passageId, userId: { not: learner.learnerId } } });
    if (other > 0) throw new AppError(404, "NOT_FOUND", "找不到资源");
  }
  const cached = word ? lookupPreviewExplanation(passageId, word, sentence) : null;
  if (cached) return { ok: true, charged: false, source: "cache" as const };
  const declared = typeof inputTokens === "number" ? inputTokens : undefined;
  const result = await withAiCharge({ learner, requestId: clientRequestId, kind: "explain", inputTokens: declared }, async () => {
    assertPaidAiMock();
    return { ok: true, charged: true, mocked: true, passageId };
  });
  return result.value;
}

export { ownQuota };

export { practiceOwnWord, rateOwnWord, type RatingName };
