// 这些路由只挂在隔离多用户运行时。未列出的 /api 路径由调用方默认拒绝。
import express from "express";
import { isTrustedRequestOrigin } from "./auth.js";
import { AppError } from "./errors.js";
import { cachedOwnedExplanation, explainOwnedPassage } from "./learnerExplanation.js";
import {
  activateOwnLesson,
  addOwnSession,
  answerOwnQuestion,
  createOwnAiVersion,
  easierOwnExample,
  ensureOwnToday,
  ownDashboard,
  ownLesson,
  ownLessons,
  ownLessonVersions,
  ownLibrary,
  ownQuota,
  ownReviewQueue,
  ownSettings,
  ownStats,
  practiceOwnWord,
  rateOwnWord,
  recallOwnLesson,
  saveOwnLessonProgress,
  simplerOwnQuestion,
  updateOwnSettings,
} from "./learnerApi.js";
import { assertPaidAiMock, sendAuthorizedModelProbe } from "./learnerAiGuard.js";
import { withAiCharge } from "./learnerQuota.js";
import { resolveRequestLearner } from "./learnerIdentity.js";
import { studyDate, studyNow } from "./studyTime.js";
import { deepseekLessonStatus } from "./deepseekLesson.js";
import { onlineSpeechStatus, synthesizeOnline } from "./onlineSpeech.js";
import type { RatingName } from "./srs.js";

function routeId(value: string | string[]) {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new AppError(400, "MISSING_ID", "缺少资源编号");
  return id;
}

function assertWriteOrigin(req: express.Request) {
  const origin = String(req.headers.origin || "");
  if (!isTrustedRequestOrigin(origin)) throw new AppError(403, "BAD_ORIGIN", "请求来源不被允许");
}

async function learnerOf(req: express.Request) {
  const untrusted = req.body?.userId ?? req.query.userId ?? req.headers["x-user-id"];
  const resolved = await resolveRequestLearner(req.headers, untrusted);
  if (!resolved.ok) throw new AppError(resolved.status, resolved.code, resolved.message);
  return resolved.learner;
}

function ratingOf(value: unknown): RatingName {
  const rating = String(value || "");
  if (!["again", "hard", "good", "easy"].includes(rating)) {
    throw new AppError(400, "BAD_RATING", "请选择忘记、困难、记得或非常熟悉");
  }
  return rating as RatingName;
}

