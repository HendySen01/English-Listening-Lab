// 隔离的多用户测试入口。现有 createApp 不挂载这些路由，也不能把它接到公网业务接口。
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { clientIpHeader, getAuth } from "./auth.js";
import { AppError } from "./errors.js";
import { resolveRequestLearner } from "./learnerIdentity.js";
import {
  getAttempt,
  getLesson,
  getProgress,
  listAttempts,
  listLessons,
  listProgress,
  listReviews,
  listSessions,
  listUsage,
  listVocabulary,
  recordReview,
  updateOwnProgressReps,
} from "./learnerScope.js";
import { denyUnscopedApi, mountLearnerBusinessRoutes } from "./learnerBusinessRoutes.js";
import { redactSecrets, reportServerError } from "./serverLog.js";
import { assertUserRuntimeEnabled } from "./userDatabase.js";

function socketIp(req: express.Request) {
  const address = req.socket.remoteAddress || "";
  if (address === "::1") return "127.0.0.1";
  if (address.startsWith("::ffff:")) return address.slice("::ffff:".length);
  return address;
}

async function requireLearner(req: express.Request) {
  const untrusted = req.body?.userId ?? req.query.userId;
  const resolved = await resolveRequestLearner(req.headers, untrusted);
  if (!resolved.ok) throw new AppError(resolved.status, resolved.code, resolved.message);
  return resolved.learner;
}

export function createUserRuntimeApp() {
  assertUserRuntimeEnabled();
  const app = express();
  app.set("trust proxy", false);
  app.use((req, _res, next) => {
    delete req.headers[clientIpHeader];
    const ip = socketIp(req);
    if (ip) req.headers[clientIpHeader] = ip;
    next();
  });
  app.all("/api/auth/{*any}", (req, res, next) => {
    const auth = getAuth();
    if (!auth) {
      res.status(503).json({ error: "认证尚未配置", code: "AUTH_NOT_CONFIGURED" });
      return;
    }
    Promise.resolve(toNodeHandler(auth)(req, res)).catch(next);
  });
  app.use(cors({ origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/], credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  mountLearnerBusinessRoutes(app);

  app.get("/api/user-runtime/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/user-runtime/learner", async (req, res, next) => {
    try {
      const learner = await requireLearner(req);
      res.json({ learnerId: learner.learnerId, authUserId: learner.authUserId });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/lessons", async (req, res, next) => {
    try {
      res.json(await listLessons(await requireLearner(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/lessons/:id", async (req, res, next) => {
    try {
      const lesson = await getLesson(await requireLearner(req), req.params.id);
      if (!lesson) throw new AppError(404, "NOT_FOUND", "找不到资源");
      res.json(lesson);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/vocabulary", async (req, res, next) => {
    try {
      res.json(await listVocabulary(await requireLearner(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/progress", async (req, res, next) => {
    try {
      res.json(await listProgress(await requireLearner(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/progress/:vocabularyId", async (req, res, next) => {
    try {
      const progress = await getProgress(await requireLearner(req), req.params.vocabularyId);
      if (!progress) throw new AppError(404, "NOT_FOUND", "找不到资源");
      res.json(progress);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/user-runtime/progress/:vocabularyId", async (req, res, next) => {
    try {
      const result = await updateOwnProgressReps(await requireLearner(req), req.params.vocabularyId, Number(req.body?.reps));
      if (!result.ok) throw new AppError(result.status, result.code, result.message);
      res.json(result.value);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/reviews", async (req, res, next) => {
    try {
      res.json(await listReviews(await requireLearner(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/user-runtime/reviews", async (req, res, next) => {
    try {
      const result = await recordReview(await requireLearner(req), {
        vocabularyId: String(req.body?.vocabularyId || ""),
        clientRequestId: String(req.body?.clientRequestId || ""),
        rating: String(req.body?.rating || ""),
      });
      if (!result.ok) throw new AppError(result.status, result.code, result.message);
      res.status(201).json(result.value);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/sessions", async (req, res, next) => {
    try {
      res.json(await listSessions(await requireLearner(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/usage", async (req, res, next) => {
    try {
      res.json(await listUsage(await requireLearner(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/attempts", async (req, res, next) => {
    try {
      res.json(await listAttempts(await requireLearner(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/user-runtime/attempts/:id", async (req, res, next) => {
    try {
      const attempt = await getAttempt(await requireLearner(req), req.params.id);
      if (!attempt) throw new AppError(404, "NOT_FOUND", "找不到资源");
      res.json(attempt);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", denyUnscopedApi);

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
