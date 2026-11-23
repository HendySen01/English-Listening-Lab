// 新认证用户得到一个新的 Learner。这里不读取、不改写 unbound:original-lab。
// 认证库和业务库没有跨库事务；创建失败时账号可以稍后再次初始化。
import { AppError } from "./errors.js";
import { settingDefaults } from "./learnerApi.js";
import { learnerDb } from "./runtimeClients.js";

let provisionFault: (() => void) | null = null;

export function setProvisionFault(next: (() => void) | null) {
  provisionFault = next;
}

export async function provisionOwnLearner(authUserId: string) {
  const id = authUserId.trim();
  if (!id || id.startsWith("unbound:")) {
    throw new AppError(409, "LEARNER_BINDING_INVALID", "不能为未绑定标记创建学习者。");
  }
  const db = learnerDb();
  const existing = await db.learner.findUnique({ where: { authUserId: id } });
  if (existing) {
    if (!existing.boundAt || existing.authUserId.startsWith("unbound:")) {
      throw new AppError(409, "LEARNER_BINDING_INVALID", "学习者绑定状态异常");
    }
    const settings = await db.userSettings.findUnique({ where: { userId: existing.id } });
    if (!settings) {
      await db.userSettings.create({
        data: { id: `settings_${existing.id}`, userId: existing.id, ...settingDefaults, updatedAt: new Date() },
      });
    }
    return existing;
  }
  if (provisionFault) {
    try {
      provisionFault();
    } catch {
      throw new AppError(503, "LEARNER_PROVISION_FAILED", "账号已创建，学习空间还没有准备好。请登录后再试。");
    }
  }
  const now = new Date();
  const learnerId = `learner_${id}`;
  try {
    return await db.$transaction(async (tx) => {
      const again = await tx.learner.findUnique({ where: { authUserId: id } });
      if (again) {
        if (!again.boundAt || again.authUserId.startsWith("unbound:")) {
          throw new AppError(409, "LEARNER_BINDING_INVALID", "学习者绑定状态异常");
        }
        return again;
      }
      const created = await tx.learner.create({
        data: { id: learnerId, authUserId: id, boundAt: now, createdAt: now },
      });
      await tx.userSettings.create({
        data: { id: `settings_${learnerId}`, userId: learnerId, ...settingDefaults, updatedAt: now },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "P2002") {
      const row = await db.learner.findUnique({ where: { authUserId: id } });
      if (row?.boundAt && !row.authUserId.startsWith("unbound:")) return row;
    }
    throw new AppError(503, "LEARNER_PROVISION_FAILED", "账号已创建，学习空间还没有准备好。请登录后再试。");
  }
}
