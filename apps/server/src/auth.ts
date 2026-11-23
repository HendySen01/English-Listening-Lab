import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getAuthPrisma } from "./authDatabase.js";
import { redactSecrets } from "./serverLog.js";

const clientIpHeader = "x-lab-client-ip";
const sessionSeconds = 60 * 60 * 24 * 7;

export function authSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim() || "";
  if (secret.length < 32) return "";
  return secret;
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
  const origins = configured.length ? configured : local;
  if (process.env.AUTH_SELFTEST === "1") origins.push("http://127.0.0.1:*", "http://localhost:*");
  return origins;
}

function redactAuthLog(value: string) {
  return redactSecrets(value)
    .replace(/better-auth-secret[^\s]*/gi, "[redacted]")
    .replace(/\b(password|token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

let auth: ReturnType<typeof betterAuth> | null = null;
let authKey = "";

export function getAuth() {
  const secret = authSecret();
  if (!secret) return null;
  const key = `${secret}\n${process.env.BETTER_AUTH_URL || ""}\n${process.env.AUTH_DATABASE_URL || ""}\n${process.env.AUTH_SELFTEST || ""}`;
  if (auth && authKey === key) return auth;
  authKey = key;
  auth = betterAuth({
    appName: "英语学习实验室",
    baseURL: process.env.BETTER_AUTH_URL?.trim() || "http://127.0.0.1:8787",
    basePath: "/api/auth",
    secret,
    trustedOrigins: trustedOrigins(),
    database: prismaAdapter(getAuthPrisma(), { provider: "sqlite" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
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
        "/sign-in/email": { window: 15 * 60, max: 5 },
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
  });
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
  });
  await context.internalAdapter.createAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password,
  });
  return { id: user.id, email: user.email };
}

export { clientIpHeader };
