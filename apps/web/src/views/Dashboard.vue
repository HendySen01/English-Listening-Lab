<template>
  <section class="stack" v-if="data">
    <article class="study-hero">
      <div>
        <p class="origin">{{ data.lesson?.sourceLabel || "今日课程" }}</p>
        <h2>{{ data.lesson?.listening.title || data.themeLabel }}</h2>
        <p class="lede">{{ data.themeLabel }} · {{ data.settings.difficulty }} · {{ data.lesson?.newWordCount || data.settings.dailyNewWords }} 个新词 · 大约 {{ data.settings.dailyMinutes }} 分钟</p>
        <p>进度 {{ done }} / 6。到期复习 {{ data.dueCount }} 个。<span v-if="nextDue">下一次 {{ nextDue }}。</span></p>
      </div>
      <div class="stack">
        <router-link class="choice active" :to="data.lesson ? `/lesson/${data.lesson.id}` : '/lesson'">{{ started ? "继续学习" : "开始今日学习" }}</router-link>
        <router-link class="choice" to="/review">复习旧词</router-link>
      </div>
    </article>
    <article class="card" v-if="data.upcoming?.length">
      <h3>接下来要复习</h3>
      <p v-for="item in data.upcoming" :key="item.id">
        <strong translate="no">{{ item.lemma }}</strong>
        <span class="muted"> {{ item.meaningZh }}，{{ remain(item.due) }}</span>
      </p>
    </article>
  </section>
  <p v-else-if="store.error" class="bad">{{ store.error }}</p>
  <p v-else>正在读取今天的课程……</p>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAppStore } from "../stores/app";
import { formatDue, formatWhen } from "../lib/due";

const store = useAppStore();
const data = computed(() => store.dashboard);
const now = ref(new Date());
const done = computed(() => data.value?.lesson?.progress?.completed?.length || 0);
const started = computed(() => done.value > 0 || (data.value?.lesson?.progress?.step && data.value.lesson.progress.step !== "review"));
const nextDue = computed(() => {
  const first = data.value?.upcoming?.[0];
  return first ? remain(first.due) : "";
});
let timer = 0;
function remain(due: string) {
  return formatDue(due, now.value);
}
onMounted(() => {
  void store.load();
  timer = window.setInterval(() => {
    now.value = new Date();
  }, 30000);
  document.addEventListener("visibilitychange", refreshClock);
});
onUnmounted(() => {
  window.clearInterval(timer);
  document.removeEventListener("visibilitychange", refreshClock);
});
function refreshClock() {
  if (!document.hidden) now.value = new Date();
}
</script>
