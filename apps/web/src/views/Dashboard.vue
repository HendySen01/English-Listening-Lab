<template>
  <section v-if="data">
    <article class="card home-hero">
      <div>
        <p class="home-kicker">
          <span class="badge">{{ data.lesson?.sourceLabel || "今日课程" }}</span>
          <span>{{ data.dateLabel }}</span>
        </p>
        <h2>{{ data.lesson?.listening.title || "今天还没有课程" }}</h2>
        <p class="lede" v-if="data.lesson">{{ data.themeLabel }} · {{ data.lesson.difficulty }} · {{ data.lesson.newWordCount }} 个新词 · 约 {{ data.lesson.estimatedMinutes || data.estimatedMinutes }} 分钟</p>
        <p class="lede" v-else>{{ data.generateError || "打开课程页后会按设置准备今天的内容。" }}</p>
        <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="6" :aria-valuenow="done" aria-label="课程进度">
          <span :style="{ width: `${Math.round(done / 6 * 100)}%` }"></span>
        </div>
        <p class="muted">进度 {{ done }}/6，当前在{{ currentLabel }}。到期复习 {{ data.dueCount }} 个。<span v-if="nextDue">下一次：{{ nextDue }}。</span></p>
      </div>
      <router-link class="choice active" :to="data.lesson ? `/lesson/${data.lesson.id}` : '/lesson'">{{ started ? "继续学习" : "开始今日学习" }}</router-link>
    </article>

    <div class="home-grid">
      <article class="card">
        <h3>今日步骤</h3>
        <p class="muted">进度保存在这节课里，刷新后从当前步骤继续。</p>
        <ol class="step-list">
          <li v-for="(step, index) in steps" :key="step.id" :data-state="stateOf(step.id)">
            <span>{{ index + 1 }} {{ step.label }}</span>
            <span>{{ stateText(step.id) }}</span>
          </li>
        </ol>
      </article>
      <article class="card">
        <h3>到期复习</h3>
        <p class="muted" v-if="!data.upcoming?.length">现在没有已排期的复习。</p>
        <ul v-else class="step-list">
          <li v-for="item in data.upcoming" :key="item.id">
            <span><b translate="no">{{ item.lemma }}</b> {{ item.meaningZh }}</span>
            <span>{{ remain(item.due) }}</span>
          </li>
        </ul>
        <div class="row" style="margin-top: 16px">
          <router-link class="choice active" to="/review">立即复习</router-link>
          <router-link class="choice" to="/review">提前复习</router-link>
        </div>
      </article>
    </div>

    <div class="home-lower">
      <article class="card">
        <h3>最近七天</h3>
        <p class="muted">柱高对应学习分钟，数字写在下面。</p>
        <div class="week-bars">
          <div v-for="day in bars" :key="day.date">
            <i :style="{ height: day.height }"></i>
            <span>{{ day.label }} {{ day.minutes }}</span>
          </div>
        </div>
      </article>
      <article class="card">
        <h3>词汇回忆</h3>
        <p>今天已经复习 {{ data.reviewedToday }} 个。到期 {{ data.dueCount }} 个。</p>
        <p class="muted" v-if="data.recommendation">{{ data.recommendation.text }}</p>
      </article>
      <article class="card">
        <h3>听力理解</h3>
        <p v-if="data.lesson">{{ data.lesson.listening.title }}</p>
        <p v-else class="muted">今天的听力会跟课程一起出现。</p>
        <router-link class="choice" to="/listening">打开今日听力</router-link>
      </article>
    </div>
  </section>
  <p v-else-if="store.error" class="bad">{{ store.error }}</p>
  <p v-else>正在读取今天的课程……</p>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAppStore } from "../stores/app";
import { formatDue } from "../lib/due";

const store = useAppStore();
const data = computed(() => store.dashboard);
const now = ref(new Date());
const steps = [
  { id: "review", label: "复习" },
  { id: "vocabulary", label: "新词" },
  { id: "parts", label: "词根" },
  { id: "listening", label: "听力" },
  { id: "shadow", label: "跟读" },
  { id: "recall", label: "回忆" },
];
const done = computed(() => data.value?.lesson?.progress?.completed?.length || 0);
const started = computed(() => done.value > 0 || (data.value?.lesson?.progress?.step && data.value.lesson.progress.step !== "review"));
const currentLabel = computed(() => steps.find((step) => step.id === data.value?.lesson?.progress?.step)?.label || "复习");
const nextDue = computed(() => {
  const first = data.value?.upcoming?.[0];
  return first ? `${first.lemma} ${remain(first.due)}` : "";
});
const bars = computed(() => {
  const week = data.value?.week || [];
  const max = Math.max(1, ...week.map((day: { minutes: number }) => day.minutes));
  return week.map((day: { date: string; minutes: number }) => ({
    ...day,
    label: `周${"日一二三四五六"[new Date(`${day.date}T12:00:00`).getDay()]}`,
    height: day.minutes ? `${Math.max(8, Math.round(day.minutes / max * 100))}%` : "4px",
  }));
});
let timer = 0;
function remain(due: string) {
  return formatDue(due, now.value);
}
function stateOf(id: string) {
  const progress = data.value?.lesson?.progress;
  if (progress?.completed?.includes(id)) return "done";
  if (progress?.step === id) return "current";
  return "";
}
function stateText(id: string) {
  const state = stateOf(id);
  if (state === "done") return "已完成";
  if (state === "current") return "进行中";
  return "未开始";
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
