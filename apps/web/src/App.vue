<template>
  <router-view v-if="isPreview" />
  <div v-else class="app-shell">
    <a class="skip" href="#main">跳到内容</a>
    <aside class="sidebar">
      <router-link class="brand" to="/">
        <strong>英语学习实验室</strong>
        <span>先听懂，再记住</span>
      </router-link>
      <nav class="nav" aria-label="主导航">
        <router-link to="/"><CalendarDays aria-hidden="true" :size="18" />今天</router-link>
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
          <button class="choice" @click="cycleTheme">{{ themeLabel }}</button>
        </div>
      </header>
      <main id="main" class="page">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { BarChart3, BookOpen, CalendarDays, Headphones, History, Library, RotateCcw, Settings } from "lucide-vue-next";
import { api } from "./api";
import { applyTheme, useAppStore, watchSystemTheme } from "./stores/app";

const route = useRoute();
const store = useAppStore();
const isPreview = computed(() => route.path.startsWith("/preview"));
const titles: Record<string, string> = {
  "/": "今天",
  "/lesson": "我的课程",
  "/library": "词汇库",
  "/listening": "听力训练",
  "/review": "复习计划",
  "/stats": "学习统计",
  "/history": "历史课程",
  "/settings": "设置",
};
const title = computed(() => titles[route.path] || (route.path.startsWith("/lesson") ? "我的课程" : "英语学习实验室"));
const themeLabel = computed(() => {
  const mode = store.dashboard?.settings.colorMode || localStorage.getItem("ell-color-mode") || "system";
  if (mode === "dark") return "深色";
  if (mode === "light") return "浅色";
  return "跟随系统";
});

async function cycleTheme() {
  const current = store.dashboard?.settings.colorMode || localStorage.getItem("ell-color-mode") || "system";
  const next = current === "light" ? "dark" : current === "dark" ? "system" : "light";
  applyTheme(next);
  if (!store.dashboard?.settings) return;
  store.dashboard.settings.colorMode = next;
  store.dashboard.settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(store.dashboard.settings),
  });
}

onMounted(() => {
  watchSystemTheme();
  if (!isPreview.value) void store.load();
});

watch(isPreview, (preview) => {
  if (!preview) void store.load();
});
</script>
