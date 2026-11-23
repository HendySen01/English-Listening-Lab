<template>
  <main class="auth-lab">
    <p class="auth-warning">此页面只测试登录基础设施。学习数据还没有按用户隔离，当前服务不可公开部署。</p>
    <h1>认证测试</h1>
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
      <button class="choice" type="button" :disabled="busy" @click="signOut">退出</button>
    </form>
    <p>{{ message }}</p>
    <p v-if="currentEmail">当前会话：{{ currentEmail }}</p>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { authClient } from "../lib/authClient";

const email = ref("");
const password = ref("");
const message = ref("公开注册未开放。");
const currentEmail = ref("");
const busy = ref(false);

async function refresh() {
  const session = await authClient.getSession();
  currentEmail.value = session.data?.user.email || "";
}

async function signIn() {
  busy.value = true;
  message.value = "";
  try {
    const result = await authClient.signIn.email({ email: email.value, password: password.value });
    message.value = result.error ? "登录失败" : "登录成功";
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function signOut() {
  busy.value = true;
  try {
    await authClient.signOut();
    currentEmail.value = "";
    message.value = "已退出";
  } finally {
    busy.value = false;
  }
}

onMounted(refresh);
</script>

<style scoped>
.auth-lab {
  max-width: 32rem;
  margin: 2rem auto;
  padding: 1rem;
  color: var(--ink);
  background: var(--paper);
}
.auth-warning {
  color: var(--warn);
}
label {
  display: grid;
  gap: 0.35rem;
  margin: 0.8rem 0;
}
input {
  min-height: 44px;
  padding: 0.4rem 0.6rem;
}
button {
  margin-right: 0.5rem;
}
</style>
