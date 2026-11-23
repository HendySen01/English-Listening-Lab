<template>
  <section v-if="data && dash">
    <div class="home-grid">
      <article class="card">
        <h3>最近七天</h3>
        <p class="muted">分钟来自已保存的学习记录。没有记录就是 0。</p>
        <div class="week-bars">
          <div v-for="day in bars" :key="day.date">
            <i :style="{ height: day.height }"></i>
            <span>{{ day.label }} {{ day.minutes }}</span>
          </div>
        </div>
      </article>
      <article class="card stack">
        <h3>词汇记忆</h3>
        <p>词库 {{ data.words }} 个，标为已认识 {{ data.known }} 个。</p>
        <p>已有复习次数的词 {{ data.reviews }} 个。到期 {{ dash.dueCount }} 个。</p>
        <p class="muted" v-if="dash.recommendation">{{ dash.recommendation.text }}</p>
      </article>
    </div>
    <div class="home-grid">
      <article class="card">
        <h3>听力理解</h3>
        <p v-if="data.quizTotal">测验答对 {{ data.quizCorrect }} / {{ data.quizTotal }}。</p>
        <p v-else class="muted">还没有保存的理解题记录。</p>
        <p class="muted">累计学习 {{ data.minutes }} 分钟，只计算页面里记下的时长。</p>
      </article>
      <article class="card">
        <h3>最近的 AI 调用</h3>
        <p v-if="!data.usage.length" class="muted">还没有调用。离线课程不会记成 AI 用量。</p>
        <p v-for="item in data.usage" :key="item.createdAt + item.kind">{{ item.kind }} · {{ item.model }} · {{ item.success ? "成功" : "失败" }}</p>
        <p class="muted">只记录供应商返回的 token，不估算金额。</p>
      </article>
    </div>
  </section>
  <p v-else>正在读取学习记录……</p>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";

const data = ref<any>(null);
const dash = ref<any>(null);
const bars = computed(() => {
  const week = dash.value?.week || [];
  const max = Math.max(1, ...week.map((day: { minutes: number }) => day.minutes));
  return week.map((day: { date: string; minutes: number }) => ({
    ...day,
    label: `周${"日一二三四五六"[new Date(`${day.date}T12:00:00`).getDay()]}`,
    height: day.minutes ? `${Math.max(8, Math.round(day.minutes / max * 100))}%` : "4px",
  }));
});
onMounted(async () => {
  [data.value, dash.value] = await Promise.all([api("/api/stats"), api("/api/dashboard")]);
});
</script>
