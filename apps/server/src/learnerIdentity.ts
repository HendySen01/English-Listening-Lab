// 业务身份只来自 Better Auth 会话，再按 authUserId 查找已绑定的 Learner。
// 请求里的 userId 会被忽略。unbound:original-lab 不会在这里被自动绑定。
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { getAuth } from "./auth.js";
import { getAuthPrisma } from "./authDatabase.js";
import { AppError } from "./errors.js";
import type { PrismaClient } from "./generated/user/index.js";
import { getUserPrisma } from "./userDatabase.js";

type LearnerDb = Pick<PrismaClient, "learner">;

export type VerifiedLearner = {
  learnerId: string;
  authUserId: string;
  boundAt: Date;
};

export type LearnerResolution =
  | { ok: true; learner: VerifiedLearner }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      code: "UNAUTHENTICATED" | "LEARNER_UNBOUND" | "LEARNER_BINDING_INVALID" | "AUTH_NOT_CONFIGURED";
      message: string;
    };

export async function resolveLearnerFromSession(session: { user?: { id?: string } } | null): Promise<LearnerResolution> {
  const authUserId = session?.user?.id?.trim() || "";
  if (!authUserId) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "未登录" };
  const authUser = await getAuthPrisma().user.findUnique({ where: { id: authUserId } });
  if (!authUser) return { ok: false, status: 409, code: "LEARNER_BINDING_INVALID", message: "学习者绑定状态异常" };
  const learner = await getUserPrisma().learner.findUnique({ where: { authUserId } });
  if (!learner) return { ok: false, status: 403, code: "LEARNER_UNBOUND", message: "当前账号还没有绑定学习者" };
  if (learner.id.length === 0 || learner.authUserId !== authUserId || learner.authUserId.startsWith("unbound:") || !learner.boundAt) {
    return { ok: false, status: 409, code: "LEARNER_BINDING_INVALID", message: "学习者绑定状态异常" };
  }
  return { ok: true, learner: { learnerId: learner.id, authUserId, boundAt: learner.boundAt } };
}

export async function resolveLearnerFromHeaders(headers: Headers | IncomingHttpHeaders) {
  const auth = getAuth();
  if (!auth) {
    return { ok: false, status: 503, code: "AUTH_NOT_CONFIGURED", message: "认证尚未配置" } satisfies LearnerResolution;
  }
  const normalized = headers instanceof Headers ? headers : fromNodeHeaders(headers);
  const session = await auth.api.getSession({ headers: normalized });
  return resolveLearnerFromSession(session);
}

export async function resolveRequestLearner(headers: Headers | IncomingHttpHeaders, untrustedUserId: unknown) {
  void untrustedUserId;
  return resolveLearnerFromHeaders(headers);
}

export async function bindUnboundLearner(db: LearnerDb, input: { learnerId: string; authUserId: string }) {
  const authUserId = input.authUserId.trim();
  if (!authUserId || authUserId.startsWith("unbound:")) {
    throw new AppError(409, "LEARNER_BINDING_INVALID", "不能把学习者绑定到未绑定标记。");
  }
  const authUser = await getAuthPrisma().user.findUnique({ where: { id: authUserId } });
  if (!authUser) throw new AppError(409, "LEARNER_BINDING_INVALID", "认证用户不存在，绑定已停止。");
  const learner = await db.learner.findUnique({ where: { id: input.learnerId } });
  if (!learner) throw new AppError(404, "NOT_FOUND", "找不到学习者。");
  if (learner.boundAt || !learner.authUserId.startsWith("unbound:")) {
    throw new AppError(409, "LEARNER_BINDING_INVALID", "该学习者不是待绑定状态。");
  }
  const updated = await db.learner.updateMany({
    where: { id: learner.id, authUserId: learner.authUserId, boundAt: null },
    data: { authUserId, boundAt: new Date() },
  });
  if (updated.count !== 1) throw new AppError(409, "LEARNER_BINDING_INVALID", "绑定没有完成。");
  return db.learner.findUniqueOrThrow({ where: { id: learner.id } });
}
