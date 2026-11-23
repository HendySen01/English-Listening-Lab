import { BANK } from "./bank.js";
import { prisma } from "./prisma.js";
import { AppError } from "./errors.js";
import { chatJson, parseModelJson } from "./ai.js";
import { emptyCard, previewDays, schedule, type RatingName, type StoredCard } from "./srs.js";
import { zhCN } from "./zh.js";
import {
  addDays,
  composeOfflineLesson,
  draftFromAi,
  estimateMinutes,
  localISODate,
  THEME_ZH,
  type LessonDraft,
} from "./content.js";

const lessonInclude = {
  words: { include: { progress: true }, orderBy: { createdAt: "asc" as const } },
  questions: { include: { attempts: true }, orderBy: { sortOrder: "asc" as const } },
};

export async function getSettings() {
  return prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export async function updateSettings(input: Record<string, unknown>) {
  const current = await getSettings();
  const dailyNewWords = clampInt(input.dailyNewWords, 3, 20, current.dailyNewWords);
  const dailyMinutes = clampInt(input.dailyMinutes, 20, 180, current.dailyMinutes);
  const rates = [0.8, 0.9, 1, 1.1];
  const speechRate = rates.includes(Number(input.speechRate)) ? Number(input.speechRate) : current.speechRate;
  const difficulties = ["A1", "A2", "A2+", "B1", "B1+", "B2", "CET-4"];
  const difficulty = difficulties.includes(String(input.difficulty)) ? String(input.difficulty) : current.difficulty;
  const listeningLevels = ["match", ...difficulties];
  const listeningLevel = listeningLevels.includes(String(input.listeningLevel))
    ? String(input.listeningLevel)
    : current.listeningLevel;
  const themes = Object.keys(THEME_ZH);
  const theme = themes.includes(String(input.theme)) ? String(input.theme) : current.theme;
  return prisma.userSettings.update({
    where: { id: 1 },
    data: {
      dailyNewWords,
      difficulty,
      listeningLevel,
      dailyMinutes,
      theme,
      customTheme: String(input.customTheme ?? current.customTheme).slice(0, 40),
      autoGenerate: Boolean(input.autoGenerate),
      ttsVoice: String(input.ttsVoice ?? current.ttsVoice).slice(0, 40),
      speechRate,
      colorMode: ["light", "dark", "system"].includes(String(input.colorMode)) ? String(input.colorMode) : current.colorMode,
      wordPartsEnabled: Boolean(input.wordPartsEnabled),
      recommendationsEnabled: input.recommendationsEnabled === undefined ? current.recommendationsEnabled : Boolean(input.recommendationsEnabled),
    },
  });
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export async function dueCount(now = new Date()) {
  const rows = await canonicalProgress();
  return rows.filter((row) => row.reps > 0 && row.due <= now && !row.vocabulary.knownAlready).length;
}

export async function findLesson(where: { id?: string; lessonDate?: string }) {
  return prisma.dailyLesson.findUnique({ where: where as { id: string }, include: lessonInclude });
}

export async function findLessonByDate(lessonDate: string) {
  const active = await prisma.dailyLesson.findFirst({
    where: { lessonDate, active: true },
    include: lessonInclude,
    orderBy: { version: "desc" },
  });
  if (active) return active;
  return prisma.dailyLesson.findFirst({
    where: { lessonDate },
    include: lessonInclude,
    orderBy: { version: "desc" },
  });
}

export async function ensureLesson(lessonDate: string) {
  const existing = await findLessonByDate(lessonDate);
  if (existing) return existing;
  const settings = await getSettings();
  const theme = settings.theme === "Custom" && settings.customTheme.trim()
    ? settings.customTheme.trim()
    : settings.theme;
  const learned = await prisma.vocabulary.findMany({ select: { lemma: true } });
  const avoid = new Set(learned.map((item) => item.lemma.toLowerCase()));
  const priorLessons = await prisma.dailyLesson.findMany({
    where: { lessonDate: { lt: lessonDate } },
    distinct: ["lessonDate"],
    select: { lessonDate: true },
  });
  const due = await dueCount();
  const hasKey = Boolean(process.env.LLM_API_KEY?.trim());
  let draft: LessonDraft;
  let model: string | null = null;
  if (hasKey) {
    draft = await generateAiDraft({
      count: settings.dailyNewWords,
      difficulty: settings.difficulty,
      theme,
      avoid: [...avoid],
      priorLessons: priorLessons.length,
      listeningLevel: settings.listeningLevel,
      wordParts: settings.wordPartsEnabled,
      dueCount: due,
    });
    model = process.env.LLM_MODEL || "gpt-4o-mini";
  } else {
    draft = composeOfflineLesson({
      count: settings.dailyNewWords,
      difficulty: settings.difficulty,
      theme: settings.theme === "Custom" ? "Custom" : settings.theme,
      avoid,
      firstLesson: priorLessons.length === 0 && learned.length === 0,
      priorLessons: priorLessons.length,
      listeningLevel: settings.listeningLevel,
      wordParts: settings.wordPartsEnabled,
      dueCount: due,
    });
  }
  const progress = {
    step: "review",
    completed: [] as string[],
    wordIndex: 0,
    listening: { round: 1, firstGist: "", thirdGist: "", recall: "", recallNote: "", recallMode: "" },
    shadow: { index: 0, marks: draft.listeningChunks.map(() => null) },
  };
  const memory = await loadMemory();
  try {
    return await prisma.dailyLesson.create({
      data: {
        lessonDate,
        version: 1,
        active: true,
        theme: settings.theme === "Custom" ? theme : settings.theme,
        difficulty: settings.difficulty,
        newWordCount: draft.words.length,
        estimatedMinutes: draft.estimatedMinutes,
        source: draft.source,
        model,
        poolNote: draft.poolNote,
        progress: JSON.stringify(progress),
        listeningTitle: draft.listeningTitle,
        listeningText: draft.listeningText,
        listeningChunks: JSON.stringify(draft.listeningChunks),
        listeningGloss: JSON.stringify(draft.listeningGloss),
        words: {
          create: draft.words.map((word) => ({
            lemma: word.lemma,
            pos: word.pos,
            ipa: word.ipa,
            ipaNote: word.ipaNote,
            stress: word.stress,
            meaningZh: zhCN(word.meaningZh),
            definitionEn: word.definitionEn,
            collocation: word.collocation,
            example: word.example,
            exampleZh: zhCN(word.exampleZh),
            morphology: word.morphology ? JSON.stringify(word.morphology) : null,
            difficulty: word.difficulty,
            theme: word.theme,
            progress: { create: rememberedCard(memory, word.lemma) },
          })),
        },
        questions: {
          create: draft.questions.map((question, index) => ({
            sortOrder: index,
            kind: question.kind,
            prompt: question.prompt,
            options: JSON.stringify(question.options),
            answerIndex: question.answerIndex,
            explanationEn: question.explanationEn,
            explanationZh: question.explanationZh,
            simplerZh: question.simplerZh,
            evidence: question.evidence,
            whyWrong: JSON.stringify(question.whyWrong),
          })),
        },
      },
      include: lessonInclude,
    });
  } catch (error) {
    const again = await findLessonByDate(lessonDate);
    if (again) return again;
    throw error;
  }
}

async function generateAiDraft(input: {
  count: number;
  difficulty: string;
  theme: string;
  avoid: string[];
  priorLessons: number;
  listeningLevel: string;
  wordParts: boolean;
  dueCount: number;
}) {
  const system = [
    "你是英语学习编辑。只返回 JSON，不要 Markdown。",
    "例句必须短，大约 4 到 12 个词，只包含一个主要新词。",
    "不要编造音标，不要输出 ipa 字段。",
    "词根拆解不确定时必须设为 null。只有标准、明显的构词才输出，并且 confident 必须是 true。最多 2 个。",
    "听力是原创短文，用自然的短句，只带入部分新词。",
    "测验正好 3 题，kind 分别是 context、sentence、listening。answerIndex 必须指向正确选项。",
    "中文使用简体中文。",
  ].join("");
  const user = JSON.stringify({
    wordCount: input.count,
    difficulty: input.difficulty,
    note: "CET-4 是考试词汇模式，不是 CEFR 等级。A2+ 表示比 A2 稍高，不要使用学术长句。",
    theme: input.theme,
    avoidLemmas: input.avoid.slice(-80),
    priorLessons: input.priorLessons,
    listening: input.priorLessons < 7 ? "短句" : input.priorLessons < 14 ? "15到30秒短篇" : "稍长但仍适合当前水平",
    schema: {
      listeningTitle: "string",
      listeningChunks: ["句子 / 意群"],
      poolNote: "string",
      words: [
        {
          lemma: "string",
          pos: "string",
          stress: "简体中文重音提示或 null",
          meaningZh: "string",
          definitionEn: "short English",
          collocation: "string",
          example: "short English sentence containing lemma",
          exampleZh: "简体中文",
          morphology: null,
        },
      ],
      questions: [
        {
          kind: "context",
          prompt: "简体中文",
          options: ["", "", "", ""],
          answerIndex: 0,
          explanationEn: "string",
          explanationZh: "简体中文",
          simplerZh: "更短的简体中文",
          evidence: "string",
          whyWrong: ["", "", "", ""],
        },
      ],
    },
  });
  let lastError = "校验失败";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await chatJson("lesson", system, attempt === 1 ? user : `${user}\n上次的问题：${lastError}`);
    try {
      return draftFromAi(parseModelJson(result.content), {
        expectedCount: input.count,
        theme: input.theme,
        difficulty: input.difficulty,
        dueCount: input.dueCount,
        wordParts: input.wordParts,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "校验失败";
    }
  }
  throw new AppError(502, "AI_INVALID", `AI 课程没有通过校验：${lastError}。不完整内容没有保存。`);
}

function cardData(card: StoredCard) {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
  };
}

type MemoryRow = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
  correctCount: number;
  incorrectCount: number;
  familiarity: string;
  recallAbility: string;
  vocabulary: { lemma: string; knownAlready: boolean };
};

async function canonicalProgress() {
  const rows = await prisma.wordProgress.findMany({ include: { vocabulary: true } });
  const chosen = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.vocabulary.lemma.trim().toLowerCase();
    const current = chosen.get(key);
    if (!current || memoryRank(row) > memoryRank(current)) chosen.set(key, row);
  }
  return [...chosen.values()];
}

