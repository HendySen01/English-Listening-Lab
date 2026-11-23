// 正式复习沿用现有 FSRS 计算、进度版本校验和事务。
// 查询、幂等和同形词镜像都限制在当前 Learner，不重算已有历史。
import { Prisma } from "./generated/user/index.js";
import type { VerifiedLearner } from "./learnerIdentity.js";
import { AppError } from "./errors.js";
import { previewDays, schedule, type RatingName, type StoredCard } from "./srs.js";
import { getUserPrisma } from "./userDatabase.js";

const requestIdPattern = /^[A-Za-z0-9_-]{8,80}$/;

type ProgressVersion = {
  due: Date;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
  correctCount: number;
  incorrectCount: number;
};

type ReviewClient = Pick<ReturnType<typeof getUserPrisma>, "wordProgress" | "vocabulary" | "reviewEvent">;

export function normalizeLearnerRequestId(value: unknown) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!requestIdPattern.test(text)) throw new AppError(400, "BAD_REQUEST_ID", "复习请求号不正确。");
  return text;
}

function readInstant(value: unknown) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) throw new AppError(400, "BAD_PROGRESS_VERSION", "复习进度时间不正确。请刷新后再评分。");
  return date;
}

function readCount(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError(400, "BAD_PROGRESS_VERSION", "缺少当前复习进度，请刷新后再评分。");
  }
  return value;
}

export function readLearnerProgressVersion(value: unknown): ProgressVersion {
  if (!value || typeof value !== "object") throw new AppError(400, "BAD_PROGRESS_VERSION", "缺少当前复习进度，请刷新后再评分。");
  const row = value as Record<string, unknown>;
  const due = readInstant(row.due);
  if (!due) throw new AppError(400, "BAD_PROGRESS_VERSION", "缺少当前复习进度，请刷新后再评分。");
  return {
    due,
    reps: readCount(row.reps),
    lapses: readCount(row.lapses),
    state: readCount(row.state),
    lastReview: readInstant(row.lastReview),
    correctCount: readCount(row.correctCount),
    incorrectCount: readCount(row.incorrectCount),
  };
}

function sameProgress(progress: ProgressVersion, expected: ProgressVersion) {
  return progress.due.getTime() === expected.due.getTime()
    && progress.reps === expected.reps
    && progress.lapses === expected.lapses
    && progress.state === expected.state
    && (progress.lastReview?.getTime() ?? null) === (expected.lastReview?.getTime() ?? null)
    && progress.correctCount === expected.correctCount
    && progress.incorrectCount === expected.incorrectCount;
}

