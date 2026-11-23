import "dotenv/config";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./paths.ts";

const root = repoRoot;
const authFile = path.join(root, "data", "auth-selftest.db");
const secret = "b7f3c1e9a4d84f0c9e2b6a1d8c5f704e91ab23cd";
process.env.AUTH_DATABASE_URL = `file:${authFile.replace(/\\/g, "/")}`;
process.env.DATABASE_URL = `file:${path.join(root, "data", "selftest.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = secret;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8787";
process.env.AUTH_SELFTEST = "1";
process.env.LLM_API_KEY = "";
process.env.TTS_API_KEY = "";
delete process.env.AUTH_SIGNUP_ENABLED;
delete process.env.VERCEL_ENV;

if (process.argv[2] === "restart") {
  const { createApp } = await import("./app.ts");
  const { disconnectAuthPrisma } = await import("./authDatabase.ts");
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const cookie = process.env.AUTH_RESTART_COOKIE || "";
  try {
    const session = await fetch(`http://127.0.0.1:${port}/api/auth-session-check`, { headers: { cookie } });
    const body = await session.json() as { email?: string };
    const limited = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8787" },
      body: JSON.stringify({ email: "alpha@lab.test", password: "alpha-pass-1844" }),
    });
    console.log(JSON.stringify({ session: session.status, email: body.email || "", limited: limited.status }));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectAuthPrisma();
  }
  process.exit(0);
}

