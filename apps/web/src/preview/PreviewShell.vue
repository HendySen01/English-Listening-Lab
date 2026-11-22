<template>
  <div class="pv" :class="{ dark: theme === 'dark' }">
    <a class="pv-skip" href="#preview-main">跳到内容</a>
    <div class="pv-shell">
      <aside class="pv-side">
        <router-link class="pv-brand" to="/preview/home">
          <strong>英语学习实验室</strong>
          <span>设计预览</span>
        </router-link>
        <nav class="pv-nav" aria-label="预览导航">
          <router-link to="/preview/home"><CalendarDays aria-hidden="true" :size="18" />今天</router-link>
          <router-link to="/preview/context"><FileText aria-hidden="true" :size="18" />语境阅读</router-link>
          <router-link to="/preview/words"><BookOpen aria-hidden="true" :size="18" />我的课程</router-link>
          <button type="button" @click="hold('词汇库仍使用现在的正式页面。确认这套设计后才会替换。')"><Library aria-hidden="true" :size="18" />词汇库</button>
          <router-link to="/preview/listening"><Headphones aria-hidden="true" :size="18" />听力训练</router-link>
          <button type="button" @click="hold('复习计划仍走现有 FSRS。这个预览不写入复习记录。')"><RotateCcw aria-hidden="true" :size="18" />复习计划</button>
          <button type="button" @click="hold('学习统计不在本次三个预览页里。')"><BarChart3 aria-hidden="true" :size="18" />学习统计</button>
          <button type="button" @click="hold('历史课程仍在正式页面。预览不会切换课程版本。')"><History aria-hidden="true" :size="18" />历史课程</button>
          <button type="button" @click="hold('设置仍在正式页面。预览里的深色开关只影响这三页。')"><Settings aria-hidden="true" :size="18" />设置</button>
        </nav>
        <p class="pv-note">示例课程。只有「AI 深度解析」会调用模型，结果只写入预览缓存。</p>
      </aside>
      <div class="pv-main">
        <header class="pv-top">
          <div>
            <h1>{{ head[0] }}</h1>
            <p>{{ head[1] }}</p>
          </div>
          <div class="pv-top-actions">
            <button class="pv-btn" type="button" @click="setTheme('light')" :aria-pressed="theme === 'light'">浅色</button>
            <button class="pv-btn" type="button" @click="setTheme('dark')" :aria-pressed="theme === 'dark'">深色</button>
            <router-link class="pv-btn quiet" to="/">返回正式版</router-link>
          </div>
        </header>
        <main id="preview-main" class="pv-content">
          <p v-if="note" class="pv-toast" role="status">{{ note }}</p>
          <router-view />
        </main>
      </div>
    </div>
    <nav class="pv-bottom" aria-label="预览底部导航">
      <router-link to="/preview/home"><CalendarDays aria-hidden="true" :size="18" />今天</router-link>
      <router-link to="/preview/context"><FileText aria-hidden="true" :size="18" />语境</router-link>
      <router-link to="/preview/words"><BookOpen aria-hidden="true" :size="18" />单词</router-link>
      <router-link to="/preview/listening"><Headphones aria-hidden="true" :size="18" />听力</router-link>
      <router-link to="/">返回</router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { BarChart3, BookOpen, CalendarDays, FileText, Headphones, History, Library, RotateCcw, Settings } from "lucide-vue-next";
import "./preview.css";

const route = useRoute();
const theme = ref(sessionStorage.getItem("ell-preview-theme") === "dark" ? "dark" : "light");
const note = ref("");
const heads: Record<string, [string, string]> = {
  "/preview/home": ["今天", "今天学什么，点哪里继续"],
  "/preview/context": ["语境学习", "句子在左，解释在右"],
  "/preview/words": ["单词学习", "例句清楚，中文默认模糊"],
  "/preview/listening": ["听力训练", "原文可以点词"],
  "/preview/words-card": ["单词学习", "上一版卡片"],
  "/preview/listening-card": ["听力训练", "上一版听力"],
};
const head = computed(() => heads[route.path] || ["设计预览", "不写入学习记录"]);

function setTheme(mode: "light" | "dark") {
  theme.value = mode;
  sessionStorage.setItem("ell-preview-theme", mode);
}

function hold(message: string) {
  note.value = message;
}
</script>

<style scoped>
.pv-skip {
  position: absolute;
  left: 12px;
  top: -40px;
  z-index: 8;
  background: var(--surface);
  color: var(--text-primary);
  padding: 8px 12px;
}
.pv-skip:focus { top: 8px; }
</style>