export function mountLearnerBusinessRoutes(app: express.Express) {
  app.use((req, _res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.path.startsWith("/api/auth")) {
      next();
      return;
    }
    try {
      assertWriteOrigin(req);
      next();
    } catch (error) {
      next(error);
    }
  });

  const route = (method: "get" | "post" | "put" | "patch", path: string, run: (req: express.Request) => Promise<unknown>, status = 200) => {
    app[method](path, async (req, res, next) => {
      try {
        if (path === "/api/tts") res.set("Cache-Control", "no-store");
        const value = await run(req);
        res.status(status).json(value);
      } catch (error) {
        next(error);
      }
    });
  };

  route("get", "/api/system", async (req) => {
    const quota = await ownQuota(await learnerOf(req));
    const ai = deepseekLessonStatus();
    return {
      ok: true,
      ai: ai.available ? "deepseek" : "offline",
      llmState: ai.available ? "已配置，可手动生成" : ai.configured ? "已暂停" : "使用离线词库",
      llmProvider: ai.configured ? "DeepSeek" : null,
      llmModel: ai.configured ? ai.model : null,
      llmUsable: ai.available,
      aiUsedToday: quota.userUsed,
      aiDailyLimit: quota.userLimit,
      ...onlineSpeechStatus(),
    };
  });
  route("get", "/api/ai/quota", async (req) => ownQuota(await learnerOf(req)));
  route("post", "/api/ai/test", async (req) => {
    const learner = await learnerOf(req);
    const declared = typeof req.body?.inputTokens === "number" ? req.body.inputTokens : undefined;
    const result = await withAiCharge({ learner, requestId: req.body?.clientRequestId, kind: "probe", inputTokens: declared }, async () => {
      if (process.env.AI_REAL_CALLS === "1") return sendAuthorizedModelProbe();
      assertPaidAiMock();
      return { ok: true, mocked: true };
    });
    return { ...result.value, model: result.value.mocked ? "mock" : "deepseek", message: result.value.mocked ? "AI 连接成功 · mock" : "AI 连接成功" };
  });
  route("get", "/api/preview/explain", async (req) => cachedOwnedExplanation(
    await learnerOf(req), String(req.query.passageId || ""), String(req.query.word || ""), String(req.query.sentence || ""),
  ));
  route("post", "/api/preview/explain", async (req) => explainOwnedPassage(
    await learnerOf(req),
    String(req.body?.passageId || ""),
    String(req.body?.word || ""),
    String(req.body?.sentence || ""),
  ));
  route("get", "/api/dashboard", async (req) => ownDashboard(await learnerOf(req)));
  route("get", "/api/settings", async (req) => ownSettings(await learnerOf(req)));
  route("put", "/api/settings", async (req) => updateOwnSettings(await learnerOf(req), req.body ?? {}));
  route("post", "/api/lessons/today", async (req) => ensureOwnToday(await learnerOf(req)));
  route("post", "/api/lessons/ai-version", async (req) => {
    const learner = await learnerOf(req);
    if (process.env.AI_REAL_CALLS === "1" && req.body?.confirmCost !== true) {
      throw new AppError(400, "AI_CONFIRMATION_REQUIRED", "请确认使用一次 AI 额度生成课程。");
    }
    return createOwnAiVersion(learner, req.body?.clientRequestId, req.body?.inputTokens);
  });
  route("post", "/api/lessons/:id/activate", async (req) => activateOwnLesson(await learnerOf(req), routeId(req.params.id)));
  route("get", "/api/lessons/today/versions", async (req) => ownLessonVersions(await learnerOf(req), studyDate(studyNow())));
  route("get", "/api/lessons", async (req) => ownLessons(await learnerOf(req)));
  route("get", "/api/lessons/:id", async (req) => ownLesson(await learnerOf(req), routeId(req.params.id)));
  route("patch", "/api/lessons/:id/progress", async (req) => saveOwnLessonProgress(await learnerOf(req), routeId(req.params.id), req.body?.progress));
  route("post", "/api/lessons/:id/recall", async (req) => recallOwnLesson(await learnerOf(req), routeId(req.params.id), String(req.body?.text || "")));
  route("post", "/api/vocabulary/:id/known", async (req) => rateOwnWord(await learnerOf(req), routeId(req.params.id), "easy", "recall", req.body?.clientRequestId, req.body?.progress, true));
  route("post", "/api/vocabulary/:id/easier", async (req) => easierOwnExample(await learnerOf(req), routeId(req.params.id), req.body?.clientRequestId, req.body?.inputTokens));
  route("get", "/api/review", async (req) => ownReviewQueue(
    await learnerOf(req),
    new Date(),
    String(req.query.filter || "due"),
    String(req.query.q || ""),
  ));
  route("post", "/api/review/:id/practice", async (req) => {
    const learner = await learnerOf(req);
    if (req.body?.formal === true) {
      const recallAbility = req.body?.recallAbility === "recognize" ? "recognize" : "recall";
      return rateOwnWord(learner, routeId(req.params.id), ratingOf(req.body?.rating), recallAbility, req.body?.clientRequestId, req.body?.progress);
    }
    return practiceOwnWord(learner, routeId(req.params.id), ratingOf(req.body?.rating), req.body?.clientRequestId);
  });
  route("post", "/api/review/:id/rate", async (req) => {
    const recallAbility = req.body?.recallAbility === "recognize" ? "recognize" : "recall";
    return rateOwnWord(await learnerOf(req), routeId(req.params.id), ratingOf(req.body?.rating), recallAbility, req.body?.clientRequestId, req.body?.progress);
  });
  route("get", "/api/library", async (req) => ownLibrary(await learnerOf(req)));
  route("get", "/api/stats", async (req) => ownStats(await learnerOf(req)));
  route("post", "/api/quiz/:id/answer", async (req) => answerOwnQuestion(await learnerOf(req), routeId(req.params.id), Number(req.body?.selected)));
  route("post", "/api/quiz/:id/simpler", async (req) => simplerOwnQuestion(await learnerOf(req), routeId(req.params.id), req.body?.clientRequestId, req.body?.inputTokens));
  route("post", "/api/sessions", async (req) => addOwnSession(await learnerOf(req), req.body?.lessonId || null, String(req.body?.module || "lesson"), Number(req.body?.minutes || 0)));
  route("post", "/api/tts", async (req) => {
    const learner = await learnerOf(req);
    const rate = [0.8, 0.9, 1, 1.1, 1.2].includes(Number(req.body?.rate)) ? Number(req.body?.rate) : 1;
    if (req.body?.useOnline === true) {
      return { mode: "file", ...await synthesizeOnline(learner.learnerId, req.body?.text), rate };
    }
    return { mode: "browser", rate, sourceLabel: "当前语音：浏览器语音" };
  });
  app.get("/api/audio/:name", async (req, res, next) => {
    try {
      await learnerOf(req);
      throw new AppError(403, "AUDIO_NOT_SCOPED", "音频文件还没有按用户隔离，已拒绝访问。");
    } catch (error) {
      next(error);
    }
  });
}

export function denyUnscopedApi(req: express.Request, res: express.Response) {
  const cookie = String(req.headers.cookie || "");
  if (!cookie) {
    res.status(401).json({ error: "未登录", code: "UNAUTHENTICATED" });
    return;
  }
  res.status(403).json({ error: "这个接口还没有完成用户隔离", code: "ROUTE_NOT_SCOPED" });
}
