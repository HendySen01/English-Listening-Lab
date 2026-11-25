import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { provisionOwnLearner } from "./learnerProvision.js";
import { productionAuthBase, productionTrustedOrigins } from "./productionBoot.js";
import { previewAuthBase, previewTrustedOrigins } from "./previewBoot.js";
import { authDb, postgresRuntimeRequested } from "./runtimeClients.js";
import { redactSecrets } from "./serverLog.js";
import { authMailConfigured, sendAuthMail } from "./authMail.js";

const clientIpHeader = "x-lab-client-ip";
const inviteStore = new AsyncLocalStorage<string>();

export function runWithInvite<T>(invite: string, work: () => T) {
  return inviteStore.run(invite, work);
}
const sessionSeconds = 60 * 60 * 24 * 7;
const loginWindow = 15 * 60;

export async function reserveAccountLogin(email: string, secret: string, now = Date.now()) {
  const digest = createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
  const key = `lab-login:account:${digest}`;
  const cutoff = BigInt(now - loginWindow * 1000);
  return authDb().$transaction(async (tx) => {
    const row = await tx.rateLimit.upsert({
      where: { key }, create: { id: key, key, count: 0, lastRequest: BigInt(now) }, update: { key },
    });
    if (row.lastRequest <= cutoff) {
      await tx.rateLimit.update({ where: { key }, data: { count: 1, lastRequest: BigInt(now) } });
      return 0;
    }
    if (row.count >= 5) return Math.max(1, Math.ceil((Number(row.lastRequest) - Number(cutoff)) / 1000));
    await tx.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return 0;
  });
}

export function authSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim() || "";
  if (secret.length < 32) return "";
  return secret;
}

export function inviteCode(env: NodeJS.ProcessEnv = process.env) {
  const code = (env.AUTH_INVITE_CODE || "").trim();
  if (code.length < 8 || code.length > 64 || /\s/.test(code)) return "";
  return code;
}

export function inviteConfigured(env: NodeJS.ProcessEnv = process.env) {
  return inviteCode(env) !== "";
}

export function inviteAccepted(presented: unknown, env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV !== "production" && !inviteConfigured(env)) return true;
  const expected = inviteCode(env);
  const actual = typeof presented === "string" ? presented.trim() : "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (!expected || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function publicSignupEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.AUTH_SIGNUP_ENABLED !== "1") return false;
  if (env.VERCEL_ENV === "production") return inviteConfigured(env);
  return true;
}

export function learnerProvisioningEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.USER_RUNTIME === "1" || env.POSTGRES_RUNTIME === "1";
}

export function passwordIssue(password: string, email = "") {
  if (!password) return "请填写密码。";
  if (password.length < 8 || password.length > 128) return "密码需要 8 到 128 位。";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码需要同时包含字母和数字。";
  if (email && password.toLowerCase() === email.toLowerCase()) return "密码不能与邮箱相同。";
  return "";
}

function signupRequest(context: unknown) {
  if (!context || typeof context !== "object") return null;
  const record = context as { path?: unknown; request?: { url?: unknown }; body?: { email?: unknown; password?: unknown } };
  const path = typeof record.path === "string" ? record.path : "";
  const url = typeof record.request?.url === "string" ? record.request.url : "";
  if (!`${path} ${url}`.includes("sign-up")) return null;
  const headers = (record as { headers?: unknown; request?: { headers?: unknown } }).headers
    ?? (record as { request?: { headers?: unknown } }).request?.headers;
  return {
    email: typeof record.body?.email === "string" ? record.body.email : "",
    password: typeof record.body?.password === "string" ? record.body.password : "",
    invite: headerValue(headers, "x-lab-invite"),
  };
}

function headerValue(headers: unknown, name: string) {
  if (!headers || typeof headers !== "object") return "";
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) || "";
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return String(value[0] || "");
  return "";
}

export function secureAuthCookies() {
  const base = process.env.BETTER_AUTH_URL?.trim() || "";
  return base.startsWith("https://") || process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export function isTrustedRequestOrigin(origin: string) {
  if (!origin) return false;
  return trustedOrigins().some((pattern) => {
    if (pattern.endsWith("*")) return origin.startsWith(pattern.slice(0, -1));
    return origin === pattern;
  });
}

function trustedOrigins() {
  const configured = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const local = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
  ];
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") return productionTrustedOrigins();
  if (process.env.VERCEL === "1") return previewTrustedOrigins();
  const origins = configured.length ? configured : local;
  if (process.env.AUTH_SELFTEST === "1") origins.push("http://127.0.0.1:*", "http://localhost:*");
  return origins;
}