function familiarityFor(rating: RatingName) {
  return rating === "again" ? "forgot" : rating === "hard" ? "hard" : rating === "easy" ? "easy" : "remembered";
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

class StaleProgress extends Error {}

async function replay(db: ReviewClient, learnerId: string, requestId: string, vocabularyId: string, mode: string, rating: string) {
  const existing = await db.reviewEvent.findFirst({ where: { userId: learnerId, clientRequestId: requestId } });
  if (!existing) return null;
  if (existing.vocabularyId !== vocabularyId || existing.mode !== mode || existing.rating !== rating) {
    throw new AppError(409, "REQUEST_REUSED", "这个请求号已经用于另一次复习，没有再次计分。");
  }
  const progress = await db.wordProgress.findFirst({ where: { vocabularyId, userId: learnerId } });
  if (!progress) throw new AppError(404, "NOT_FOUND", "找不到资源");
  return {
    due: existing.dueAfter,
    familiarity: progress.familiarity,
    intervals: previewDays(progress),
    changedSchedule: existing.changedSchedule,
    replayed: true,
    note: mode === "formal" ? "这次提交已经记录过，没有再次计分。" : "这次提前练习已经记录过，排程没有改变。",
  };
}

async function mirrorOwnLemma(db: ReviewClient, learnerId: string, vocabularyId: string) {
  const current = await db.wordProgress.findFirst({ where: { vocabularyId, userId: learnerId }, include: { vocabulary: true } });
  if (!current) return;
  const key = current.vocabulary.lemma.trim().toLowerCase();
  const siblings = (await db.vocabulary.findMany({ where: { userId: learnerId, NOT: { id: vocabularyId } } }))
    .filter((row) => row.lemma.trim().toLowerCase() === key);
  if (!siblings.length) return;
  const ids = siblings.map((row) => row.id);
  await db.wordProgress.updateMany({
    where: { userId: learnerId, vocabularyId: { in: ids } },
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
  await db.vocabulary.updateMany({
    where: { userId: learnerId, id: { in: ids } },
    data: { knownAlready: current.vocabulary.knownAlready },
  });
}

async function applyFormal(
  db: ReviewClient,
  learner: VerifiedLearner,
  vocabularyId: string,
  rating: RatingName,
  recallAbility: "recognize" | "recall",
  requestId: string | null,
  expected: ProgressVersion,
  markKnown: boolean,
) {
  if (requestId) {
    const prior = await replay(db, learner.learnerId, requestId, vocabularyId, "formal", rating);
    if (prior) {
      if (markKnown) {
        await db.vocabulary.updateMany({ where: { id: vocabularyId, userId: learner.learnerId }, data: { knownAlready: true } });
      }
      return prior;
    }
  }
  const progress = await db.wordProgress.findFirst({ where: { vocabularyId, userId: learner.learnerId } });
  if (!progress) throw new AppError(404, "NOT_FOUND", "找不到资源");
  if (!sameProgress(progress, expected)) throw new StaleProgress();
  if (markKnown) {
    const known = await db.vocabulary.updateMany({ where: { id: vocabularyId, userId: learner.learnerId }, data: { knownAlready: true } });
    if (known.count !== 1) throw new AppError(404, "NOT_FOUND", "找不到资源");
  }
  const next = schedule(progress, rating);
  const correct = rating === "good" || rating === "easy";
  const familiarity = familiarityFor(rating);
  const updated = await db.wordProgress.updateMany({
    where: {
      vocabularyId,
      userId: learner.learnerId,
      due: expected.due,
      reps: expected.reps,
      lapses: expected.lapses,
      state: expected.state,
      correctCount: expected.correctCount,
      incorrectCount: expected.incorrectCount,
      lastReview: expected.lastReview,
    },
    data: {
      ...cardData(next),
      correctCount: progress.correctCount + (correct ? 1 : 0),
      incorrectCount: progress.incorrectCount + (correct ? 0 : 1),
      familiarity,
      recallAbility,
    },
  });
  if (updated.count !== 1) throw new StaleProgress();
  await db.reviewEvent.create({
    data: {
      id: requestId ? `review:${learner.learnerId}:${requestId}` : `review:${learner.learnerId}:${crypto.randomUUID()}`,
      vocabularyId,
      clientRequestId: requestId,
      mode: "formal",
      rating,
      dueBefore: progress.due,
      dueAfter: next.due,
      changedSchedule: true,
      createdAt: new Date(),
      userId: learner.learnerId,
    },
  });
  await mirrorOwnLemma(db, learner.learnerId, vocabularyId);
  return {
    due: next.due,
    familiarity,
    intervals: previewDays(next),
    changedSchedule: true,
    replayed: false,
    note: "这次已计入正式复习，下次时间由 FSRS 重新计算。",
  };
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function rateOwnWord(
  learner: VerifiedLearner,
  vocabularyId: string,
  rating: RatingName,
  recallAbility: "recognize" | "recall",
  clientRequestId: unknown,
  expectedValue: unknown,
  markKnown = false,
) {
  const requestId = normalizeLearnerRequestId(clientRequestId);
  const expected = readLearnerProgressVersion(expectedValue);
  const db = getUserPrisma();
  try {
    return await db.$transaction((tx) => applyFormal(tx, learner, vocabularyId, rating, recallAbility, requestId, expected, markKnown));
  } catch (error) {
    if (error instanceof StaleProgress) {
      throw new AppError(409, "STALE_PROGRESS", "这个词的复习进度已经变了，这次评分没有写入。请刷新后再决定。");
    }
    if (requestId && isUniqueConflict(error)) {
      const prior = await replay(db, learner.learnerId, requestId, vocabularyId, "formal", rating);
      if (prior) return prior;
    }
    throw error;
  }
}

export async function practiceOwnWord(learner: VerifiedLearner, vocabularyId: string, rating: RatingName, clientRequestId: unknown) {
  const requestId = normalizeLearnerRequestId(clientRequestId);
  const db = getUserPrisma();
  try {
    return await db.$transaction(async (tx) => {
      if (requestId) {
        const prior = await replay(tx, learner.learnerId, requestId, vocabularyId, "practice", rating);
        if (prior) return prior;
      }
      const progress = await tx.wordProgress.findFirst({ where: { vocabularyId, userId: learner.learnerId } });
      if (!progress) throw new AppError(404, "NOT_FOUND", "找不到资源");
      await tx.reviewEvent.create({
        data: {
          id: requestId ? `practice:${learner.learnerId}:${requestId}` : `practice:${learner.learnerId}:${crypto.randomUUID()}`,
          vocabularyId,
          clientRequestId: requestId,
          mode: "practice",
          rating,
          dueBefore: progress.due,
          dueAfter: progress.due,
          changedSchedule: false,
          createdAt: new Date(),
          userId: learner.learnerId,
        },
      });
      return {
        due: progress.due,
        familiarity: progress.familiarity,
        intervals: previewDays(progress),
        changedSchedule: false,
        replayed: false,
        note: "这次是提前练习。原定复习时间、正式复习次数和记忆等级都没有改变。",
      };
    });
  } catch (error) {
    if (requestId && isUniqueConflict(error)) {
      const prior = await replay(db, learner.learnerId, requestId, vocabularyId, "practice", rating);
      if (prior) return prior;
    }
    throw error;
  }
}