function memoryRank(row: { reps: number; lastReview: Date | null }) {
  return row.reps * 1e15 + (row.lastReview?.getTime() ?? 0);
}

async function loadMemory() {
  const map = new Map<string, MemoryRow>();
  for (const row of await canonicalProgress()) map.set(row.vocabulary.lemma.trim().toLowerCase(), row);
  return map;
}

function rememberedCard(memory: Map<string, MemoryRow>, lemma: string) {
  const found = memory.get(lemma.trim().toLowerCase());
  if (!found) return cardData(emptyCard());
  return {
    due: found.due,
    stability: found.stability,
    difficulty: found.difficulty,
    elapsedDays: found.elapsedDays,
    scheduledDays: found.scheduledDays,
    learningSteps: found.learningSteps,
    reps: found.reps,
    lapses: found.lapses,
    state: found.state,
    lastReview: found.lastReview,
    correctCount: found.correctCount,
    incorrectCount: found.incorrectCount,
    familiarity: found.familiarity,
    recallAbility: found.recallAbility,
  };
}

async function mirrorLemma(vocabularyId: string) {
  const current = await prisma.wordProgress.findUnique({ where: { vocabularyId }, include: { vocabulary: true } });
  if (!current) return;
  const key = current.vocabulary.lemma.trim().toLowerCase();
  const siblings = (await prisma.wordProgress.findMany({ include: { vocabulary: true } })).filter(
    (row) => row.vocabularyId !== vocabularyId && row.vocabulary.lemma.trim().toLowerCase() === key,
  );
  if (!siblings.length) return;
  await prisma.wordProgress.updateMany({
    where: { vocabularyId: { in: siblings.map((row) => row.vocabularyId) } },
    data: {
      due: current.due,
      stability: current.stability,
      difficulty: current.difficulty,
      elapsedDays: current.elapsedDays,
      scheduledDays: current.scheduledDays,
      learningSteps: current.learningSteps,
      reps: current.reps,
      lapses: current.lapses,
      state: current.state,
      lastReview: current.lastReview,
      correctCount: current.correctCount,
      incorrectCount: current.incorrectCount,
      familiarity: current.familiarity,
      recallAbility: current.recallAbility,
    },
  });
  await prisma.vocabulary.updateMany({
    where: { id: { in: siblings.map((row) => row.vocabularyId) } },
    data: { knownAlready: current.vocabulary.knownAlready },
  });
}

