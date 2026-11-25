import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import { deepseekLessonStatus } from "./deepseekLesson.js";
import { assertPaidAiMock } from "./learnerAiGuard.js";
import type { VerifiedLearner } from "./learnerIdentity.js";
import { aiOutputTokenLimit, assertRealSpendAllowed, ensureAiChargeTable, withAiCharge } from "./learnerQuota.js";
import { explanationSystemPrompt, lookupPreviewExplanation, promptVersion, validateExplanation } from "./previewExplain.js";
import { learnerDb } from "./runtimeClients.js";
import { vocabularyIpa } from "./pronunciation.js";

const plain = (text: string) => text.replace(/\s*\/\s*/g, " ").trim();

async function readContext(learner: VerifiedLearner, passageId: string, word: string, sentence: string) {
  passageId = passageId.trim();
  word = word.trim();
  sentence = sentence.trim();
  if (!passageId || !word || !sentence || passageId.length > 240 || word.length > 48 || sentence.length > 1500) {
    throw new AppError(400, "PREVIEW_INPUT", "需要目标词和完整句子。");
  }
  const sample = lookupPreviewExplanation(passageId, word, sentence);
  if (sample) return { sample, passageId, word, sentence, prefix: "" };

  const db = learnerDb();
  const userId = learner.learnerId;
  const vocabulary = /^(?:lesson:)?([^:]+):word:([^:]+)$/.exec(passageId);
  const chunk = /^([^:]+):chunk:(\d+)$/.exec(passageId);
  const lessonId = vocabulary?.[1] ?? chunk?.[1] ?? passageId.replace(/:listen$/, "");
  const lesson = lessonId === "none" ? null : await db.dailyLesson.findFirst({
    where: { id: lessonId, userId },
    select: { listeningText: true, listeningChunks: true },
  });
  const excerpts = lesson ? JSON.parse(lesson.listeningChunks) as string[] : [];
  const source = vocabulary ? await db.vocabulary.findFirst({
    where: { id: vocabulary[2], userId, lessonId: lessonId === "none" ? null : lessonId },
    select: { example: true },
  }) : null;
  const target = vocabulary ? source && [source.example, ...excerpts, lesson?.listeningText || ""]
    : chunk ? [excerpts[Number(chunk[2])] || ""]
      : lesson ? [lesson.listeningText, ...excerpts] : [];
  if (!target || !target.some(text => plain(text) === plain(sentence))) {
    throw new AppError(404, "NOT_FOUND", "找不到当前账号的语境。");
  }
  const digest = createHash("sha256").update(JSON.stringify([promptVersion, passageId, word.toLowerCase(), sentence])).digest("hex").slice(0, 56);
  return { sample: null, passageId, word, sentence, prefix: `explain-${digest}-` };
}

async function findRequest(learner: VerifiedLearner, prefix: string) {
  await ensureAiChargeTable();
  return learnerDb().aiCharge.findFirst({
    where: { userId: learner.learnerId, kind: "explain", requestId: { startsWith: prefix } },
    orderBy: { requestId: "desc" },
    select: { requestId: true, status: true, resultJson: true },
  });
}

export async function cachedOwnedExplanation(learner: VerifiedLearner, passageId: string, word: string, sentence: string) {
  const context = await readContext(learner, passageId, word, sentence);
  if (context.sample) return { ...context.sample, charged: false };
  const prior = await findRequest(learner, context.prefix);
  return prior?.status === "succeeded" && prior.resultJson
    ? { ...JSON.parse(prior.resultJson), source: "cache", charged: false }
    : { source: "miss" };
}

export async function explainOwnedPassage(learner: VerifiedLearner, passageId: string, word = "", sentence = "", _clientRequestId?: unknown) {
  const context = await readContext(learner, passageId, word, sentence);
  if (context.sample) return { ...context.sample, ok: true, charged: false };
  const prior = await findRequest(learner, context.prefix);
  if (prior?.status === "succeeded" && prior.resultJson) {
    return { ...JSON.parse(prior.resultJson), source: "cache", charged: false };
  }

  const configured = deepseekLessonStatus();
  if (process.env.AI_REAL_CALLS !== "1") assertPaidAiMock();
  assertRealSpendAllowed();
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new AppError(503, "AI_NOT_SENT", "尚未配置 DeepSeek 深度解析。");
  const nextAttempt = !prior ? 0 : Number(prior.requestId.slice(-6)) + Number(prior.status === "failed" || prior.status === "succeeded");
  const requestId = context.prefix + String(nextAttempt).padStart(6, "0");
  const input = JSON.stringify({ word: context.word, sentence: context.sentence });
  const outputTokens = Math.min(aiOutputTokenLimit(), 2400);
  const result = await withAiCharge({
    learner, kind: "explain", requestId, model: configured.model,
    inputTokens: Buffer.byteLength(explanationSystemPrompt + input) + 128, outputTokens,
  }, async () => {
    const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(70_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: configured.model, max_tokens: outputTokens, response_format: { type: "json_object" },
        ...(configured.model === "deepseek-flash" || configured.model.startsWith("deepseek-v4") ? { thinking: { type: "disabled" } } : {}),
        messages: [{ role: "system", content: explanationSystemPrompt }, { role: "user", content: input }],
      }),
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    const choice = body?.choices?.[0];
    const parsed = validateExplanation(choice?.message?.content);
    if (choice?.finish_reason !== "stop" || !parsed.ok) {
      throw new AppError(502, "AI_RESPONSE_REJECTED", "深度解析未返回完整结果，请稍后再试。");
    }
    return { ok: true, source: "live", model: configured.model, analysis: {
      ...parsed.data, pronunciation: vocabularyIpa(context.word) || "",
    } };
  });
  return { ...result.value, source: result.replayed ? "cache" : "live", charged: !result.replayed };
}
