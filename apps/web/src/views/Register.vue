<template>
  <main class="login-page">
    <section class="login-brand" aria-label="English Listening Lab">
      <p class="login-mark">English Listening Lab</p>
      <h1>英语学习实验室</h1>
      <p class="login-lede">注册后从自己的课程、词汇和复习开始。原来的练习记录不会带到新账号里。</p>
    </section>
    <section class="login-panel">
      <form @submit.prevent="register">
        <h2>注册</h2>
        <p class="login-help">{{ help }}</p>
        <label>
          邮箱
          <input v-model="email" type="email" name="email" autocomplete="username" inputmode="email" required :disabled="busy">
        </label>
        <label>
          密码
          <span class="password-field">
            <input v-model="password" :type="passwordVisible ? 'text' : 'password'" name="password" autocomplete="new-password" required :disabled="busy">
            <button type="button" :aria-pressed="passwordVisible" :disabled="busy" @click="passwordVisible = !passwordVisible">{{ passwordVisible ? "隐藏" : "显示" }}</button>
          </span>
        </label>
        <label>
          确认密码
          <span class="password-field">
            <input v-model="confirmPassword" :type="confirmVisible ? 'text' : 'password'" name="confirm-password" autocomplete="new-password" required :disabled="busy">
            <button type="button" :aria-pressed="confirmVisible" :disabled="busy" @click="confirmVisible = !confirmVisible">{{ confirmVisible ? "隐藏" : "显示" }}</button>
          </span>
        </label>
        <p class="login-error" role="alert">{{ message }}</p>
        <button class="login-submit" type="submit" :disabled="busy" :aria-busy="busy">{{ busy ? "正在注册" : "注册" }}</button>
        <p class="login-switch">已有账号？<router-link to="/login">返回登录</router-link></p>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../lib/authClient";

const router = useRouter();
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const message = ref("");
const help = ref("每个账号有自己的学习记录。邮箱验证邮件还没有配置。");
const busy = ref(false);
const passwordVisible = ref(false);
const confirmVisible = ref(false);
const signupOpen = ref(true);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nameFromEmail = computed(() => email.value.trim().split("@")[0] || "learner");

function passwordIssue(value: string, mail: string) {
  if (!value) return "请填写密码。";
  if (value.length < 8 || value.length > 128) return "密码需要 8 到 128 位。";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "密码需要同时包含字母和数字。";
  if (mail && value.toLowerCase() === mail.toLowerCase()) return "密码不能与邮箱相同。";
  return "";
}

function signupFailure(error: { status?: unknown; message?: unknown; code?: unknown }) {
  const status = Number(error.status || 0);
  const code = String(error.code || "");
  const text = String(error.message || "");
  if (code.includes("SIGN_UP_DISABLED") || text.includes("SIGN_UP_DISABLED")) return "当前环境没有开放注册。";
  if (status === 429 || code.includes("TOO_MANY") || code.includes("RATE")) return "尝试次数太多，请稍后再试。";
  if (code.includes("ALREADY") || /already exists/i.test(text)) return "这个邮箱已经注册。";
  if (code === "WEAK_PASSWORD" || code === "LEARNER_PROVISION_FAILED") return text || "注册没有完成，请稍后再试。";
  if (/[\u4e00-\u9fff]/.test(text) && !/prisma|sqlite|password hash|secret/i.test(text)) return text;
  if (status === 403) return "当前环境没有开放注册。";
  return "注册没有完成，请稍后再试。";
}

onMounted(async () => {
  try {
    const status = await fetch("/api/signup-status", { credentials: "include" });
    if (!status.ok) return;
    const body = await status.json() as { enabled?: boolean };
    signupOpen.value = body.enabled !== false;
    if (!signupOpen.value) help.value = "当前环境没有开放注册。已有账号仍可以登录。";
  } catch {
    message.value = "网络异常，还没有确认注册是否开放。";
  }
});

