<template>
  <main class="login-page">
    <section class="login-brand" aria-label="English Listening Lab">
      <p class="login-mark">English Listening Lab</p>
      <h1>英语学习实验室</h1>
      <p class="login-lede">先听懂，再记住。每天从一句语境开始，把新词放回真正会用的句子里。</p>
    </section>
    <section class="login-panel">
      <form @submit.prevent="signIn">
        <h2>登录</h2>
        <p class="login-help">登录后只访问当前账号的学习数据。</p>
        <label>
          邮箱
          <input v-model="email" type="email" name="email" autocomplete="username" required :disabled="busy">
        </label>
        <label>
          密码
          <span class="password-field">
            <input v-model="password" :type="passwordVisible ? 'text' : 'password'" name="password" autocomplete="current-password" required :disabled="busy">
            <button type="button" :aria-pressed="passwordVisible" :disabled="busy" @click="passwordVisible = !passwordVisible">{{ passwordVisible ? "隐藏" : "显示" }}</button>
          </span>
        </label>
        <p class="login-error" role="alert">{{ message }}</p>
        <button class="login-submit" type="submit" :disabled="busy" :aria-busy="busy">{{ busy ? "正在登录" : "登录" }}</button>
        <p class="login-switch">没有账号？<router-link to="/register">注册</router-link></p>
        <p class="login-switch"><router-link to="/forgot-password">忘记密码</router-link></p>
        <p v-if="mailUnavailable" class="login-switch">邮箱验证和密码找回暂不可用。</p>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { authClient } from "../lib/authClient";

const router = useRouter();
const email = ref("");
const password = ref("");
const message = ref("");
const busy = ref(false);
const passwordVisible = ref(false);
const mailUnavailable = ref(false);

onMounted(async () => {
  const status = await api<{ emailDelivery: string }>("/api/signup-status").catch(() => null);
  mailUnavailable.value = status?.emailDelivery === "unconfigured";
});

async function prepareLearner() {
  const status = await fetch("/api/signup-status", { credentials: "include" });
  if (!status.ok) return true;
  const body = await status.json() as { learnerProvisioning?: boolean };
  if (!body.learnerProvisioning) return true;
  const ready = await fetch("/api/learner/provision", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (ready.ok) return true;
  const payload = await ready.json().catch(() => ({})) as { error?: string };
  message.value = payload.error || "学习空间还没有准备好。请稍后再试。";
  return false;
}

async function signIn() {
  if (busy.value) return;
  busy.value = true;
  message.value = "";
  try {
    let retryAfter = 0;
    const result = await authClient.signIn.email({
      email: email.value, password: password.value,
      fetchOptions: {
        retry: 0,
        onError({ response }) {
          const value = response.headers.get("Retry-After") || response.headers.get("X-Retry-After") || "";
          retryAfter = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
        },
      },
    });
    if (result.error) {
      const status = "status" in result.error ? Number(result.error.status) : 0;
      const wait = retryAfter >= 60 ? `${Math.ceil(retryAfter / 60)} 分钟` : `${retryAfter} 秒`;
      message.value = status === 429
        ? retryAfter > 0 ? `尝试次数太多，请等待约 ${wait}再试。` : "尝试次数太多，请稍后再试。"
        : status === 401 ? "邮箱或密码不正确。" : "登录没有完成，请稍后再试。";
      return;
    }
    if (!(await prepareLearner())) return;
    await router.push("/");
  } catch {
    message.value = "网络异常，这次登录没有发出。";
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
form {
  width: min(420px, 100%);
  padding: 8px 0;
}
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
