<template>
  <main class="auth-email">
    <section class="card stack">
      <h1>{{ title }}</h1>
      <p v-if="verified" role="status">邮箱已验证。</p>
      <p v-else-if="route.query.error" class="bad" role="alert">链接无效或已过期，请重新申请。</p>
      <form v-if="showForm" class="stack" @submit.prevent="submit">
        <label v-if="reset" class="field">新密码
          <input v-model="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" :disabled="busy">
          <span>8 到 128 位，包含字母和数字。</span>
        </label>
        <label v-else class="field">邮箱
          <input v-model="email" type="email" autocomplete="email" required :disabled="busy">
        </label>
        <button class="choice active" type="submit" :disabled="busy || (!reset && !delivery)">
          {{ busy ? "正在处理…" : reset ? "保存新密码" : "请求邮件" }}
        </button>
      </form>
      <p v-if="!reset && !verified && delivery === false" class="muted" role="status">邮箱验证和密码找回暂不可用。</p>
      <p v-if="message" :class="{ bad: failed }" role="status">{{ message }}</p>
      <div class="row">
        <router-link v-if="reset && !showForm && !completed" to="/forgot-password">重新申请链接</router-link>
        <router-link to="/login">返回登录</router-link>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { authClient } from "../lib/authClient";

const route = useRoute();
const router = useRouter();
const reset = computed(() => route.path === "/reset-password");
const verification = computed(() => route.path === "/email-verification");
const verified = computed(() => verification.value && route.query.verified === "1" && !route.query.error);
const title = computed(() => reset.value ? "重设密码" : verification.value ? "验证邮箱" : "找回密码");
const token = ref("");
const email = ref("");
const password = ref("");
const message = ref("");
const delivery = ref<boolean | null>(null);
const busy = ref(false);
const failed = ref(false);
const completed = ref(false);
const showForm = computed(() => !verified.value && !completed.value && (!reset.value || Boolean(token.value)));

watch(() => route.path, async () => {
  token.value = typeof route.query.token === "string" ? route.query.token : "";
  message.value = reset.value && !token.value && !route.query.error ? "请使用邮件中的重设链接。" : "";
  completed.value = false;
  if (!reset.value && !verified.value) {
    const status = await api<{ emailDelivery: string }>("/api/signup-status").catch(() => null);
    delivery.value = status ? status.emailDelivery === "configured" : null;
    if (!status) message.value = "暂时无法读取邮件服务状态，请稍后再试。";
  }
}, { immediate: true });

async function submit() {
  if (busy.value || (!reset.value && delivery.value !== true)) return;
  busy.value = true;
  failed.value = false;
  try {
    if (reset.value) {
      if (!/[A-Za-z]/.test(password.value) || !/\d/.test(password.value)) throw new Error("密码需要同时包含字母和数字。");
      const result = await authClient.resetPassword({ token: token.value, newPassword: password.value });
      if (result.error) throw new Error(result.error.status === 429 ? "请求太频繁，请稍后再试。" : "无法重设密码，请检查链接或重新申请。");
      message.value = "密码已更新，请重新登录。";
      completed.value = true;
      password.value = "";
      token.value = "";
      await router.replace({ path: route.path });
      return;
    }
    const result = verification.value
      ? await authClient.sendVerificationEmail({ email: email.value, callbackURL: "/email-verification?verified=1" })
      : await authClient.requestPasswordReset({ email: email.value, redirectTo: "/reset-password" });
    if (result.error?.status === 429) throw new Error("请求太频繁，请稍后再试。");
    message.value = "如果该邮箱符合发送条件，请查看收件箱或垃圾邮件。";
  } catch (error) {
    failed.value = true;
    message.value = error instanceof Error ? error.message : "请求失败，请稍后再试。";
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.auth-email {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.auth-email section { width: min(100%, 440px); }
</style>
