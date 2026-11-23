import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { repoRoot } from "./paths.ts";
import { authDatabasePath, databaseStamp, labDatabasePath } from "../scripts/sqlite/assign-learner-ownership.mjs";

const userFile = path.join(repoRoot, "data", "user-runtime-register.db");
const authFile = path.join(repoRoot, "data", "auth-runtime-register.db");
const secret = "a91c4e70b2d84f6e8c1a09d7b5e34216f0ab77c1";
const password = "register-pass-1844";
process.env.DATABASE_URL = `file:${path.join(repoRoot, "data", "selftest.db").replace(/\\/g, "/")}`;
process.env.USER_DATABASE_URL = `file:${userFile.replace(/\\/g, "/")}`;
process.env.AUTH_DATABASE_URL = `file:${authFile.replace(/\\/g, "/")}`;
process.env.USER_RUNTIME = "1";
process.env.AUTH_SIGNUP_ENABLED = "1";
process.env.AUTH_SELFTEST = "1";
process.env.STUDY_TIMEZONE = "Asia/Shanghai";
process.env.BETTER_AUTH_SECRET = secret;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:8808";
process.env.BETTER_AUTH_TRUSTED_ORIGINS = "http://127.0.0.1:8808,http://localhost:8808";
process.env.LLM_API_KEY = "";
process.env.TTS_API_KEY = "";
delete process.env.VERCEL_ENV;
delete process.env.AI_REAL_CALLS;

function removeDatabase(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target);
  }
}
removeDatabase(userFile);
removeDatabase(authFile);
const serverDir = path.join(repoRoot, "apps", "server");
execFileSync(process.execPath, ["scripts/auth/push.mjs"], { cwd: serverDir, env: process.env, stdio: "inherit" });
execFileSync(process.execPath, [path.join(repoRoot, "node_modules", "prisma", "build", "index.js"), "db", "push", "--schema", "prisma-user/schema.prisma", "--skip-generate"], {
  cwd: serverDir,
  env: process.env,
  stdio: "inherit",
});

const { createUserRuntimeApp } = await import("./userRuntimeApp.ts");
const { disconnectAuthPrisma, getAuthPrisma } = await import("./authDatabase.ts");
const { createPrivateTestAccount, getAuth, publicSignupEnabled } = await import("./auth.ts");
const { provisionOwnLearner, setProvisionFault } = await import("./learnerProvision.ts");
const { disconnectUserPrisma, getUserPrisma } = await import("./userDatabase.ts");
const stamp = databaseStamp;
const labBefore = stamp(labDatabasePath);
const authBefore = stamp(authDatabasePath);

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  else console.log(`通过 ${name}`);
}

const user = getUserPrisma();
const createdAt = new Date("2026-05-01T00:00:00.000Z");
await user.learner.create({
  data: { id: "learner_original_lab", authUserId: "unbound:original-lab", boundAt: null, createdAt },
});

const app = createUserRuntimeApp();
const server = await new Promise<import("node:http").Server>((resolve) => {
  const started = app.listen(0, "127.0.0.1", () => resolve(started));
});
const address = server.address();
const port = address && typeof address === "object" ? address.port : 0;
const base = `http://127.0.0.1:${port}`;
const origin = { Origin: "http://127.0.0.1:8808" };

function cookieFrom(response: Response) {
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
}

async function signup(email: string, nextPassword = password, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin, ...headers },
    body: JSON.stringify({ email, password: nextPassword, name: email.split("@")[0] }),
  });
}

async function signIn(email: string) {
  return fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...origin },
    body: JSON.stringify({ email, password }),
  });
}