export function presentLesson(lesson: NonNullable<Awaited<ReturnType<typeof findLessonByDate>>>, revealAll = false) {
  const progress = JSON.parse(lesson.progress);
  return {
    id: lesson.id,
    lessonDate: lesson.lessonDate,
    theme: lesson.theme,
    themeLabel: THEME_ZH[lesson.theme] || lesson.theme,
    difficulty: lesson.difficulty,
    newWordCount: lesson.newWordCount,
    estimatedMinutes: lesson.estimatedMinutes,
    source: lesson.source,
    sourceLabel: sourceText(lesson.source),
    model: lesson.model,
    version: lesson.version,
    active: lesson.active,
    createdAt: lesson.createdAt,
    poolNote: lesson.poolNote,
    progress,
    listening: {
      title: lesson.listeningTitle,
      text: lesson.listeningText,
      chunks: JSON.parse(lesson.listeningChunks) as string[],
      gloss: Object.fromEntries(
      Object.entries(JSON.parse(lesson.listeningGloss) as Record<string, string>).map(([key, value]) => [key, zhCN(value)]),
    ),
    },
    words: lesson.words.map((word) => ({
      id: word.id,
      lemma: word.lemma,
      pos: word.pos,
      ipa: word.ipa,
      ipaNote: word.ipaNote,
      stress: word.stress,
      meaningZh: zhCN(word.meaningZh),
      definitionEn: word.definitionEn,
      collocation: word.collocation,
      example: word.example,
      exampleZh: zhCN(word.exampleZh),
      morphology: word.morphology ? JSON.parse(word.morphology) : null,
      knownAlready: word.knownAlready,
      exampleFlagged: word.exampleFlagged,
      familiarity: word.progress?.familiarity ?? "new",
      reps: word.progress?.reps ?? 0,
      due: word.progress?.due ?? null,
      intervals: word.progress ? previewDays(storedFrom(word.progress), new Date()) : null,
    })),
    questions: lesson.questions.map((question) => {
      const attempt = question.attempts[question.attempts.length - 1];
      const revealed = revealAll || Boolean(attempt);
      return {
        id: question.id,
        kind: question.kind,
        prompt: question.prompt,
        options: JSON.parse(question.options) as string[],
        answered: Boolean(attempt),
        selected: attempt?.selected ?? null,
        correct: attempt?.correct ?? null,
        answerIndex: revealed ? question.answerIndex : null,
        explanationEn: revealed ? question.explanationEn : null,
        explanationZh: revealed ? zhCN(question.explanationZh) : null,
        evidence: revealed ? question.evidence : null,
        whyWrong: revealed ? JSON.parse(question.whyWrong) : null,
      };
    }),
  };
}

