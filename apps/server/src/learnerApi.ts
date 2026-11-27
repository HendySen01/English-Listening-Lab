import { normalizeSpeechRate } from "./speechRates.js";
import { passages, savedTranslations, vocabularyGloss } from "./listeningTranslations.js";
// 业务读写只接受已经验证的 Learner。资源 ID 先按当前用户查找。
import type { VerifiedLearner } from "./learnerIdentity.js";
import { assertPaidAiMock } from "./learnerAiGuard.js";
import { ownQuota, withAiCharge } from "./learnerQuota.js";
import { practiceOwnWord, rateOwnWord } from "./learnerReview.js";
import { AppError } from "./errors.js";
import { THEME_ZH } from "./content.js";
import { readStudyTimeZone, studyDate, studyDayBounds, studyNow, studyWeek } from "./studyTime.js";
import { previewDays, previewMinutes, type RatingName } from "./srs.js";
import { learnerDb } from "./runtimeClients.js";
import { studyPreferences, updateStudyPreferences } from "./studyPreferences.js";
import { createHash, randomUUID } from "node:crypto";
import { deepseekLessonRequest } from "./deepseekLesson.js";
import { lockLearnerScope, learnerTransactionOptions } from "./learnerLock.js";
import { reviewGroups, reviewRows, reviewState, senseKey } from "./reviewSenses.js";
import { vocabularyIpa } from "./pronunciation.js";

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

function lessonDirection(progress: string, difficulty: string): string | null {
  const direction = JSON.parse(progress || "{}")?.generation?.direction;
  return typeof direction === "string" ? direction : difficulty === "CET-4" ? "cet4" : null;
}

type ReviewGroups = ReturnType<typeof reviewGroups>;
function reviewContextMap(groups: ReviewGroups) {
  return new Map(groups.flatMap((group) => group.map((row) => [row.vocabularyId, group[0]] as const)));
}

function presentProgress(raw: string) {
  const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  const listening = parsed.listening && typeof parsed.listening === "object" ? parsed.listening as Record<string, unknown> : {};
  const shadow = parsed.shadow && typeof parsed.shadow === "object" ? parsed.shadow as Record<string, unknown> : {};
  return {
    step: typeof parsed.step === "string" ? parsed.step : "review",
    completed: Array.isArray(parsed.completed) ? parsed.completed : [],
    wordIndex: Number.isInteger(parsed.wordIndex) ? parsed.wordIndex : 0,
    listening: {
      round: typeof listening.round === "number" ? listening.round : 1,
      firstGist: typeof listening.firstGist === "string" ? listening.firstGist : "",
      thirdGist: typeof listening.thirdGist === "string" ? listening.thirdGist : "",
      recall: typeof listening.recall === "string" ? listening.recall : "",
      recallNote: typeof listening.recallNote === "string" ? listening.recallNote : "",
      recallMode: typeof listening.recallMode === "string" ? listening.recallMode : "",
    },
    shadow: {
      index: typeof shadow.index === "number" ? shadow.index : 0,
      marks: Array.isArray(shadow.marks) ? shadow.marks : [],
    },
  };
}

