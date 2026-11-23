// 所有读写都使用已经验证的 Learner.id。资源不属于该学习者时按不存在处理。
import { Prisma } from "./generated/user/index.js";
import type { VerifiedLearner } from "./learnerIdentity.js";
import { learnerDb } from "./runtimeClients.js";

export type ScopeResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

const missing: ScopeResult<never> = { ok: false, status: 404, code: "NOT_FOUND", message: "找不到资源" };

function db() {
  return learnerDb();
}

const lessonSelect = { id: true, lessonDate: true, version: true, theme: true, userId: true } as const;
const progressSelect = {
  id: true,
  vocabularyId: true,
  due: true,
  stability: true,
  difficulty: true,
  state: true,
  reps: true,
  lapses: true,
  lastReview: true,
  userId: true,
} as const;

export function listLessons(learner: VerifiedLearner) {
  return db().dailyLesson.findMany({ where: { userId: learner.learnerId }, select: lessonSelect, orderBy: { id: "asc" } });
}

export function getLesson(learner: VerifiedLearner, id: string) {
  return db().dailyLesson.findFirst({ where: { id, userId: learner.learnerId }, select: lessonSelect });
}

export function listVocabulary(learner: VerifiedLearner) {
  return db().vocabulary.findMany({
    where: { userId: learner.learnerId },
    select: { id: true, lemma: true, userId: true },
    orderBy: { id: "asc" },
  });
}

export function listProgress(learner: VerifiedLearner) {
  return db().wordProgress.findMany({ where: { userId: learner.learnerId }, select: progressSelect, orderBy: { id: "asc" } });
}

export function getProgress(learner: VerifiedLearner, vocabularyId: string) {
  return db().wordProgress.findFirst({ where: { vocabularyId, userId: learner.learnerId }, select: progressSelect });
}

export function listReviews(learner: VerifiedLearner) {
  return db().reviewEvent.findMany({
    where: { userId: learner.learnerId },
    select: { id: true, vocabularyId: true, clientRequestId: true, rating: true, userId: true },
    orderBy: { id: "asc" },
  });
}

export function listSessions(learner: VerifiedLearner) {
  return db().studySession.findMany({
    where: { userId: learner.learnerId },
    select: { id: true, lessonId: true, minutes: true, userId: true },
    orderBy: { id: "asc" },
  });
}

export function listUsage(learner: VerifiedLearner) {
  return db().aIUsageRecord.findMany({
    where: { userId: learner.learnerId },
    select: { id: true, kind: true, userId: true },
    orderBy: { id: "asc" },
  });
}

export function listAttempts(learner: VerifiedLearner) {
  return db().quizAttempt.findMany({
    where: { userId: learner.learnerId },
    select: { id: true, questionId: true, userId: true },
    orderBy: { id: "asc" },
  });
}

export function getAttempt(learner: VerifiedLearner, id: string) {
  return db().quizAttempt.findFirst({ where: { id, userId: learner.learnerId }, select: { id: true, questionId: true, userId: true } });
}

export async function recordReview(
  learner: VerifiedLearner,
  input: { vocabularyId: string; clientRequestId: string; rating: string },
): Promise<ScopeResult<{ id: string; userId: string; clientRequestId: string | null }>> {
  const requestId = input.clientRequestId.trim();
  if (!requestId) return { ok: false, status: 400, code: "REQUEST_INVALID", message: "请求号无效" };
  const word = await db().vocabulary.findFirst({
    where: { id: input.vocabularyId, userId: learner.learnerId },
    include: { progress: true },
  });
  if (!word?.progress) return missing;
  const existing = await db().reviewEvent.findFirst({ where: { userId: learner.learnerId, clientRequestId: requestId } });
  if (existing) return { ok: false, status: 409, code: "REQUEST_REUSED", message: "这个请求已经记录过。" };
  try {
    const created = await db().reviewEvent.create({
      data: {
        id: `review:${learner.learnerId}:${requestId}`,
        vocabularyId: word.id,
        clientRequestId: requestId,
        mode: "formal",
        rating: input.rating,
        dueBefore: word.progress.due,
        dueAfter: word.progress.due,
        changedSchedule: false,
        createdAt: new Date(),
        userId: learner.learnerId,
      },
      select: { id: true, userId: true, clientRequestId: true },
    });
    return { ok: true, value: created };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, status: 409, code: "REQUEST_REUSED", message: "这个请求已经记录过。" };
    }
    throw error;
  }
}

export async function updateOwnProgressReps(learner: VerifiedLearner, vocabularyId: string, reps: number): Promise<ScopeResult<{ reps: number; userId: string }>> {
  if (!Number.isInteger(reps) || reps < 0) return { ok: false, status: 400, code: "INVALID_PROGRESS", message: "复习次数不正确" };
  const updated = await db().wordProgress.updateMany({
    where: { vocabularyId, userId: learner.learnerId },
    data: { reps },
  });
  if (updated.count !== 1) return missing;
  const row = await db().wordProgress.findFirst({
    where: { vocabularyId, userId: learner.learnerId },
    select: { reps: true, userId: true },
  });
  if (!row) return missing;
  return { ok: true, value: row };
}