const passwordA = "alpha-pass-1844";
const passwordB = "beta-pass-2755";
for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${authFile}${suffix}`;
  if (fs.existsSync(file)) fs.rmSync(file);
}
execSync("node scripts/auth/push.mjs", {
  cwd: path.join(root, "apps/server"),
  env: process.env,
  stdio: "inherit",
});

const { createPrivateTestAccount, getAuth, secureAuthCookies } = await import("./auth.ts");
const { createApp } = await import("./app.ts");
const { disconnectAuthPrisma, getAuthPrisma } = await import("./authDatabase.ts");

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
}

function labCounts() {
  const db = new DatabaseSync(path.join(root, "data", "lab.db"), { readOnly: true });
  try {
    const progress = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(reps),0) AS reps, COALESCE(SUM(lapses),0) AS lapses FROM WordProgress").get() as { n: number; reps: number; lapses: number };
    return {
      lessons: Number(db.prepare("SELECT COUNT(*) AS n FROM DailyLesson").get().n),
      words: Number(db.prepare("SELECT COUNT(*) AS n FROM Vocabulary").get().n),
      progress: Number(progress.n),
      reps: Number(progress.reps),
      lapses: Number(progress.lapses),
      reviews: Number(db.prepare("SELECT COUNT(*) AS n FROM ReviewEvent").get().n),
    };
  } finally {
    db.close();
  }
}

const labBefore = labCounts();
check("本地测试不强制安全 Cookie", secureAuthCookies() === false);
const savedNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
check("生产环境要求安全 Cookie", secureAuthCookies() === true);
if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = savedNodeEnv;

const auth = getAuth();
if (!auth) throw new Error("测试密钥没有启用认证");
await createPrivateTestAccount({ email: "alpha@lab.test", password: passwordA, name: "Alpha" });
await createPrivateTestAccount({ email: "beta@lab.test", password: passwordB, name: "Beta" });

const app = createApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = app.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const origin = { Origin: "http://127.0.0.1:8787" };

function cookieFrom(response: Response) {
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
}

async function signIn(email: string, password: string, extraHeaders: Record<string, string> = {}) {
  return fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin, ...extraHeaders },
    body: JSON.stringify({ email, password }),
  });
}

try {
  const health = await fetch(`${base}/api/health`);
  check("健康检查保持原样", health.status === 200 && await health.text() === "{\"ok\":true}");
  const lessons = await fetch(`${base}/api/lessons`);
  check("未登录的业务接口仍未被本阶段保护", lessons.status === 200);

  const evil = await fetch(`${base}/api/auth/sign-out`, {
    method: "POST",
    headers: { Origin: "https://evil.example", cookie: "better-auth.session_token=nope" },
  });
  const evilText = await evil.text();
  check("无效来源被拒绝且不泄露密钥", evil.status === 403 && !evilText.includes(secret), evilText);

  const unknown = await signIn("missing@lab.test", passwordA);
  const unknownText = await unknown.text();
  check("未注册邮箱不能登录", unknown.status >= 400 && unknown.status < 500 && !cookieFrom(unknown), unknownText);
  check("失败响应不包含密钥或密码", !unknownText.includes(secret) && !unknownText.includes(passwordA));

  const wrong = await signIn("alpha@lab.test", "wrong-password-1111");
  check("错误密码不能登录", wrong.status >= 400 && !cookieFrom(wrong));

  const alpha = await signIn("alpha@lab.test", passwordA);
  const alphaCookie = cookieFrom(alpha);
  const setCookie = alpha.headers.getSetCookie().join("\n");
  check(
    "正确密码创建 HttpOnly 会话",
    alpha.status === 200 && /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie) && !/;\s*Secure/i.test(setCookie),
  );
  const session = await fetch(`${base}/api/auth/get-session`, { headers: { cookie: alphaCookie } });
  const sessionBody = await session.json() as { user?: { email?: string } };
  check("有效会话可以查询当前用户", session.status === 200 && sessionBody.user?.email === "alpha@lab.test");
  const protectedAlpha = await fetch(`${base}/api/auth-session-check`, { headers: { cookie: alphaCookie } });
  const protectedText = await protectedAlpha.text();
  check("受保护测试接口只返回用户", protectedAlpha.status === 200 && protectedText.includes("alpha@lab.test") && !protectedText.includes("token"));

  const beta = await signIn("beta@lab.test", passwordB);
  const betaCookie = cookieFrom(beta);
  const betaBody = await (await fetch(`${base}/api/auth-session-check`, { headers: { cookie: betaCookie } })).json() as { email?: string };
  const alphaBody = await (await fetch(`${base}/api/auth-session-check`, { headers: { cookie: alphaCookie } })).json() as { email?: string };
  check("两个会话不会串用户", betaBody.email === "beta@lab.test" && alphaBody.email === "alpha@lab.test");

  const signedOut = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { cookie: alphaCookie, ...origin } });
  const afterOut = await fetch(`${base}/api/auth-session-check`, { headers: { cookie: alphaCookie } });
  check("登出后会话失效", signedOut.status === 200 && afterOut.status === 401);

  const betaUser = await getAuthPrisma().user.findUniqueOrThrow({ where: { email: "beta@lab.test" } });
  const betaSession = await getAuthPrisma().session.findFirstOrThrow({ where: { userId: betaUser.id } });
  await getAuthPrisma().session.update({ where: { id: betaSession.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  check("过期会话不能访问受保护接口", (await fetch(`${base}/api/auth-session-check`, { headers: { cookie: betaCookie } })).status === 401);
  check("无效会话被拒绝", (await fetch(`${base}/api/auth-session-check`, { headers: { cookie: "better-auth.session_token=not-a-session" } })).status === 401);

  const beforeUsers = await getAuthPrisma().user.count();
  const signup = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email: "public@lab.test", password: passwordA, name: "Public" }),
  });
  const signupText = await signup.text();
  check(
    "公开注册被拒绝",
    signup.status >= 400 && signupText.includes("EMAIL_PASSWORD_SIGN_UP_DISABLED") && await getAuthPrisma().user.count() === beforeUsers,
    signupText,
  );

  const renewed = await signIn("beta@lab.test", passwordB, { "x-forwarded-for": "203.0.113.8", "x-lab-client-ip": "198.51.100.4" });
  const renewedCookie = cookieFrom(renewed);
  check("伪造转发头后仍按套接字地址登录", renewed.status === 200 && Boolean(renewedCookie));
  const keys = await getAuthPrisma().rateLimit.findMany();
  check(
    "限流键只使用套接字地址",
    keys.length > 0 && keys.every((row) => row.key.startsWith("127.0.0.1|") && !row.key.includes("203.0.113.8") && !row.key.includes("198.51.100.4")),
    keys.map((row) => row.key).join(","),
  );
  const blocked = await signIn("alpha@lab.test", passwordA);
  const stored = await getAuthPrisma().rateLimit.findFirst({ where: { key: { contains: "/sign-in/email" } } });
  check("第六次登录被数据库限流", blocked.status === 429 && Boolean(stored && stored.count >= 5), `status=${blocked.status} count=${stored?.count}`);

  await disconnectAuthPrisma();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const restarted = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./authSelftest.ts", import.meta.url)), "restart"], {
    cwd: path.join(root, "apps/server"),
    env: { ...process.env, AUTH_RESTART_COOKIE: renewedCookie },
    encoding: "utf8",
  });
  if (restarted.status !== 0) failures.push(`重启后的认证进程失败: ${restarted.stderr || restarted.stdout}`);
  else {
    const result = JSON.parse(restarted.stdout) as { session?: number; limited?: number; email?: string };
    check("重启进程后数据库会话仍有效", result.session === 200 && result.email === "beta@lab.test");
    check("重启进程后限流仍然有效", result.limited === 429);
  }
} finally {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectAuthPrisma();
}

const labAfter = labCounts();
check("真实学习库计数没有变化", JSON.stringify(labBefore) === JSON.stringify(labAfter), JSON.stringify({ labBefore, labAfter }));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("auth selftest ok");