function storedFrom(progress: {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
}): StoredCard {
  return progress;
}

export async function saveProgress(id: string, progress: unknown) {
  if (!progress || typeof progress !== "object") throw new AppError(400, "BAD_PROGRESS", "进度格式不正确");
  await prisma.dailyLesson.update({ where: { id }, data: { progress: JSON.stringify(progress) } });
  const lesson = await prisma.dailyLesson.findUnique({ where: { id }, include: lessonInclude });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到这节课");
  return presentLesson(lesson);
}

export async function answerQuestion(questionId: string, selected: number) {
  const question = await prisma.quizQuestion.findUnique({ where: { id: questionId }, include: { attempts: true } });
  if (!question) throw new AppError(404, "NOT_FOUND", "找不到这道题");
  const options = JSON.parse(question.options) as string[];
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) {
    throw new AppError(400, "BAD_ANSWER", "请选择一个有效选项");
  }
  const existing = question.attempts[question.attempts.length - 1];
  if (!existing) {
    await prisma.quizAttempt.create({
      data: { questionId, selected, correct: selected === question.answerIndex },
    });
  }
  const lesson = await prisma.dailyLesson.findUnique({ where: { id: question.lessonId }, include: lessonInclude });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到这节课");
  return presentLesson(lesson).questions.find((item) => item.id === questionId);
}

export async function rateWord(vocabularyId: string, rating: RatingName, recallAbility: "recognize" | "recall") {
  const progress = await prisma.wordProgress.findUnique({ where: { vocabularyId } });
  if (!progress) throw new AppError(404, "NOT_FOUND", "找不到这个词的复习记录");
  const next = schedule(storedFrom(progress), rating);
  const correct = rating === "good" || rating === "easy";
  const familiarity = rating === "again" ? "forgot" : rating === "hard" ? "hard" : rating === "easy" ? "easy" : "remembered";
  await prisma.wordProgress.update({
    where: { vocabularyId },
    data: {
      ...cardData(next),
      correctCount: progress.correctCount + (correct ? 1 : 0),
      incorrectCount: progress.incorrectCount + (correct ? 0 : 1),
      familiarity,
      recallAbility,
    },
  });
  await prisma.reviewEvent.create({
    data: {
      vocabularyId,
      mode: "formal",
      rating,
      dueBefore: progress.due,
      dueAfter: next.due,
      changedSchedule: true,
    },
  });
  await mirrorLemma(vocabularyId);
  return {
    due: next.due,
    familiarity,
    intervals: previewDays(next),
    changedSchedule: true,
    note: "这次已计入正式复习，下次时间由 FSRS 重新计算。",
  };
}

