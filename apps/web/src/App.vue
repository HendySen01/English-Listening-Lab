<template>
  <div v-if="!settled" class="boot-screen" role="status" aria-live="polite">正在确认登录</div>
  <router-view v-else-if="standalone" />
  <div v-else class="app-shell">
    <a class="skip" href="#main">跳到内容</a>
    <aside class="sidebar">
      <router-link class="brand" to="/">
        <strong>英语学习实验室</strong>
        <span>先听懂，再记住</span>
      </router-link>
      <nav class="nav" aria-label="主导航">
        <router-link to="/"><CalendarDays aria-hidden="true" :size="18" />今天</router-link>
        <router-link to="/context"><FileText aria-hidden="true" :size="18" />语境阅读</router-link>
        <router-link to="/lesson"><BookOpen aria-hidden="true" :size="18" />我的课程</router-link>
        <router-link to="/library"><Library aria-hidden="true" :size="18" />词汇库</router-link>
        <router-link to="/listening"><Headphones aria-hidden="true" :size="18" />听力训练</router-link>
        <router-link to="/review"><RotateCcw aria-hidden="true" :size="18" />复习计划</router-link>
        <router-link to="/stats"><BarChart3 aria-hidden="true" :size="18" />学习统计</router-link>
        <router-link to="/history"><History aria-hidden="true" :size="18" />历史课程</router-link>
        <router-link to="/settings"><Settings aria-hidden="true" :size="18" />设置</router-link>
      </nav>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div>
          <strong>{{ title }}</strong>
          <div class="muted">{{ store.dashboard?.dateLabel || "正在读取日期" }}</div>
        </div>
        <div class="row">
          <span v-if="store.dashboard?.lesson" class="badge">{{ store.dashboard.lesson.sourceLabel }}</span>
          <button class="choice" type="button" :aria-pressed="mode === 'light'" @click="setTheme('light')">浅色</button>
          <button class="choice" type="button" :aria-pressed="mode === 'dark'" @click="setTheme('dark')">深色</button>
          <button class="choice" type="button" :aria-pressed="mode === 'system'" @click="setTheme('system')">跟随系统</button>
          <button v-if="sessionEmail" class="choice" type="button" @click="signOut">退出</button>
        </div>
      </header>
      <main id="main" class="page">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { BarChart3, BookOpen, CalendarDays, FileText, Headphones, History, Library, RotateCcw, Settings } from "lucide-vue-next";
import { api } from "./api";
import { authClient } from "./lib/authClient";
import { multiUserRuntime } from "./lib/runtimeMode";
import { applyTheme, useAppStore, watchSystemTheme } from "./stores/app";

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const sessionEmail = ref("");
const settled = ref(false);
const standalone = computed(() => route.path.startsWith("/preview") || route.path === "/auth-lab" || route.path === "/login");
const titles: Record<string, string> = {
  "/": "今天",
  "/lesson": "我的课程",
  "/context": "语境阅读",
  "/library": "词汇库",
  "/listening": "听力训练",
  "/review": "复习计划",
  "/stats": "学习统计",
  "/history": "历史课程",
  "/settings": "设置",
};
const title = computed(() => titles[route.path] || (route.path.startsWith("/lesson") ? "我的课程" : "英语学习实验室"));
const mode = computed(() => store.dashboard?.settings.colorMode || localStorage.getItem("ell-color-mode") || "system");

async function setTheme(next: string) {
  applyTheme(next);
  if (!store.dashboard?.settings) return;
  store.dashboard.settings.colorMode = next;
  store.dashboard.settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(store.dashboard.settings),
  });
}

async function refreshSession() {
  try {
    const session = await authClient.getSession();
    sessionEmail.value = session.data?.user.email || "";
  } catch {
    sessionEmail.value = "";
    if (await multiUserRuntime() && route.path !== "/login") await router.replace("/login");
  }
}

async function signOut() {
  await authClient.signOut();
  sessionEmail.value = "";
  await router.push("/login");
}

onMounted(async () => {
  watchSystemTheme();
  await router.isReady();
  await refreshSession();
  settled.value = true;
  if (!standalone.value) void store.load();
});

watch(standalone, async (value) => {
  if (!settled.value) return;
  await refreshSession();
  if (!value) void store.load();
});
</script>
