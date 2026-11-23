import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AppError } from "./errors.js";
import { chatJson, parseModelJson, serviceStatus, ttsStatus, normalizeDeepseekVoice } from "./ai.js";
import { explainPreview, lookupPreviewExplanation } from "./previewExplain.js";
import {
  addSession,
  activateLesson,
  answerQuestion,
  createAiVersion,
  dashboard,
  dueCount,
  easierExample,
  ensureLesson,
  getSettings,
  history,
  lessonById,
  lessonVersions,
  library,
  markKnown,
  practiceWord,
  rateWord,
  recallCheck,
  reviewQueue,
  saveProgress,
  stats,
  updateSettings,
  findLessonByDate,
  presentLesson,
} from "./lessonService.js";
import { localISODate } from "./content.js";
import { prisma } from "./prisma.js";
import { audioDir } from "./paths.js";
import { redactSecrets, reportServerError } from "./serverLog.js";
import type { RatingName } from "./srs.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/] }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/preview/explain", (req, res) => {
    const passageId = String(req.query.passageId || "");
    const word = String(req.query.word || "");
    const sentence = String(req.query.sentence || "");
    res.json(lookupPreviewExplanation(passageId, word, sentence) || { source: "miss" });
  });

  app.post("/api/preview/explain", async (req, res, next) => {
    try {
      res.json(await explainPreview(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/system", async (_req, res, next) => {
    try {
      res.json(await serviceStatus());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ai/test", async (req, res, next) => {
    try {
      if (req.body?.confirmCost !== true) {
        throw new AppError(400, "COST_NOT_CONFIRMED", "测试会发送一次很短的真实请求，可能产生少量费用。");
      }
      const result = await chatJson("test", "只返回 JSON：{\"ok\":true}", "{\"ping\":true}");
      const parsed = parseModelJson(result.content) as { ok?: boolean };
      if (parsed.ok !== true) throw new AppError(502, "AI_INVALID", "接口有响应，但没有返回约定的测试结果。");
      const status = await serviceStatus();
      res.json({
        ok: true,
        provider: status.llmProvider,
        model: result.model,
        message: `AI 连接成功 · ${status.llmProvider} · ${result.model}`,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard", async (_req, res, next) => {
    try {
      res.json(await dashboard());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", async (_req, res, next) => {
    try {
      res.json(await getSettings());
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/settings", async (req, res, next) => {
    try {
      res.json(await updateSettings(req.body ?? {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/lessons/today", async (_req, res, next) => {
    try {
      const lesson = await ensureLesson(localISODate());
      res.json(presentLesson(lesson));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/lessons/ai-version", async (req, res, next) => {
    try {
      if (req.body?.confirmCost !== true) {
        throw new AppError(400, "COST_NOT_CONFIRMED", "使用 AI 生成新版本会调用一次语言模型，可能产生费用。原来的课程会保留。");
      }
      res.json(await createAiVersion(localISODate()));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/lessons/:id/activate", async (req, res, next) => {
    try {
      res.json(await activateLesson(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/lessons/today/versions", async (_req, res, next) => {
    try {
      const lesson = await findLessonByDate(localISODate());
      res.json(lesson ? await lessonVersions(lesson.lessonDate) : []);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/lessons", async (_req, res, next) => {
    try {
      res.json(await history());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/lessons/:id", async (req, res, next) => {
    try {
      res.json(await lessonById(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/lessons/:id/progress", async (req, res, next) => {
    try {
      res.json(await saveProgress(req.params.id, req.body?.progress));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/lessons/:id/recall", async (req, res, next) => {
    try {
      res.json(await recallCheck(req.params.id, String(req.body?.text || "")));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/vocabulary/:id/known", async (req, res, next) => {
    try {
        res.json(await markKnown(req.params.id, req.body?.clientRequestId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/vocabulary/:id/easier", async (req, res, next) => {
    try {
      res.json(await easierExample(req.params.id, req.body?.confirmCost === true));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/review", async (req, res, next) => {
    try {
      const filter = String(req.query.filter || "due");
      const q = String(req.query.q || "");
      res.json({ dueCount: await dueCount(), items: await reviewQueue(new Date(), filter, q) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review/:id/practice", async (req, res, next) => {
    try {
      const rating = String(req.body?.rating || "") as RatingName;
      if (!["again", "hard", "good", "easy"].includes(rating)) {
        throw new AppError(400, "BAD_RATING", "请选择忘记、困难、记得或非常熟悉");
      }
        if (req.body?.formal === true) {
          const recallAbility = req.body?.recallAbility === "recognize" ? "recognize" : "recall";
          res.json(await rateWord(req.params.id, rating, recallAbility, req.body?.clientRequestId));
          return;
        }
        res.json(await practiceWord(req.params.id, rating, req.body?.clientRequestId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review/:id/rate", async (req, res, next) => {
    try {
      const rating = String(req.body?.rating || "") as RatingName;
      if (!["again", "hard", "good", "easy"].includes(rating)) {
        throw new AppError(400, "BAD_RATING", "请选择忘记、困难、记得或非常熟悉");
      }
      const recallAbility = req.body?.recallAbility === "recognize" ? "recognize" : "recall";
      res.json(await rateWord(req.params.id, rating, recallAbility, req.body?.clientRequestId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/library", async (_req, res, next) => {
    try {
      res.json(await library());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/stats", async (_req, res, next) => {
    try {
      res.json(await stats());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/quiz/:id/answer", async (req, res, next) => {
    try {
      res.json(await answerQuestion(req.params.id, Number(req.body?.selected)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/quiz/:id/simpler", async (req, res, next) => {
    try {
      const question = await prisma.quizQuestion.findUnique({ where: { id: req.params.id } });
      if (!question) throw new AppError(404, "NOT_FOUND", "找不到这道题");
      if (!process.env.LLM_API_KEY?.trim()) {
        res.json({ mode: "stored", text: question.simplerZh });
        return;
      }
      if (req.body?.confirmCost !== true) {
        throw new AppError(400, "COST_NOT_CONFIRMED", "换一种更简单的讲法会调用 AI，可能产生费用。");
      }
      const result = await chatJson(
        "simpler",
        "用更短的简体中文解释，不要加入新的难词。只返回 JSON：{\"text\":\"\"}",
        JSON.stringify({ prompt: question.prompt, explanation: question.explanationZh }),
      );
      const parsed = parseModelJson(result.content) as { text?: string };
      if (!parsed.text) throw new AppError(502, "AI_INVALID", "没有得到更简单的解释。");
      res.json({ mode: "ai", text: parsed.text });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions", async (req, res, next) => {
    try {
      res.json(await addSession(req.body?.lessonId || null, String(req.body?.module || "lesson"), Number(req.body?.minutes || 0)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tts", async (req, res, next) => {
    try {
      const text = String(req.body?.text || "").slice(0, 1200);
      const rate = [0.8, 0.9, 1, 1.1].includes(Number(req.body?.rate)) ? Number(req.body?.rate) : 1;
      if (!text.trim()) throw new AppError(400, "EMPTY", "没有可朗读的文本");
      const tts = ttsStatus();
      if (req.body?.useOnline !== true) {
        res.json({ mode: "browser", rate, sourceLabel: "当前语音：浏览器语音" });
        return;
      }
      if (!tts.configured || !tts.usable) {
        res.json({ mode: "browser", rate, sourceLabel: "当前语音：浏览器语音", warning: tts.note });
        return;
      }
      if (process.env.VERCEL) {
        res.json({
          mode: "browser",
          rate,
          sourceLabel: "当前语音：浏览器语音",
          warning: "当前部署不能保存音频文件，已使用浏览器语音。",
        });
        return;
      }
      const host = tts.host;
      const deepseek = host.includes("deepseek");
      const voice = deepseek ? normalizeDeepseekVoice(process.env.TTS_VOICE || "") : process.env.TTS_VOICE || "alloy";
      const key = crypto.createHash("sha256").update(`${host}|${voice}|${rate}|${text}`).digest("hex").slice(0, 24);
      const filename = `${key}.${deepseek ? "wav" : "mp3"}`;
      const file = path.join(audioDir, filename);
      if (!fs.existsSync(file)) {
        const base = process.env.TTS_BASE_URL!.replace(/\/$/, "");
        let response: Response;
        try {
          response = deepseek
            ? await fetch(`${base}/v1/tools/tts`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.TTS_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ text, voice_id: voice, format: "wav" }),
              })
            : await fetch(`${base}/audio/speech`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.TTS_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ model: tts.model || "tts-1", voice, input: text, speed: rate }),
              });
        } catch {
          res.json({ mode: "browser", rate, sourceLabel: "当前语音：浏览器语音", warning: "在线语音连不上，已切换到浏览器语音。" });
          return;
        }
        if (!response.ok) {
          res.json({
            mode: "browser",
            rate,
            sourceLabel: "当前语音：浏览器语音",
            warning: `在线语音返回 ${response.status}，已切换到浏览器语音。`,
          });
          return;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 100) {
          res.json({ mode: "browser", rate, sourceLabel: "当前语音：浏览器语音", warning: "在线语音没有返回可用音频，已切换到浏览器语音。" });
          return;
        }
        try {
          fs.mkdirSync(audioDir, { recursive: true });
          fs.writeFileSync(file, bytes);
        } catch {
          res.json({
            mode: "browser",
            rate,
            sourceLabel: "当前语音：浏览器语音",
            warning: "当前环境不能保存音频文件，已切换到浏览器语音。",
          });
          return;
        }
      }
      const voiceNote = deepseek && process.env.TTS_VOICE && !["stella", "tide"].includes(process.env.TTS_VOICE)
        ? `当前语音：DeepSeek 在线 TTS · ${voice}。原配置的 ${process.env.TTS_VOICE} 不是该服务的音色。`
        : deepseek
          ? `当前语音：DeepSeek 在线 TTS · ${voice}`
          : `当前语音：在线 TTS · ${host}`;
      res.json({ mode: "file", url: `/api/audio/${filename}`, rate, sourceLabel: voiceNote });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/audio/:name", (req, res) => {
    const name = req.params.name;
    if (!/^[\w.-]+$/.test(name)) {
      res.status(400).json({ error: "文件名不正确" });
      return;
    }
    const file = path.resolve(audioDir, name);
    if (!file.startsWith(path.resolve(audioDir)) || !fs.existsSync(file)) {
      res.status(404).json({ error: "找不到音频" });
      return;
    }
    res.sendFile(file);
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: redactSecrets(error.message), code: error.code });
      return;
    }
    reportServerError(error);
    res.status(500).json({ error: "服务器内部错误", code: "INTERNAL" });
  });

  return app;
}