function redactAuthLog(value: string) {
  return redactSecrets(value)
    .replace(/(\/reset-password\/)[^\s?]+/gi, "$1[redacted]")
    .replace(/better-auth-secret[^\s]*/gi, "[redacted]")
    .replace(/\b(password|token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/x-lab-invite\s*[:=]\s*\S+/gi, "x-lab-invite=[redacted]");
}

let auth: ReturnType<typeof betterAuth> | null = null;
let authKey = "";

export function getAuth() {
  const secret = authSecret();
  if (!secret) return null;
  const inviteHash = createHash("sha256").update(inviteCode()).digest("hex").slice(0, 12);
  const key = `${secret}\n${process.env.BETTER_AUTH_URL || ""}\n${process.env.AUTH_DATABASE_URL || ""}\n${process.env.AUTH_SELFTEST || ""}\n${process.env.POSTGRES_RUNTIME || ""}\n${publicSignupEnabled() ? "signup" : "no-signup"}\n${process.env.VERCEL_ENV || ""}\n${inviteHash}`;
  const mail = authMailConfigured();
  const multiUser = learnerProvisioningEnabled();
  const runtimeKey = `${key}\n${mail}\n${multiUser}`;
  if (auth && authKey === runtimeKey) return auth;
  authKey = runtimeKey;
  const database = authDb().$extends({
    query: {
      rateLimit: {
        deleteMany({ args, query }) {
          // Better Auth uses shorter windows than the UTC-day speech quota.
          const speechDayStart = BigInt(Math.floor(Date.now() / 86_400_000) * 86_400_000);
          args.where = {
            AND: [
              args.where ?? {},
              { OR: [{ key: { not: { startsWith: "lab-tts:" } } }, { lastRequest: { lt: speechDayStart } }] },
            ],
          };
          return query(args);
        },
      },
    },
  });
  auth = betterAuth({
    appName: "英语学习实验室",
    baseURL: process.env.VERCEL === "1"
      ? (process.env.VERCEL_ENV === "production" ? productionAuthBase() : previewAuthBase())
      : (process.env.BETTER_AUTH_URL?.trim() || "http://127.0.0.1:8787"),
    basePath: "/api/auth",
    secret,
    trustedOrigins: trustedOrigins(),
    database: prismaAdapter(database, { provider: postgresRuntimeRequested() ? "postgresql" : "sqlite" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !publicSignupEnabled(),
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: mail ? async ({ user, url }) => sendAuthMail(user.email, url, "reset") : undefined,
    },
    emailVerification: mail ? {
      sendOnSignUp: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => sendAuthMail(user.email, url, "verify"),
    } : undefined,
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (multiUser && context.path === "/sign-in/email" && typeof context.body?.email === "string") {
          const wait = await reserveAccountLogin(context.body.email, secret);
          if (wait) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "尝试次数太多，请稍后再试。", code: "LOGIN_RATE_LIMIT",
            }, { "Retry-After": String(wait) });
          }
        }
        if (context.path !== "/reset-password") return;
        const issue = passwordIssue(String(context.body?.newPassword || ""));
        if (issue) throw new APIError("BAD_REQUEST", { message: issue, code: "WEAK_PASSWORD" });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(user, context) {
            const signup = signupRequest(context);
            if (!signup) return;
            if (!inviteAccepted(inviteStore.getStore() || signup.invite)) {
              throw new APIError("FORBIDDEN", { message: "邀请码不正确。", code: "INVITE_REQUIRED" });
            }
            const issue = passwordIssue(signup.password, signup.email || String(user.email || ""));
            if (issue) throw new APIError("BAD_REQUEST", { message: issue, code: "WEAK_PASSWORD" });
          },
          async after(user, context) {
            if (!signupRequest(context)) return;
            try {
              await provisionOwnLearner(user.id);
            } catch {
              throw new APIError("SERVICE_UNAVAILABLE", {
                message: "账号已创建，学习空间还没有准备好。请登录后再试。",
                code: "LEARNER_PROVISION_FAILED",
              });
            }
          },
        },
      },
    },
    session: {
      expiresIn: sessionSeconds,
      storeSessionInDatabase: true,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: loginWindow, max: multiUser ? 60 : 5 },
        "/sign-up/email": { window: 15 * 60, max: 8 },
        "/get-session": { window: 60, max: 120 },
        "/request-password-reset": { window: 15 * 60, max: 5 },
        "/send-verification-email": { window: 15 * 60, max: 5 },
        "/reset-password": { window: 15 * 60, max: 8 },
      },
    },
    advanced: {
      useSecureCookies: secureAuthCookies(),
      ipAddress: { ipAddressHeaders: [clientIpHeader] },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    logger: {
      level: "error",
      log(level, message, ...args) {
        const text = redactAuthLog([message, ...args].map((item) => String(item)).join(" "));
        if (level === "error") console.error(text);
      },
    },
  }) as unknown as NonNullable<typeof auth>;
  return auth;
}

export async function createPrivateTestAccount(input: { email: string; password: string; name: string }) {
  const current = getAuth();
  if (!current) throw new Error("认证尚未配置");
  const context = await current.$context;
  const password = await context.password.hash(input.password);
  const user = await context.internalAdapter.createUser({
    email: input.email,
    name: input.name,
    emailVerified: true,
  }, { method: "email-password" });
  await context.internalAdapter.createAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password,
  });
  return { id: user.id, email: user.email };
}

export { clientIpHeader };