export async function practiceWord(vocabularyId: string, rating: RatingName) {
  const progress = await prisma.wordProgress.findUnique({ where: { vocabularyId } });
  if (!progress) throw new AppError(404, "NOT_FOUND", "找不到这个词的复习记录");
  await prisma.reviewEvent.create({
    data: {
      vocabularyId,
      mode: "practice",
      rating,
      dueBefore: progress.due,
      dueAfter: progress.due,
      changedSchedule: false,
    },
  });
  return {
    due: progress.due,
    familiarity: progress.familiarity,
    changedSchedule: false,
    note: "这次是提前练习。原定复习时间、正式复习次数和记忆等级都没有改变。",
  };
}

export async function markKnown(vocabularyId: string) {
  await prisma.vocabulary.update({ where: { id: vocabularyId }, data: { knownAlready: true } });
  return rateWord(vocabularyId, "easy", "recall");
}

export async function easierExample(vocabularyId: string, confirmCost: boolean) {
  const word = await prisma.vocabulary.findUnique({ where: { id: vocabularyId }, include: { lesson: true } });
  if (!word) throw new AppError(404, "NOT_FOUND", "找不到这个词");
  const hasKey = Boolean(process.env.LLM_API_KEY?.trim());
  if (!hasKey) {
    const found = BANK.find((item) => item.lemma.toLowerCase() === word.lemma.toLowerCase());
    const example = found?.easierExample;
    const exampleZh = found?.easierExampleZh;
    if (!example || !exampleZh || !example.toLowerCase().includes(word.lemma.toLowerCase())) {
      throw new AppError(400, "NO_EASIER", "离线词库没有更简单的例句，也没有配置 AI。");
    }
    await prisma.vocabulary.update({
      where: { id: vocabularyId },
      data: { example, exampleZh, exampleFlagged: true },
    });
    return { example, exampleZh, source: "offline-bank" };
  }
  if (!confirmCost) throw new AppError(400, "COST_NOT_CONFIRMED", "重写例句会再调用一次 AI，可能产生费用。请确认后再试。");
  const result = await chatJson(
    "easier-example",
    "只返回 JSON：{\"example\":\"\",\"exampleZh\":\"\"}。例句必须包含目标词，并且比原句更短、更简单。中文用简体。",
    JSON.stringify({ lemma: word.lemma, oldExample: word.example }),
  );
  const parsed = parseModelJson(result.content) as { example?: string; exampleZh?: string };
  if (!parsed.example || !parsed.exampleZh || !parsed.example.toLowerCase().includes(word.lemma.toLowerCase())) {
    throw new AppError(502, "AI_INVALID", "新例句没有通过校验，原例句保持不变。");
  }
  if (parsed.example.trim().split(/\s+/).length > 12) {
    throw new AppError(502, "AI_INVALID", "新例句仍然太长，原例句保持不变。");
  }
  await prisma.vocabulary.update({
    where: { id: vocabularyId },
    data: { example: parsed.example, exampleZh: parsed.exampleZh, exampleFlagged: true },
  });
  return { example: parsed.example, exampleZh: parsed.exampleZh, source: "ai" };
}

