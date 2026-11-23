<template>
  <main class="login-gate">
    <h1>登录</h1>
    <p>公开注册未开放。登录后只访问当前账号的学习数据。</p>
    <form @submit.prevent="signIn">
      <label>
        邮箱
        <input v-model="email" type="email" autocomplete="username" required>
      </label>
      <label>
        密码
        <input v-model="password" type="password" autocomplete="current-password" required>
      </label>
      <button class="choice active" type="submit" :disabled="busy">登录</button>
    </form>
    <p role="status">{{ message }}</p>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../lib/authClient";

const router = useRouter();
const email = ref("");
const password = ref("");
const message = ref("");
const busy = ref(false);

async function signIn() {
  busy.value = true;
  message.value = "";
  try {
    const result = await authClient.signIn.email({ email: email.value, password: password.value });
    if (result.error) {
      message.value = "登录失败";
      return;
    }
    await router.push("/");
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.login-gate {
  max-width: 28rem;
  margin: 3rem auto;
  padding: 1.25rem;
  color: var(--ink);
  background: var(--paper);
}
label { display: grid; gap: 0.35rem; margin: 0.8rem 0; }
input { min-height: 44px; padding: 0.45rem 0.7rem; }
</style>
