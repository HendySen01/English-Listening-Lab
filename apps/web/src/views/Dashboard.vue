<template>
  <section class="stack" v-if="data">
    <div class="card">
      <div class="row" style="justify-content: space-between">
        <div>
          <h2>{{ data.dateLabel }}</h2>
          <p>今天的主题：{{ data.themeLabel }}</p>
        </div>
        <div class="row">
          <router-link class="choice active" :to="data.lesson ? `/lesson/${data.lesson.id}` : '/lesson'">开始今天的课</router-link>
          <router-link v-if="data.resumeStep" class="choice" :to="`/lesson/${data.lesson.id}`">继续上次进度</router-link>
        </div>
      </div>
      <p v-if="data.generateError" class="bad">{{ data.generateError }}</p>
      <p v-else-if="data.lesson" class="muted">课程已保存在本机。刷新页面不会重新调用 AI。</p>
    </div>
    <div class="grid">
      <article class="card"><h3>新词</h3><p class="word">{{ data.settings.dailyNewWords }}</p><p class="muted">今天课程里是 {{ data.lesson?.newWordCount ?? "尚未生成" }} 个</p></article>
      <article class="card"><h3>难度</h3><p class="word" style="font-size: 32px">{{ data.settings.difficulty }}</p><p class="muted">{{ data.settings.difficulty === "CET-4" ? "考试词汇模式，不是 CEFR 等级" : "可在设置里调整" }}</p></article>
      <article class="card"><h3>预计时间</h3><p class="word">{{ data.estimatedMinutes }}</p><p class="muted">分钟。词更多，时间会变长。这不是倒计时。</p></article>
      <article class="card"><h3>到期复习</h3><p class="word">{{ data.dueCount }}</p><p class="muted">今天已正式复习 {{ data.reviewedToday || 0 }} 个。没有到期时，下面仍会显示下一次时间。</p></article>
    </div>
    <article class="card" v-if="data.recommendation">
      <h3>学习建议</h3>
      <p>{{ data.recommendation.text }}</p>
    </article>
    <article class="card" v-if="data.upcoming?.length">
      <h3>接下来要复习的词</h3>
      <p v-for="item in data.upcoming" :key="item.id">
        <strong>{{ item.lemma }}</strong>
        <span class="muted"> · {{ item.meaningZh }} · {{ formatWhen(item.due) }} · {{ remain(item.due) }}</span>
      </p>
      <router-link class="choice" to="/review">去复习</router-link>
    </article>
    <article class="card" v-else>
      <h3>复习安排</h3>
      <p>还没有进入正式复习排程的词。学完今天的新词并评分后，这里会显示下一次复习时间。</p>
    </article>
    <article class="card">
      <h3>最近七日</h3>
      <div class="bars">
        <div v-for="day in data.week" :key="day.date">
          <div class="bar" :style="{ height: `${Math.max(8, day.minutes * 4)}px` }"></div>
          <div class="bar-label">{{ day.date.slice(5) }}<br />{{ day.minutes }} 分钟</div>
        </div>
      </div>
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
