import { createHash } from "node:crypto";
import type { VerifiedLearner } from "./learnerIdentity.js";
import { AppError } from "./errors.js";
import { deepseekLessonStatus } from "./deepseekLesson.js";
import { aiOutputTokenLimit, assertRealSpendAllowed, ensureAiChargeTable, withAiCharge } from "./learnerQuota.js";
import { learnerDb } from "./runtimeClients.js";
import { listeningFeedbackSystem, listeningFeedbackVersion, normalizeListeningAnswer, parseListeningFeedback, type ListeningFeedback } from "./listeningFeedbackContract.js";

const kind = "listening-feedback" as const;
type LessonInput = { id: string; listeningText: string; difficulty: string; progress: string };
type Saved = { answer: string; feedback: ListeningFeedback; model: string };
function key(lesson: LessonInput, answer: string) {
  const digest = createHash("sha256").update(JSON.stringify([listeningFeedbackVersion, lesson.id, lesson.listeningText, lesson.difficulty, answer])).digest("hex");
  return "lf-" + digest.slice(0, 56) + "-";
}
async function owned(learner: VerifiedLearner, id: string) {
  const lesson = await learnerDb().dailyLesson.findFirst({ where: { id, userId: learner.learnerId }, select: { id: true, listeningText: true, difficulty: true, progress: true } });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到课程。");
  return lesson;
}
function answerOf(lesson: LessonInput) {
  const answer = JSON.parse(lesson.progress || "{}")?.listening?.firstGist;
  return typeof answer === "string" ? answer.trim() : "";
}
async function latest(learner: VerifiedLearner, prefix: string) {
  await ensureAiChargeTable();
  return learnerDb().aiCharge.findFirst({
    where: { userId: learner.learnerId, kind, requestId: { startsWith: prefix } },
    orderBy: { requestId: "desc" },
    select: { requestId: true, status: true, resultJson: true },
  });
}
function cached(row: Awaited<ReturnType<typeof latest>>, lesson: LessonInput, answer: string): Saved | null {
  if (row?.status !== "succeeded" || !row.resultJson) return null;
  const value = JSON.parse(row.resultJson);
  if (value.answer !== answer || typeof value.model !== "string") throw new AppError(502, "AI_RESPONSE_REJECTED", "缓存批改结果不完整。");
  return { answer, model: value.model, feedback: parseListeningFeedback(value.feedback, lesson.listeningText) };
}
async function saveAnswer(learner: VerifiedLearner, id: string, answer: string) {
  // Only change the blind-listening answer, preserving generation and other learning progress.
  // Optimistic compare-and-swap prevents overwriting a concurrent progress update.
  for (let attempt = 0; attempt < 4; attempt++) {
    const lesson = await owned(learner, id);
    if (answerOf(lesson) === answer) return lesson;
    const progress = JSON.parse(lesson.progress || "{}");
    const next = JSON.stringify({ ...progress, listening: { ...progress.listening, firstGist: answer } });
    const updated = await learnerDb().dailyLesson.updateMany({
      where: { id, userId: learner.learnerId, progress: lesson.progress },
      data: { progress: next },
    });
    if (updated.count === 1) return { ...lesson, progress: next };
  }
  throw new AppError(409, "PROGRESS_CONFLICT", "学习进度正在更新，请再次提交答案。");
}
export async function readListeningFeedback(learner: VerifiedLearner, id: string) {
  const lesson = await owned(learner, id);
  const answer = answerOf(lesson);
  const prior = answer ? await latest(learner, key(lesson, answer)) : null;
  const result = cached(prior, lesson, answer);
  return { answer, feedback: result?.feedback ?? null, model: result?.model ?? null, source: result ? "cache" : "none" };
}
export async function submitListeningFeedback(learner: VerifiedLearner, id: string, raw: unknown, confirmCost: unknown) {
  await owned(learner, id);
  const answer = normalizeListeningAnswer(raw);
  if (confirmCost !== true) throw new AppError(400, "AI_CONFIRMATION_REQUIRED", "请点击提交 AI 批改。");
  const lesson = await saveAnswer(learner, id, answer);
  const prefix = key(lesson, answer);
  const prior = await latest(learner, prefix);
  const saved = cached(prior, lesson, answer);
  if (saved) return { ...saved, source: "cache", charged: false };
  // Rejected/unsent responses allow a new explicit submission; pending or uncertain requests never auto-retry.
  if (prior?.status === "pending" || prior?.status === "unknown") {
    throw new AppError(409, "AI_PENDING", "这份答案的上次请求仍在处理或结果不明确，没有再次调用 AI。");
  }
  assertRealSpendAllowed();
  const status = deepseekLessonStatus();
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new AppError(503, "AI_NOT_SENT", "AI 批改尚未配置，答案已保留。");
  const attempt = prior ? Number(prior.requestId.slice(-6)) + 1 : 0;
  const requestId = prefix + String(attempt).padStart(6, "0");
  const user = JSON.stringify({ transcript: lesson.listeningText, learnerAnswer: answer, level: lesson.difficulty });
  const outputTokens = Math.min(aiOutputTokenLimit(), 2200);
  const result = await withAiCharge<Saved>({
    learner, requestId, kind, model: status.model,
    inputTokens: Buffer.byteLength(listeningFeedbackSystem + user) + 128, outputTokens,
  }, async () => {
    const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const response = await fetch(base + "/chat/completions", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(70_000),
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: status.model, max_tokens: outputTokens, response_format: { type: "json_object" },
        ...(status.model === "deepseek-flash" || status.model.startsWith("deepseek-v4") ? { thinking: { type: "disabled" } } : {}),
        messages: [{ role: "system", content: listeningFeedbackSystem }, { role: "user", content: user }] }),
    }).catch(() => { throw new AppError(502, "AI_CONNECTION", "AI 批改暂未响应，答案已保留。"); });
    if (!response.ok) throw new AppError(502, "AI_RESPONSE_REJECTED", "AI 暂未返回可用批改，答案已保留。");
    const body = await response.json().catch(() => null);
    const choice = body?.choices?.[0];
    let rawResult: unknown;
    try {
      if (choice?.finish_reason !== "stop") throw new Error("incomplete");
      rawResult = JSON.parse(choice.message.content);
    } catch { throw new AppError(502, "AI_RESPONSE_REJECTED", "AI 批改结果不完整，答案已保留。"); }
    return { answer, model: status.model, feedback: parseListeningFeedback(rawResult, lesson.listeningText) };
  });
  return { ...result.value, source: result.replayed ? "cache" : "live", charged: !result.replayed };
}