async function register() {
  if (busy.value) return;
  const mail = email.value.trim();
  message.value = "";
  if (!mail || !emailPattern.test(mail)) {
    message.value = "请填写有效的邮箱。";
    return;
  }
  const issue = passwordIssue(password.value, mail);
  if (issue) {
    message.value = issue;
    return;
  }
  if (password.value !== confirmPassword.value) {
    message.value = "两次输入的密码不一致。";
    return;
  }
  busy.value = true;
  try {
    const result = await authClient.signUp.email({
      email: mail,
      password: password.value,
      name: nameFromEmail.value,
    });
    if (result.error) {
      message.value = signupFailure(result.error);
      return;
    }
    if (signupOpen.value) {
      const ready = await fetch("/api/learner/provision", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!ready.ok) {
        const payload = await ready.json().catch(() => ({})) as { error?: string };
        message.value = payload.error || "账号已创建，学习空间还没有准备好。请登录后再试。";
        return;
      }
    }
    const session = await authClient.getSession();
    await router.push(session.data?.user ? "/" : "/login");
  } catch {
    message.value = "网络异常，这次注册没有发出。";
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(280px, 1.08fr) minmax(320px, 0.92fr);
  background: var(--bg);
  color: var(--ink);
}
.login-brand {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 14px;
  min-height: 100vh;
  padding: 64px 56px;
  background:
    radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.08), transparent 28%),
    #273b32;
  color: #f7f6f1;
}
.login-mark {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #d7e4d4;
}
.login-brand h1 {
  max-width: 8em;
  margin: 0;
  font-family: "DM Serif Display", Georgia, "Songti SC", serif;
  font-size: clamp(42px, 5vw, 68px);
  font-weight: 400;
  line-height: 1.02;
  letter-spacing: -0.04em;
}
.login-lede { max-width: 28em; margin: 0; color: #e4ebe2; font-size: 17px; line-height: 1.7; }
.login-panel { display: grid; place-items: center; padding: 40px 28px; }
form { width: min(420px, 100%); padding: 8px 0; }
h2 {
  margin: 0;
  font-family: "DM Serif Display", Georgia, "Songti SC", serif;
  font-size: 36px;
  font-weight: 400;
  letter-spacing: -0.03em;
}
.login-help { margin: 8px 0 22px; color: var(--muted); line-height: 1.6; }
label { display: grid; gap: 8px; margin: 0 0 16px; font-size: 14px; font-weight: 650; }
input {
  width: 100%;
  min-height: 48px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  color: var(--ink);
  padding: 0 14px;
}
input:focus { outline: 2px solid var(--focus); outline-offset: 2px; border-color: var(--selected); }
.password-field { position: relative; display: block; }
.password-field input { padding-right: 76px; }
.password-field button {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 64px;
  min-height: 36px;
  border: 0;
  border-radius: 9px;
  background: var(--hover);
  color: var(--ink);
  cursor: pointer;
}
.password-field button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.login-error { min-height: 1.5em; margin: 0 0 12px; color: var(--warn); font-size: 14px; }
.login-submit {
  width: 100%;
  min-height: 48px;
  border: 1px solid #1e3028;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 1px 2px rgba(39, 59, 50, 0.22);
}
.login-submit:hover:not(:disabled) { background: var(--accent-hover); }
.login-submit:active:not(:disabled) { transform: translateY(1px); }
.login-submit:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
.login-submit:disabled { cursor: not-allowed; opacity: 0.72; }
.login-switch { margin: 16px 0 0; color: var(--muted); font-size: 14px; text-align: center; }
.login-switch a { color: var(--accent-text); font-weight: 650; text-decoration: underline; text-underline-offset: 3px; }
.login-switch a:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
@media (max-width: 800px) {
  .login-page { grid-template-columns: 1fr; }
  .login-brand { min-height: 0; padding: 36px 24px 28px; }
  .login-brand h1 { max-width: none; font-size: 40px; }
  .login-panel { align-items: start; padding: 28px 20px 48px; }
}
@media (prefers-reduced-motion: reduce) {
  .login-submit:active:not(:disabled) { transform: none; }
}
</style>