function sourceLabel(source: string) {
  if (source === "ai") return "AI 生成";
  if (source === "demo") return "示范课";
  if (source === "offline") return "离线词库";
  return "当前账号课程";
}

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
  words?: Array<{
    id: string;
    lemma: string;
    pos: string;
    ipa: string | null;
    ipaNote: string;
    stress: string | null;
    meaningZh: string;
    definitionEn: string;
    collocation: string;
    example: string;
    exampleZh: string;
    morphology: string | null;
    knownAlready: boolean;
    progress: {
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
      familiarity: string;
      correctCount: number;
      incorrectCount: number;
    } | null;
  }>;
  questions?: Array<{
    id: string;
    kind: string;
    prompt: string;
    options: string;
    answerIndex: number;
    explanationEn: string | null;
    explanationZh: string | null;
    evidence: string | null;
    whyWrong: string;
    attempts: Array<{ selected: number; correct: boolean }>;
  }>;
}) {
  return {
    id: lesson.id,
    lessonDate: lesson.lessonDate,
    version: lesson.version,
    active: lesson.active,
    theme: lesson.theme,
    themeLabel: THEME_ZH[lesson.theme] || lesson.theme,
    difficulty: lesson.difficulty === "CET-4" ? "B1" : lesson.difficulty,
    learningDirection: lessonDirection(lesson.progress, lesson.difficulty),
    newWordCount: lesson.newWordCount,
    estimatedMinutes: lesson.estimatedMinutes,
    source: lesson.source,
    sourceLabel: sourceLabel(lesson.source),
    model: lesson.model,
    progress: presentProgress(lesson.progress),
    listening: {
      title: lesson.listeningTitle,
      text: lesson.listeningText,
      chunks: JSON.parse(lesson.listeningChunks) as string[],
      gloss: vocabularyGloss(JSON.parse(lesson.listeningGloss)),
      translations: savedTranslations(passages(JSON.parse(lesson.listeningChunks),lesson.listeningText),JSON.parse(lesson.listeningGloss)),
    },
    words: (lesson.words || []).map((word) => ({
      id: word.id,
      lemma: word.lemma,
      pos: word.pos,
      ipa: vocabularyIpa(word.lemma, word.ipa),
      ipaNote: word.ipaNote,
      stress: word.stress,
      meaningZh: word.meaningZh,
      definitionEn: word.definitionEn,
      collocation: word.collocation,
      example: word.example,
      exampleZh: word.exampleZh,
      morphology: word.morphology ? JSON.parse(word.morphology) : null,
      knownAlready: word.knownAlready,
      familiarity: word.progress?.familiarity ?? "new",
      reps: word.progress?.reps ?? 0,
      due: word.progress?.due ?? null,
      lastReview: word.progress?.lastReview ?? null,
      lapses: word.progress?.lapses ?? 0,
      state: word.progress?.state ?? 0,
      correctCount: word.progress?.correctCount ?? 0,
      incorrectCount: word.progress?.incorrectCount ?? 0,
      intervals: word.progress ? previewDays(word.progress, new Date()) : null,
      intervalMinutes: word.progress ? previewMinutes(word.progress,new Date()) : null,
    })),
    questions: (lesson.questions || []).map((question) => {
      const attempt = question.attempts[question.attempts.length - 1];
      return {
        id: question.id,
        kind: question.kind,
        prompt: question.prompt,
        options: JSON.parse(question.options) as string[],
        answered: Boolean(attempt),
        selected: attempt?.selected ?? null,
        correct: attempt?.correct ?? null,
        answerIndex: attempt ? question.answerIndex : null,
        explanationEn: attempt ? question.explanationEn : null,
        explanationZh: attempt ? question.explanationZh : null,
        evidence: attempt ? question.evidence : null,
        whyWrong: attempt ? JSON.parse(question.whyWrong) : null,
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
    difficulty: lesson.difficulty === "CET-4" ? "B1" : lesson.difficulty,
    learningDirection: lessonDirection(lesson.progress, lesson.difficulty),
    newWordCount: lesson.newWordCount,
    estimatedMinutes: lesson.estimatedMinutes,
    themeLabel: THEME_ZH[lesson.theme] || lesson.theme,
    source: lesson.source,
    sourceLabel: sourceLabel(lesson.source),
    listeningTitle: lesson.listeningTitle,
    progress: presentProgress(lesson.progress),
  }));
}

export async function ownLesson(learner: VerifiedLearner, id: string) {
  const lesson = await db().dailyLesson.findFirst({ where: { id, userId: learner.learnerId }, include: lessonInclude });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到资源");
  return presentOwnedLesson(lesson, learner.learnerId);
}

async function presentOwnedLesson(
  lesson: Parameters<typeof presentLesson>[0], userId: string,
  context?: ReturnType<typeof reviewContextMap>,
) {
  const cards = context ?? reviewContextMap(reviewGroups(await reviewRows(db(), userId)));
  return presentLesson({
    ...lesson,
    words: lesson.words?.map((word) => {
      const card = cards.get(word.id);
      return card ? { ...word, progress: card, knownAlready: card.vocabulary.knownAlready } : word;
    }),
  });
}

export async function ownLessonVersions(learner: VerifiedLearner, lessonDate: string) {
  const lessons = await db().dailyLesson.findMany({
    where: { userId: learner.learnerId, lessonDate },
    select: { id: true, version: true, active: true, source: true, model: true, createdAt: true,
      theme: true, difficulty: true, newWordCount: true, estimatedMinutes: true, progress: true },
    orderBy: { version: "asc" },
  });
  return lessons.map(({ progress, ...lesson }) => ({
    ...lesson, sourceLabel: sourceLabel(lesson.source), themeLabel: THEME_ZH[lesson.theme] || lesson.theme,
    difficulty: lesson.difficulty === "CET-4" ? "B1" : lesson.difficulty,
    learningDirection: lessonDirection(progress, lesson.difficulty),
  }));
}

export async function activateOwnLesson(learner: VerifiedLearner, id: string) {
  const lesson = await db().dailyLesson.findFirst({ where: { id, userId: learner.learnerId } });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到资源");
  await db().$transaction(async (tx) => {
    await lockLearnerScope(tx, `lesson:${learner.learnerId}:${lesson.lessonDate}`);
    await tx.dailyLesson.updateMany({ where: { userId: learner.learnerId, lessonDate: lesson.lessonDate }, data: { active: false } });
    await tx.dailyLesson.updateMany({ where: { id, userId: learner.learnerId }, data: { active: true } });
  }, learnerTransactionOptions());
  return ownLesson(learner, id);
}

export async function saveOwnLessonProgress(learner: VerifiedLearner, id: string, progress: unknown) {
  if (!progress || typeof progress !== "object") throw new AppError(400, "BAD_PROGRESS", "进度格式不正确");
  const where = { id, userId: learner.learnerId };
  const existing = await db().dailyLesson.findFirst({ where, select: { progress: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "找不到资源");
  const generation = JSON.parse(existing.progress || "{}")?.generation;
  const updated = await db().dailyLesson.updateMany({
    where,
    data: { progress: JSON.stringify({ ...progress, generation }) },
  });
  if (updated.count !== 1) throw new AppError(404, "NOT_FOUND", "找不到资源");
  return ownLesson(learner, id);
}

function newReviewCard(now: Date) {
  return {
    due: now, stability: 0.5, difficulty: 5, elapsedDays: 0, scheduledDays: 0,
    learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null,
    correctCount: 0, incorrectCount: 0, familiarity: "new", recallAbility: "again",
  };
}

function reusableReviews(groups: ReviewGroups) {
  const cards = new Map<string, ReviewGroups[number][number]>();
  const ambiguous = new Set<string>();
  for (const [card] of groups) {
    const key = senseKey(card.vocabulary);
    if (cards.has(key)) {
      cards.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) cards.set(key, card);
  }
  return cards;
}

async function createOfflineLesson(learner: VerifiedLearner, lessonDate: string, source: string) {
  const userId = learner.learnerId;
  const createdAt = new Date();
  const id = await db().$transaction(async (tx) => {
    await lockLearnerScope(tx, `lesson:${userId}:${lessonDate}`);
    await lockLearnerScope(tx, `fsrs:${userId}`);
    const where = { userId, lessonDate };
    const latest = await tx.dailyLesson.findFirst({ where, orderBy: { version: "desc" } });
    if (source === "offline" && latest?.active && await tx.vocabulary.count({ where: { userId, lessonId: latest.id } })) return latest.id;
    const version = (latest?.version ?? 0) + 1;
    const id = `lesson_${userId}_${lessonDate}_${source}_${version}`;
    const wordId = `vocab_${id}_schedule`;
    const word = { lemma: "schedule", pos: "verb", meaningZh: "安排", definitionEn: "to plan a time for something" };
    const prior = reusableReviews(reviewGroups(await reviewRows(tx, userId))).get(senseKey(word));
    await tx.dailyLesson.updateMany({ where, data: { active: false } });
    await tx.dailyLesson.create({
      data: {
        id, userId, lessonDate, version, active: true, theme: "Daily Life", difficulty: "A2",
        newWordCount: 1, estimatedMinutes: 5, source, model: source === "ai" ? "mock" : null,
        poolNote: "", progress: "{}", listeningTitle: source,
        listeningText: "I need to schedule a short appointment today.",
        listeningChunks: "[]", listeningGloss: JSON.stringify({ schedule: "安排" }), createdAt,
      },
    });
    await tx.vocabulary.create({
      data: {
        ...word, id: wordId, userId, lessonId: id, ipaNote: "", collocation: "schedule a meeting",
        example: "I need to schedule a short appointment today.", exampleZh: "我今天需要安排一个短会面。",
        difficulty: "A2", theme: "Daily Life", knownAlready: prior?.vocabulary.knownAlready ?? false,
        exampleFlagged: false, createdAt,
      },
    });
    await tx.wordProgress.create({
      data: {
        ...(prior ? reviewState(prior) : newReviewCard(createdAt)),
        id: `progress_${wordId}`, vocabularyId: wordId, userId, firstLearnedAt: createdAt,
      },
    });
    return id;
  }, learnerTransactionOptions());
  return ownLesson(learner, id);
}

export async function ensureOwnToday(learner: VerifiedLearner, now = studyNow()) {
  const lessonDate = studyDate(now);
  const existing = await db().dailyLesson.findFirst({
    where: { userId: learner.learnerId, lessonDate, active: true },
    include: lessonInclude,
  });
  if (existing) {
    if (existing.words.length === 0) return createOfflineLesson(learner, lessonDate, "offline");
    return presentOwnedLesson(existing, learner.learnerId);
  }
  return createOfflineLesson(learner, lessonDate, "offline");
}

export async function createOwnAiVersion(learner: VerifiedLearner, clientRequestId?: unknown, inputTokens?: unknown, now = studyNow()) {
  const declared = typeof inputTokens === "number" ? inputTokens : undefined;
  if (process.env.AI_REAL_CALLS === "1") {
    const userId = learner.learnerId;
    const [settings, recent, priorLessons, dueCount] = await Promise.all([
      ownSettings(learner),
      db().vocabulary.findMany({ where: { userId }, select: { lemma: true }, orderBy: { createdAt: "desc" }, take: 32 }),
      db().dailyLesson.count({ where: { userId, active: true } }),
      reviewRows(db(), userId).then((rows) => reviewGroups(rows).filter(([row]) => row.due <= now && !row.vocabulary.knownAlready).length),
    ]);
    const request = deepseekLessonRequest(settings, [...new Set(recent.map(({ lemma }) => lemma.slice(0, 60)))], priorLessons, dueCount);
    const requestId = clientRequestId ?? crypto.randomUUID();
    const id = `lesson_${createHash("sha256").update(JSON.stringify([userId, String(requestId).trim()])).digest("hex")}`;
    const result = await withAiCharge({
      learner, requestId, kind: "lesson", now, model: request.model,
      inputTokens: request.inputTokens, outputTokens: request.outputTokens,
    }, async () => ({ draft: await request.generate(), lessonDate: studyDate(now), model: request.model, direction: settings.learningDirection }));
    const { draft, lessonDate, model, direction } = result.value;
    if (!draft) throw new AppError(409, "AI_REQUEST_CONFLICT", "请重新发起课程生成。");
    await db().$transaction(async (tx) => {
      await lockLearnerScope(tx, `lesson:${userId}:${lessonDate}`);
      await lockLearnerScope(tx, `fsrs:${userId}`);
      if (await tx.dailyLesson.findFirst({ where: { id, userId }, select: { id: true } })) return;
      const where = { userId, lessonDate };
      const latest = await tx.dailyLesson.findFirst({ where, orderBy: { version: "desc" }, select: { version: true } });
      await tx.dailyLesson.updateMany({ where, data: { active: false } });
      await tx.dailyLesson.create({
        data: {
          id, userId, lessonDate, version: (latest?.version ?? 0) + 1, active: true, createdAt: now,
          theme: draft.theme, difficulty: draft.difficulty, source: "ai", model,
          newWordCount: draft.words.length, estimatedMinutes: draft.estimatedMinutes,
          poolNote: draft.poolNote, progress: JSON.stringify({ generation: { direction } }),
          listeningTitle: draft.listeningTitle, listeningText: draft.listeningText,
          listeningChunks: JSON.stringify(draft.listeningChunks), listeningGloss: JSON.stringify(draft.listeningGloss),
        },
      });
      const reusable = reusableReviews(reviewGroups(await reviewRows(tx, userId)));
      const words = draft.words.map((word, index) => ({
        id: randomUUID(), lessonId: id, userId,
        lemma: word.lemma, pos: word.pos, ipa: word.ipa, ipaNote: word.ipaNote, meaningZh: word.meaningZh,
        definitionEn: word.definitionEn, collocation: word.collocation, example: word.example, exampleZh: word.exampleZh,
        morphology: word.morphology ? JSON.stringify(word.morphology) : null, difficulty: word.difficulty,
        theme: word.theme, knownAlready: reusable.get(senseKey(word))?.vocabulary.knownAlready ?? false, exampleFlagged: false, createdAt: new Date(now.getTime() + index),
      }));
      await tx.vocabulary.createMany({ data: words });
      await tx.wordProgress.createMany({ data: words.map((word) => {
        const prior = reusable.get(senseKey(word));
        return {
          ...(prior ? reviewState(prior) : newReviewCard(now)),
          id: randomUUID(), vocabularyId: word.id, userId, firstLearnedAt: now,
        };
      }) });
      await tx.quizQuestion.createMany({ data: draft.questions.map((question, sortOrder) => ({
        ...question, id: randomUUID(), lessonId: id, userId, sortOrder,
        options: JSON.stringify(question.options), whyWrong: JSON.stringify(question.whyWrong),
      })) });
    }, learnerTransactionOptions());
    return ownLesson(learner, id);
  }
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
  const cards = reviewContextMap(reviewGroups(await reviewRows(db(), learner.learnerId)));
  return words.map((word) => {
    const card = cards.get(word.id);
    const progress = card ?? word.progress;
    return {
      id: word.id,
      lemma: word.lemma,
      pos: word.pos,
      ipa: vocabularyIpa(word.lemma, word.ipa),
      ipaNote: word.ipaNote,
      meaningZh: word.meaningZh,
      definitionEn: word.definitionEn,
      collocation: word.collocation,
      example: word.example,
      exampleZh: word.exampleZh,
      morphology: word.morphology ? JSON.parse(word.morphology) : null,
      knownAlready: card?.vocabulary.knownAlready ?? word.knownAlready,
      familiarity: progress?.familiarity ?? "new",
      reps: progress?.reps ?? 0,
      lapses: progress?.lapses ?? 0,
      state: progress?.state ?? 0,
      due: progress?.due ?? null,
      lastReview: progress?.lastReview ?? null,
      correctCount: progress?.correctCount ?? 0,
      incorrectCount: progress?.incorrectCount ?? 0,
      stability: progress?.stability ?? null,
      lessonId: word.lesson?.id ?? null,
      lessonDate: word.lesson?.lessonDate ?? null,
      lessonTitle: word.lesson?.listeningTitle ?? "",
      userId: word.userId,
      reviewId: card?.vocabularyId ?? word.id,
    };
  });
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
  const groups = reviewGroups(await reviewRows(db(), userId));
  const untracked = await db().vocabulary.findMany({ where: { userId, progress: null }, select: { knownAlready: true } });
  const words = groups.length + untracked.length;
  const known = groups.filter(([row]) => row.vocabulary.knownAlready).length + untracked.filter((word) => word.knownAlready).length;
  const attempts = await db().quizAttempt.findMany({ where: { userId } });
  const reviews = groups.filter(([row]) => row.reps > 0).length;
  const minutes = await db().studySession.aggregate({ where: { userId }, _sum: { minutes: true } });
  const usage = await db().aIUsageRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });
  const charges = await readOwnCharges(userId);
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
    usage: usage.map((item) => ({ kind: item.kind, model: item.model, success: item.success, createdAt: item.createdAt, source: "AIUsageRecord" as const })),
    charges,
    studyTimeZone: readStudyTimeZone(),
    days: {
      lessons: countBy(lessons, (item) => item.lessonDate),
      sessions: sumBy(sessions, (item) => studyDate(item.createdAt), (item) => item.minutes),
      reviews: countBy(reviewEvents, (item) => studyDate(item.createdAt)),
      usage: countBy(usage, (item) => studyDate(item.createdAt)),
    },
  };
}