export async function dashboard(now = new Date()) {
  const settings = await getSettings();
  const today = localISODate(now);
  let lesson = await findLessonByDate(today);
  let generateError = "";
  const hasKey = Boolean(process.env.LLM_API_KEY?.trim());
  if (!lesson && (!hasKey || settings.autoGenerate)) {
    try {
      lesson = await ensureLesson(today);
    } catch (error) {
      generateError = error instanceof Error ? error.message : "生成失败";
    }
  }
  const due = await dueCount(now);
  const week = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const dayLesson = await prisma.dailyLesson.findFirst({
      where: { lessonDate: date, active: true },
      orderBy: { version: "desc" },
    });
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59`);
    const sessions = await prisma.studySession.findMany({ where: { createdAt: { gte: start, lte: end } } });
    week.push({
      date,
      minutes: sessions.reduce((sum, item) => sum + item.minutes, 0),
      hasLesson: Boolean(dayLesson),
      words: dayLesson?.newWordCount ?? 0,
    });
  }
  const recommendation = await recommend(settings.recommendationsEnabled, settings.dailyNewWords, due);
  return {
    date: today,
    dateLabel: today,
    settings,
    themeLabel: settings.theme === "Custom" ? settings.customTheme || "自定义" : THEME_ZH[settings.theme] || settings.theme,
    dueCount: due,
    estimatedMinutes: estimateMinutes(settings.dailyNewWords, due, settings.wordPartsEnabled),
    lesson: lesson ? presentLesson(lesson) : null,
    generateError,
    week,
    recommendation,
    resumeStep: lesson ? JSON.parse(lesson.progress).step : null,
    reviewedToday: (await canonicalProgress()).filter((row) => row.lastReview && row.lastReview >= new Date(now.getFullYear(), now.getMonth(), now.getDate())).length,
    upcoming: await upcomingReviews(now),
  };
}

async function upcomingReviews(now: Date) {
  const rows = (await canonicalProgress())
    .filter((row) => row.reps > 0)
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, 5);
  return rows.map((row) => ({
    id: row.vocabularyId,
    lemma: row.vocabulary.lemma,
    meaningZh: zhCN(row.vocabulary.meaningZh),
    due: row.due,
    lastReview: row.lastReview,
    familiarity: row.familiarity,
  }));
}

async function recommend(enabled: boolean, dailyNewWords: number, due: number) {
  if (!enabled) return null;
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const attempts = await prisma.quizAttempt.findMany({ where: { createdAt: { gte: since } } });
  const reviews = await prisma.wordProgress.findMany({ where: { lastReview: { gte: since }, reps: { gt: 0 } } });
  const sample = attempts.length + reviews.length;
  if (sample < 5) {
    return {
      tone: "wait",
      text: "最近的答题和复习记录还不够，先不判断你的水平有没有变化。",
    };
  }
  const quizRate = attempts.length ? attempts.filter((item) => item.correct).length / attempts.length : null;
  const forgot = reviews.filter((item) => item.familiarity === "forgot" || item.familiarity === "hard").length;
  const reviewRate = reviews.length ? 1 - forgot / reviews.length : null;
  if (due >= 15 && dailyNewWords > 4) {
    return {
      tone: "down",
      text: `今天有 ${due} 个旧词到期。建议先把新词从 ${dailyNewWords} 个暂时减到 ${Math.max(3, dailyNewWords - 2)} 个。这是根据复习量做的保守建议，不是通用最佳值。`,
    };
  }
  if (quizRate !== null && reviewRate !== null && quizRate < 0.55 && reviewRate < 0.6 && dailyNewWords > 4) {
    return {
      tone: "down",
      text: `近两周测验大约 ${Math.round(quizRate * 100)}%，回忆也不算稳。可以把新词暂时减到 ${Math.max(3, dailyNewWords - 2)} 个。你可以不接受。`,
    };
  }
  if (quizRate !== null && reviewRate !== null && quizRate > 0.85 && reviewRate > 0.8 && due < 8 && dailyNewWords < 12) {
    return {
      tone: "up",
      text: `近两周记录比较稳。如果学得轻松，可以把新词从 ${dailyNewWords} 个调到 ${dailyNewWords + 2} 个。这不是升级证明。`,
    };
  }
  return { tone: "keep", text: "最近的记录没有明显偏向，保持现在的新词数量就可以。" };
}

export async function library() {
  const words = await prisma.vocabulary.findMany({
    include: {
      progress: true,
      lesson: { select: { id: true, lessonDate: true, listeningTitle: true, version: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return words.map((word) => ({
    id: word.id,
    lemma: word.lemma,
    pos: word.pos,
    ipa: word.ipa,
    ipaNote: word.ipaNote,
    meaningZh: zhCN(word.meaningZh),
    definitionEn: word.definitionEn,
    collocation: word.collocation,
    example: word.example,
    exampleZh: zhCN(word.exampleZh),
    morphology: parseMorphology(word.morphology),
    knownAlready: word.knownAlready,
    familiarity: word.progress?.familiarity ?? "new",
    due: word.progress?.due ?? null,
    lastReview: word.progress?.lastReview ?? null,
    reps: word.progress?.reps ?? 0,
    theme: word.theme,
    difficulty: word.difficulty,
    lessonId: word.lesson?.id ?? word.lessonId,
    lessonDate: word.lesson?.lessonDate ?? null,
    lessonTitle: word.lesson?.listeningTitle ?? "",
    lessonVersion: word.lesson?.version ?? null,
  }));
}

function parseMorphology(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { prefix?: string | null; root?: string; suffix?: string | null; meaningZh?: string };
    if (!parsed.root) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function reviewQueue(now = new Date(), filter = "due", query = "") {
  const rows = await canonicalProgress();
  const soon = now.getTime() + 48 * 60 * 60 * 1000;
  const needle = query.trim().toLowerCase();
  return rows
    .filter((row) => {
      const word = row.vocabulary;
      if (needle && !word.lemma.toLowerCase().includes(needle) && !word.meaningZh.includes(query.trim())) return false;
      if (filter === "due") return row.reps > 0 && row.due <= now && !word.knownAlready;
      if (filter === "soon") return row.due.getTime() > now.getTime() && row.due.getTime() <= soon;
      if (filter === "weak") return row.familiarity === "forgot" || row.familiarity === "hard" || row.lapses > 0;
      if (filter === "known") return word.knownAlready || row.familiarity === "easy";
      return row.reps > 0 || word.knownAlready;
    })
    .map((row) => ({
      id: row.vocabulary.id,
      lemma: row.vocabulary.lemma,
      pos: row.vocabulary.pos,
      ipa: row.vocabulary.ipa,
      meaningZh: zhCN(row.vocabulary.meaningZh),
      example: row.vocabulary.example,
      exampleZh: zhCN(row.vocabulary.exampleZh),
      familiarity: row.familiarity,
      reps: row.reps,
      due: row.due,
      lastReview: row.lastReview,
      knownAlready: row.vocabulary.knownAlready,
      intervals: previewDays(storedFrom(row), now),
    }));
}

export async function stats() {
  const words = await prisma.vocabulary.count();
  const known = await prisma.vocabulary.count({ where: { knownAlready: true } });
  const attempts = await prisma.quizAttempt.findMany();
  const reviews = await prisma.wordProgress.count({ where: { reps: { gt: 0 } } });
  const minutes = await prisma.studySession.aggregate({ _sum: { minutes: true } });
  const usage = await prisma.aIUsageRecord.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return {
    words,
    known,
    reviews,
    minutes: minutes._sum.minutes ?? 0,
    quizTotal: attempts.length,
    quizCorrect: attempts.filter((item) => item.correct).length,
    usage: usage.map((item) => ({
      kind: item.kind,
      model: item.model,
      promptTokens: item.promptTokens,
      completionTokens: item.completionTokens,
      success: item.success,
      createdAt: item.createdAt,
    })),
  };
}

export async function history() {
  const lessons = await prisma.dailyLesson.findMany({ orderBy: [{ lessonDate: "desc" }, { version: "desc" }] });
  return lessons.map((lesson) => ({
    id: lesson.id,
    lessonDate: lesson.lessonDate,
    createdAt: lesson.createdAt,
    theme: THEME_ZH[lesson.theme] || lesson.theme,
    difficulty: lesson.difficulty,
    newWordCount: lesson.newWordCount,
    model: lesson.model,
    version: lesson.version,
    active: lesson.active,
    source: lesson.source,
    sourceLabel: sourceText(lesson.source),
    listeningTitle: lesson.listeningTitle,
    progress: safeProgress(lesson.progress),
  }));
}

function safeProgress(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sourceText(source: string) {
  if (source === "ai") return "AI 生成";
  if (source === "demo") return "示范课";
  return "离线词库";
}

export async function lessonVersions(lessonDate: string) {
  const lessons = await prisma.dailyLesson.findMany({ where: { lessonDate }, orderBy: { version: "asc" } });
  return lessons.map((lesson) => ({
    id: lesson.id,
    version: lesson.version,
    active: lesson.active,
    source: lesson.source,
    model: lesson.model,
    createdAt: lesson.createdAt,
    sourceLabel: sourceText(lesson.source),
  }));
}

export async function activateLesson(id: string) {
  const lesson = await prisma.dailyLesson.findUnique({ where: { id } });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到这个课程版本");
  await prisma.$transaction([
    prisma.dailyLesson.updateMany({ where: { lessonDate: lesson.lessonDate }, data: { active: false } }),
    prisma.dailyLesson.update({ where: { id }, data: { active: true } }),
  ]);
  const active = await findLessonByDate(lesson.lessonDate);
  if (!active) throw new AppError(404, "NOT_FOUND", "找不到这个课程版本");
  return presentLesson(active);
}

export async function createAiVersion(lessonDate: string) {
  if (!process.env.LLM_API_KEY?.trim()) {
    throw new AppError(400, "NO_LLM_KEY", "还没有配置 LLM_API_KEY，不能把课程标成 AI 生成。");
  }
  const settings = await getSettings();
  const theme = settings.theme === "Custom" && settings.customTheme.trim() ? settings.customTheme.trim() : settings.theme;
  const learned = await prisma.vocabulary.findMany({ select: { lemma: true } });
  const avoid = learned.map((item) => item.lemma.toLowerCase());
  const prior = await prisma.dailyLesson.findMany({
    where: { lessonDate: { lt: lessonDate } },
    distinct: ["lessonDate"],
    select: { lessonDate: true },
  });
  const latest = await prisma.dailyLesson.findFirst({ where: { lessonDate }, orderBy: { version: "desc" } });
  const draft = await generateAiDraft({
    count: settings.dailyNewWords,
    difficulty: settings.difficulty,
    theme,
    avoid,
    priorLessons: prior.length,
    listeningLevel: settings.listeningLevel,
    wordParts: settings.wordPartsEnabled,
    dueCount: await dueCount(),
  });
  if (draft.source !== "ai") throw new AppError(502, "AI_INVALID", "生成结果不是 AI 课程，已保留原课程。");
  const progress = {
    step: "review",
    completed: [] as string[],
    wordIndex: 0,
    listening: { round: 1, firstGist: "", thirdGist: "", recall: "", recallNote: "", recallMode: "" },
    shadow: { index: 0, marks: draft.listeningChunks.map(() => null) },
  };
  const memory = await loadMemory();
  const created = await prisma.$transaction(async (tx) => {
    await tx.dailyLesson.updateMany({ where: { lessonDate }, data: { active: false } });
    return tx.dailyLesson.create({
      data: {
        lessonDate,
        version: (latest?.version ?? 0) + 1,
        active: true,
        theme: settings.theme === "Custom" ? theme : settings.theme,
        difficulty: settings.difficulty,
        newWordCount: draft.words.length,
        estimatedMinutes: draft.estimatedMinutes,
        source: "ai",
        model: process.env.LLM_MODEL || null,
        poolNote: draft.poolNote,
        progress: JSON.stringify(progress),
        listeningTitle: draft.listeningTitle,
        listeningText: draft.listeningText,
        listeningChunks: JSON.stringify(draft.listeningChunks),
        listeningGloss: JSON.stringify(draft.listeningGloss),
        words: {
          create: draft.words.map((word) => ({
            lemma: word.lemma,
            pos: word.pos,
            ipa: word.ipa,
            ipaNote: word.ipaNote,
            stress: word.stress,
            meaningZh: zhCN(word.meaningZh),
            definitionEn: word.definitionEn,
            collocation: word.collocation,
            example: word.example,
            exampleZh: zhCN(word.exampleZh),
            morphology: word.morphology ? JSON.stringify(word.morphology) : null,
            difficulty: word.difficulty,
            theme: word.theme,
            progress: { create: rememberedCard(memory, word.lemma) },
          })),
        },
        questions: {
          create: draft.questions.map((question, index) => ({
            sortOrder: index,
            kind: question.kind,
            prompt: question.prompt,
            options: JSON.stringify(question.options),
            answerIndex: question.answerIndex,
            explanationEn: question.explanationEn,
            explanationZh: question.explanationZh,
            simplerZh: question.simplerZh,
            evidence: question.evidence,
            whyWrong: JSON.stringify(question.whyWrong),
          })),
        },
      },
      include: lessonInclude,
    });
  });
  return presentLesson(created);
}

export async function addSession(lessonId: string | null, module: string, minutes: number) {
  const safe = Math.max(0, Math.min(40, Math.round(minutes)));
  if (!safe) return { ok: true };
  await prisma.studySession.create({ data: { lessonId, module, minutes: safe } });
  return { ok: true };
}

export async function lessonById(id: string) {
  const lesson = await prisma.dailyLesson.findUnique({ where: { id }, include: lessonInclude });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到这节课");
  return presentLesson(lesson);
}

export async function recallCheck(lessonId: string, text: string) {
  const row = await prisma.dailyLesson.findUnique({ where: { id: lessonId }, include: lessonInclude });
  if (!row) throw new AppError(404, "NOT_FOUND", "找不到这节课");
  const trimmed = text.trim();
  if (trimmed.length < 2) throw new AppError(400, "EMPTY", "请先用简短的话写下你听到的主要内容");
  const hasKey = Boolean(process.env.LLM_API_KEY?.trim());
  if (!hasKey) {
    const gloss = JSON.parse(row.listeningGloss) as Record<string, string>;
    const hits = Object.entries(gloss).filter(([lemma, meaning]) => trimmed.toLowerCase().includes(lemma) || trimmed.includes(meaning));
    return {
      mode: "local-heuristic",
      understood: hits.length >= 1 || trimmed.length >= 8,
      note: "这不是 AI 评分，只是检查你有没有提到今天短文里的词或大意。抓住主要情景即可，不要求逐字复述。",
      hits: hits.map(([lemma]) => lemma),
    };
  }
  const result = await chatJson(
    "recall",
    "判断学习者是否理解大意，不要要求逐字复述。只返回 JSON：{\"understood\":true,\"note\":\"简体中文，两句以内\"}",
    JSON.stringify({ passage: row.listeningText, answer: trimmed }),
  );
  const parsed = parseModelJson(result.content) as { understood?: boolean; note?: string };
  if (typeof parsed.understood !== "boolean" || !parsed.note) {
    throw new AppError(502, "AI_INVALID", "AI 没有返回可用的理解判断。你的原文已保留在页面上。");
  }
  return { mode: "ai", understood: parsed.understood, note: parsed.note, hits: [] };
}