async function api(pathname: string, cookie = "", init: RequestInit = {}) {
  return fetch(`${base}${pathname}`, {
    ...init,
    headers: { cookie, ...origin, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
}

try {
  const status = await fetch(`${base}/api/signup-status`);
  const statusBody = await status.json() as { enabled?: boolean; emailDelivery?: string; learnerProvisioning?: boolean };
  check("[注册] 隔离环境开放注册且不声称已发邮件", status.status === 200 && statusBody.enabled === true && statusBody.emailDelivery === "unconfigured" && statusBody.learnerProvisioning === true);

  const weak = await signup("weak@lab.test", "password");
  const weakText = await weak.text();
  check("[注册] 缺少数字的密码被拒绝", weak.status === 400 && weakText.includes("字母和数字") && !weakText.includes(secret) && await getAuthPrisma().user.count({ where: { email: "weak@lab.test" } }) === 0, weakText);

  const evil = await signup("evil@lab.test", password, { Origin: "https://evil.example" });
  const evilText = await evil.text();
  check("[注册] 错误来源被拒绝", evil.status === 403 && !evilText.includes(secret) && await getAuthPrisma().user.count({ where: { email: "evil@lab.test" } }) === 0);

  const alpha = await signup("alpha-reg@lab.test");
  const alphaText = await alpha.text();
  const alphaCookie = cookieFrom(alpha);
  const alphaUser = await getAuthPrisma().user.findUnique({ where: { email: "alpha-reg@lab.test" } });
  check("[注册] 新用户注册成功且邮箱未标成已验证", alpha.status === 200 && Boolean(alphaCookie) && alphaUser?.emailVerified === false && !alphaText.includes(secret), alphaText);
  const duplicate = await signup("alpha-reg@lab.test");
  const duplicateText = await duplicate.text();
  check("[注册] 重复邮箱被拒绝", duplicate.status >= 400 && duplicate.status < 500 && await getAuthPrisma().user.count({ where: { email: "alpha-reg@lab.test" } }) === 1 && !duplicateText.includes(password), duplicateText);

  const beta = await signup("beta-reg@lab.test");
  const betaCookie = cookieFrom(beta);
  const betaUser = await getAuthPrisma().user.findUniqueOrThrow({ where: { email: "beta-reg@lab.test" } });
  const learnerAlpha = await user.learner.findUniqueOrThrow({ where: { authUserId: alphaUser?.id || "" } });
  const learnerBeta = await user.learner.findUniqueOrThrow({ where: { authUserId: betaUser.id } });
  const original = await user.learner.findUniqueOrThrow({ where: { id: "learner_original_lab" } });
  const alphaLessons = await user.dailyLesson.count({ where: { userId: learnerAlpha.id } });
  const alphaSettings = await user.userSettings.findUnique({ where: { userId: learnerAlpha.id } });
  check(
    "[绑定] 两个新账号得到不同的空学习空间",
    learnerAlpha.id !== learnerBeta.id && learnerAlpha.authUserId === alphaUser?.id && learnerBeta.authUserId === betaUser.id
      && alphaLessons === 0 && Boolean(alphaSettings) && original.authUserId === "unbound:original-lab" && original.boundAt === null,
  );

  const today = await api("/api/lessons/today", alphaCookie, { method: "POST", body: "{}" });
  const todayBody = await today.json() as { id?: string; userId?: string };
  const betaLessons = await api("/api/lessons", betaCookie);
  const betaList = await betaLessons.json() as Array<{ id: string }>;
  const stolen = await api(`/api/lessons/${todayBody.id}`, betaCookie);
  const library = await api("/api/library", alphaCookie);
  const charges = await user.aiCharge.count();
  check("[隔离] 用户 B 读不到用户 A 的课程", today.status === 200 && betaLessons.status === 200 && betaList.every((item) => item.id !== todayBody.id) && stolen.status === 404);
  check("[额度] 创建离线课程和读取词库不产生模型预留", charges === 0 && library.status === 200);

  const session = await fetch(`${base}/api/auth/get-session`, { headers: { cookie: alphaCookie } });
  const signedOut = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { cookie: alphaCookie, ...origin } });
  const afterOut = await fetch(`${base}/api/auth/get-session`, { headers: { cookie: alphaCookie } });
  const afterBody = await afterOut.json().catch(() => null) as { user?: unknown } | null;
  const signedIn = await signIn("alpha-reg@lab.test");
  check("[会话] 注册会话可以查询、退出并重新登录", session.status === 200 && signedOut.status === 200 && afterBody?.user == null && signedIn.status === 200);

  setProvisionFault(() => {
    throw new Error("forced provision failure");
  });
  const broken = await signup("broken-reg@lab.test");
  const brokenText = await broken.text();
  setProvisionFault(null);
  const brokenUser = await getAuthPrisma().user.findUnique({ where: { email: "broken-reg@lab.test" } });
  const brokenLearner = brokenUser ? await user.learner.findUnique({ where: { authUserId: brokenUser.id } }) : null;
  check("[恢复] 初始化失败不会创建学习者，也不泄露内部错误", broken.status >= 400 && brokenLearner == null && !brokenText.includes("forced") && !brokenText.includes("SQLITE") && !brokenText.includes(secret), brokenText);
  let recovered = false;
  if (brokenUser) {
    const brokenSign = await signIn("broken-reg@lab.test");
    const brokenCookie = cookieFrom(brokenSign);
    const denied = await api("/api/lessons", brokenCookie);
    const deniedBody = await denied.json() as { code?: string };
    const forged = await api("/api/learner/provision", brokenCookie, {
      method: "POST",
      body: JSON.stringify({ learnerId: "learner_original_lab", userId: "learner_original_lab" }),
    });
    const forgedBody = await forged.json() as { learnerId?: string };
    const ownLessons = await api("/api/lessons", brokenCookie);
    const ownList = await ownLessons.json() as unknown[];
    const originalAfter = await user.learner.findUniqueOrThrow({ where: { id: "learner_original_lab" } });
    recovered = brokenSign.status === 200 && denied.status === 403 && deniedBody.code === "LEARNER_UNBOUND"
      && forged.status === 200 && forgedBody.learnerId !== "learner_original_lab" && forgedBody.learnerId !== learnerAlpha.id
      && Array.isArray(ownList) && ownList.length === 0 && originalAfter.authUserId === "unbound:original-lab";
  } else {
    const retried = await signup("broken-reg@lab.test");
    const retriedUser = await getAuthPrisma().user.findUnique({ where: { email: "broken-reg@lab.test" } });
    const retriedLearner = retriedUser ? await user.learner.findUnique({ where: { authUserId: retriedUser.id } }) : null;
    recovered = retried.status === 200 && Boolean(retriedLearner) && retriedLearner?.id !== "learner_original_lab";
  }
  check("[恢复] 失败后可以获得自己的空学习空间", recovered);

  const pending = await createPrivateTestAccount({ email: "pending-reg@lab.test", password, name: "Pending" });
  const beforeConcurrent = await user.learner.count({ where: { authUserId: pending.id } });
  const [first, second] = await Promise.all([
    provisionOwnLearner(pending.id),
    provisionOwnLearner(pending.id),
  ]);
  const concurrentCount = await user.learner.count({ where: { authUserId: pending.id } });
  check("[绑定] 重复初始化只有一个 Learner", beforeConcurrent === 0 && first.id === second.id && concurrentCount === 1);

  process.env.VERCEL_ENV = "production";
  getAuth();
  check("[开关] Production 即使打开标记也保持关闭", publicSignupEnabled() === false);
  const productionSignup = await signup("production-reg@lab.test");
  const productionText = await productionSignup.text();
  const productionLogin = await signIn("alpha-reg@lab.test");
  check("[开关] Production 拒绝注册且不影响登录", productionSignup.status >= 400 && productionText.includes("EMAIL_PASSWORD_SIGN_UP_DISABLED") && productionLogin.status === 200 && await getAuthPrisma().user.count({ where: { email: "production-reg@lab.test" } }) === 0, productionText);
  delete process.env.VERCEL_ENV;
  delete process.env.AUTH_SIGNUP_ENABLED;
  getAuth();
  const closed = await signup("closed-reg@lab.test");
  const closedText = await closed.text();
  const closedLogin = await signIn("beta-reg@lab.test");
  check("[开关] 关闭注册后服务端拒绝，已有用户仍能登录", publicSignupEnabled() === false && closed.status >= 400 && closedText.includes("EMAIL_PASSWORD_SIGN_UP_DISABLED") && closedLogin.status === 200, closedText);

  process.env.AUTH_SIGNUP_ENABLED = "1";
  getAuth();
  let blocked = false;
  for (let index = 0; index < 12 && !blocked; index += 1) {
    const response = await signup(`rate-${index}@lab.test`);
    if (response.status === 429) blocked = true;
  }
  check("[注册] 注册请求会被限流", blocked);

  const speech = fs.readFileSync(path.join(repoRoot, "apps", "web", "src", "composables", "useSpeech.ts"), "utf8");
  const registerView = fs.readFileSync(path.join(repoRoot, "apps", "web", "src", "views", "Register.vue"), "utf8");
  check("[免费] 浏览器朗读不请求模型接口", !speech.includes("fetch(") && !speech.includes("/api/ai") && speech.includes("speechSynthesis"));
  check("[页面] 注册页检查两次密码", registerView.includes("两次输入的密码不一致。"));
  const ignore = execFileSync("git", ["check-ignore", "-v", "apps/server/.env.neon.production"], { cwd: repoRoot, encoding: "utf8" });
  const tracked = execFileSync("git", ["ls-files", "apps/server/.env.neon.production"], { cwd: repoRoot, encoding: "utf8" });
  const vercelIgnore = fs.readFileSync(path.join(repoRoot, ".vercelignore"), "utf8");
  check("[配置] Production 环境文件被 Git 忽略且未跟踪", ignore.includes(".env") && tracked.trim() === "" && vercelIgnore.includes(".env"));
} finally {
  setProvisionFault(null);
  delete process.env.VERCEL_ENV;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectUserPrisma();
  await disconnectAuthPrisma();
}

check("[数据库] lab.db 和 auth.db 没有变化", JSON.stringify(stamp(labDatabasePath)) === JSON.stringify(labBefore) && JSON.stringify(stamp(authDatabasePath)) === JSON.stringify(authBefore));
const registerDb = new DatabaseSync(userFile, { readOnly: true });
try {
  const originalLessons = Number(registerDb.prepare("SELECT COUNT(*) AS n FROM DailyLesson WHERE userId = 'learner_original_lab'").get().n);
  check("[数据库] 演练中的旧标记没有被写入课程", originalLessons === 0);
} finally {
  registerDb.close();
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("registration ok");