async function readOwnCharges(userId: string) {
  try {
    const charges = await db().aiCharge.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { kind: true, model: true, status: true, studyDate: true, createdAt: true },
    });
    return charges.map((item) => ({
      kind: item.kind,
      model: item.model,
      status: item.status,
      studyDate: item.studyDate,
      createdAt: item.createdAt,
      mock: item.model === "mock",
      source: "AiCharge" as const,
    }));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "P2021") return null;
    throw error;
  }
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

export const settingDefaults = {
  dailyNewWords: 6,
  difficulty: "A2",
  learningDirection: "general",
  customLearningGoal: "",
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
  if (current) return studyPreferences(current);
  return studyPreferences(await db().userSettings.create({
    data: { id: `settings_${learner.learnerId}`, userId: learner.learnerId, ...settingDefaults, updatedAt: new Date() },
  }));
}

export async function updateOwnSettings(learner: VerifiedLearner, input: Record<string, unknown>) {
  const current = await ownSettings(learner);
  const themes = Object.keys(THEME_ZH);
  const modes = ["light", "dark", "system"];
  return db().userSettings.update({
    where: { userId: learner.learnerId },
    data: {
      dailyNewWords: input.dailyNewWords === undefined ? undefined : clamp(input.dailyNewWords, 3, 20, current.dailyNewWords),
      dailyMinutes: input.dailyMinutes === undefined ? undefined : clamp(input.dailyMinutes, 20, 180, current.dailyMinutes),
      ...(["difficulty", "listeningLevel", "learningDirection", "customLearningGoal"].some((key) => key in input)
        ? updateStudyPreferences(current, input) : {}),
      theme: input.theme === undefined ? undefined : themes.includes(String(input.theme)) ? String(input.theme) : current.theme,
      customTheme: input.customTheme === undefined ? undefined : String(input.customTheme ?? current.customTheme).slice(0, 40),
      autoGenerate: input.autoGenerate === undefined ? undefined : typeof input.autoGenerate === "boolean" ? input.autoGenerate : current.autoGenerate,
      wordPartsEnabled: input.wordPartsEnabled === undefined ? undefined : typeof input.wordPartsEnabled === "boolean" ? input.wordPartsEnabled : current.wordPartsEnabled,
      recommendationsEnabled: input.recommendationsEnabled === undefined ? undefined : typeof input.recommendationsEnabled === "boolean" ? input.recommendationsEnabled : current.recommendationsEnabled,
      colorMode: input.colorMode === undefined ? undefined : modes.includes(String(input.colorMode)) ? String(input.colorMode) : current.colorMode,
      speechRate: input.speechRate === undefined ? undefined : normalizeSpeechRate(input.speechRate, current.speechRate),
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
  const lessonRow = await db().dailyLesson.findFirst({
    where: { userId: learner.learnerId, lessonDate: today, active: true },
    include: lessonInclude,
  });
  const groups = reviewGroups(await reviewRows(db(), learner.learnerId));
  const lesson = lessonRow ? await presentOwnedLesson(lessonRow, learner.learnerId, reviewContextMap(groups)) : null;
  const rows = groups.map(([row]) => row);
  const dueCount = rows.filter((row) => row.due <= now && !row.vocabulary.knownAlready).length;
  const historyRows = await db().dailyLesson.findMany({
    where: { userId: learner.learnerId },
    select: { id: true, lessonDate: true, version: true, active: true },
    orderBy: [{ lessonDate: "desc" }, { version: "desc" }],
  });
  const history = [...new Set(historyRows.map((item) => item.lessonDate))].map((date) => ({
    date,
    lessons: historyRows.filter((item) => item.lessonDate === date).map((item) => ({ id: item.id, version: item.version, active: item.active })),
  }));
  const chart = studyWeek(now);
  const sessions = await db().studySession.findMany({
    where: { userId: learner.learnerId, createdAt: { gte: chart.start, lt: chart.end } },
    select: { createdAt: true, minutes: true },
  });
  const todayBounds = studyDayBounds(today);
  const reviewedToday = rows.filter((row) => row.lastReview && row.lastReview >= todayBounds.start && row.lastReview < todayBounds.end).length;
  const upcomingRows = rows.filter((row) => !row.vocabulary.knownAlready)
    .sort((a, b) => a.due.getTime() - b.due.getTime()).slice(0, 5);
  return {
    date: today,
    dateLabel: today,
    studyTimeZone: readStudyTimeZone(),
    dueCount,
    lesson,
    week: chart.summarize(sessions),
    weekToday: chart.today,
    history,
    settings,
    themeLabel: settings.theme === "Custom" ? settings.customTheme || "自定义" : THEME_ZH[settings.theme] || settings.theme,
    estimatedMinutes: lesson?.estimatedMinutes ?? settings.dailyMinutes,
    reviewedToday,
    upcoming: upcomingRows.map((row) => ({
      id: row.vocabularyId,
      lemma: row.vocabulary.lemma,
      meaningZh: row.vocabulary.meaningZh,
      due: row.due,
      lastReview: row.lastReview,
      familiarity: row.familiarity,
    })),
    recommendation: settings.recommendationsEnabled
      ? { tone: "wait", text: "最近的答题和复习记录还不够，先不判断你的水平有没有变化。" }
      : null,
    generateError: "",
  };
}

export async function ownReviewQueue(learner: VerifiedLearner, now = new Date(), filter = "due", query = "", focus = "") {
  const groups = reviewGroups(await reviewRows(db(), learner.learnerId))
    .sort(([a], [b]) => a.due.getTime() - b.due.getTime());
  const rows = groups.map(([row]) => row);
  const related = new Map(groups.map((group) => [group[0].vocabularyId, group]));
  const soon = now.getTime() + 48 * 60 * 60 * 1000;
  const needle = query.trim().toLowerCase();
  const matched = rows.filter((row) => {
    const word = row.vocabulary;
    if (needle && !word.lemma.toLowerCase().includes(needle) && !word.meaningZh.includes(query.trim())) return false;
    if (filter === "due") return row.due <= now && !word.knownAlready;
    if (filter === "soon") return !word.knownAlready && row.due.getTime() > now.getTime() && row.due.getTime() <= soon;
    if (filter === "weak") return row.familiarity === "forgot" || row.familiarity === "hard" || row.lapses > 0;
    if (filter === "known") return word.knownAlready || row.familiarity === "easy";
    return true;
  });
  return {
    historySupported: true,
    dueCount: rows.filter((row) => row.due <= now && !row.vocabulary.knownAlready).length,
    items: matched.map((row) => {
      const contexts = related.get(row.vocabularyId)!;
      const word = contexts.find((item) => item.vocabularyId === focus)?.vocabulary ?? row.vocabulary;
      return {
        id: row.vocabularyId,
        relatedIds: contexts.slice(1).map((item) => item.vocabularyId),
        lemma: word.lemma,
        pos: word.pos,
        ipa: vocabularyIpa(word.lemma, word.ipa),
        meaningZh: word.meaningZh,
        example: word.example,
        exampleZh: word.exampleZh,
        familiarity: row.familiarity,
        reps: row.reps,
        due: row.due,
        lastReview: row.lastReview,
        lapses: row.lapses,
        state: row.state,
        correctCount: row.correctCount,
        incorrectCount: row.incorrectCount,
        knownAlready: row.vocabulary.knownAlready,
        stability: row.stability,
        userId: row.userId,
        intervals: previewDays(row, now),
        intervalMinutes: previewMinutes(row, now),
      };
    }),
  };
}

// Read-only history for the selected sense group; never merge conflicting histories or other learners.
export async function ownReviewHistory(learner: VerifiedLearner, vocabularyId: string) {
  const rows=await reviewRows(db(),learner.learnerId);
  const group=reviewGroups(rows).find(items=>items.some(row=>row.vocabularyId===vocabularyId));
  if(!group)throw new AppError(404,"NOT_FOUND","找不到资源");
  return {events:await db().reviewEvent.findMany({
    where:{userId:learner.learnerId,vocabularyId:{in:group.map(row=>row.vocabularyId)},mode:"formal",changedSchedule:true},
    select:{id:true,rating:true,createdAt:true,dueAfter:true},
    orderBy:[{createdAt:"desc"},{id:"desc"}],take:20,
  })};
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
  const trimmed = text.trim();
  if (trimmed.length < 2) throw new AppError(400, "EMPTY", "请先用简短的话写下你听到的主要内容");
  const gloss = vocabularyGloss(JSON.parse(lesson.listeningGloss));
  const hits = Object.entries(gloss).filter(([lemma, meaning]) => trimmed.toLowerCase().includes(lemma.toLowerCase()) || trimmed.includes(meaning));
  return {
    mode: "local-heuristic",
    accepted: true,
    understood: hits.length >= 1 || trimmed.length >= 8,
    note: "这不是 AI 评分，只是检查你有没有提到今天短文里的词或大意。抓住主要情景即可，不要求逐字复述。",
    hits: hits.map(([lemma]) => lemma),
  };
}

export { explainOwnedPassage } from "./learnerExplanation.js";

export { ownQuota };

export { practiceOwnWord, rateOwnWord, type RatingName };
