<template>
  <section class="stack" v-if="data">
    <div class="grid">
      <article class="card"><h3>已学词</h3><p class="word">{{ data.words }}</p></article>
      <article class="card"><h3>标为已认识</h3><p class="word">{{ data.known }}</p></article>
      <article class="card"><h3>测验</h3><p class="word">{{ data.quizTotal ? Math.round((data.quizCorrect / data.quizTotal) * 100) : 0 }}%</p><p class="muted">{{ data.quizCorrect }} / {{ data.quizTotal }}。样本少时不要当成水平结论。</p></article>
      <article class="card"><h3>记录时长</h3><p class="word">{{ data.minutes }}</p><p class="muted">分钟。只统计页面里实际记录的学习。</p></article>
    </div>
    <article class="card">
      <h3>最近的 AI 调用</h3>
      <p v-if="!data.usage.length" class="muted">还没有调用。离线课程不会记成 AI 用量。</p>
      <p v-for="item in data.usage" :key="item.createdAt + item.kind">
        {{ item.kind }} · {{ item.model }} · {{ item.success ? "成功" : "失败" }} · 输入 {{ item.promptTokens ?? "未知" }} / 输出 {{ item.completionTokens ?? "未知" }} token
      </p>
      <p class="muted">这里只记录供应商返回的 token。价格以供应商账单为准，程序不估算金额。</p>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
const data = ref<any>(null);
onMounted(async () => {
  data.value = await api("/api/stats");
});
</script>
