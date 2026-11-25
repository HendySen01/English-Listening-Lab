<template>
  <section v-if="data && dash && words">
    <div class="stat-overview">
      <article><span>本周学习</span><strong>{{ weekMinutes }}</strong><small>分钟</small></article>
      <article><span>词库</span><strong>{{ data.words }}</strong><small>个词</small></article>
      <article><span>已复习</span><strong>{{ data.reviews }}</strong><small>个有记录的词</small></article>
      <article><span>理解题</span><strong>{{ data.quizTotal }}</strong><small>次作答</small></article>
    </div>
    <div class="stat-main">
      <StudyWeek :days="dash.week" :today="dash.weekToday" />
      <article class="card">
        <h3>词汇记忆</h3>
        <ul class="memory-list">
          <li v-for="item in memory" :key="item.label"><span>{{ item.label }}</span><strong>{{ item.count }}</strong></li>
        </ul>
        <p class="muted">新学是还没有复习次数的词。待复习是已经到期、且没有标成认识的词。已掌握是标为认识或非常熟悉的词。</p>
      </article>
    </div>
    <article class="card">
      <h3>听力理解</h3>
      <p v-if="data.quizTotal">作答 {{ data.quizTotal }} 次，答对 {{ data.quizCorrect }} 次。</p>
      <p v-else class="muted">暂无足够数据。还没有保存的理解题记录，这里不显示提升百分比。</p>
    </article>
    <details class="card" open>
      <summary>AI 使用详情</summary>
      <h4>额度记录</h4>
      <p v-if="data.charges == null" class="muted">当前接口没有返回 AiCharge 额度记录。这里不会把缺失的额度显示成零次使用。</p>
      <p v-else-if="!data.charges.length" class="muted">还没有 AiCharge 额度记录。</p>
      <p v-for="item in data.charges || []" :key="'charge-' + item.createdAt + item.kind">{{ item.mock ? "Mock 额度" : "额度记录" }} · {{ item.kind }} · {{ item.status }} · {{ item.studyDate }}</p>
      <h4>历史调用</h4>
      <p v-if="!data.usage.length" class="muted">还没有 AIUsageRecord 历史记录。额度预留和历史调用分属两张表，空的历史记录不是零次额度。</p>
      <p v-for="item in data.usage" :key="'usage-' + item.createdAt + item.kind">{{ item.model === "mock" ? "Mock 历史" : "历史调用" }} · {{ item.kind }} · {{ item.model }} · {{ item.success ? "成功" : "失败" }} · 输入 {{ item.promptTokens ?? "未知" }} / 输出 {{ item.completionTokens ?? "未知" }} token</p>
    </details>
  </section>
  <p v-else>正在读取学习记录……</p>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import StudyWeek from "../components/StudyWeek.vue";
import { api } from "../api";

const data = ref<any>(null);
const dash = ref<any>(null);
const words = ref<any[] | null>(null);
const weekMinutes = computed(() => (dash.value?.week || []).reduce((sum: number, day: { minutes: number | null }) => sum + (day.minutes ?? 0), 0));
const memory = computed(() => {
  const now = Date.now();
  const buckets = { fresh: 0, learning: 0, due: 0, known: 0 };
  const seen = new Set<string>();
  for (const word of words.value || []) {
    const reviewId = word.reviewId ?? word.id;
    if (seen.has(reviewId)) continue;
    seen.add(reviewId);
    if (word.knownAlready || word.familiarity === "easy") buckets.known += 1;
    else if (word.due && new Date(word.due).getTime() <= now) buckets.due += 1;
    else if (!word.reps) buckets.fresh += 1;
    else buckets.learning += 1;
  }
  return [
    { label: "新学", count: buckets.fresh },
    { label: "学习中", count: buckets.learning },
    { label: "待复习", count: buckets.due },
    { label: "已掌握", count: buckets.known },
  ];
});
onMounted(async () => {
  [data.value, dash.value, words.value] = await Promise.all([api("/api/stats"), api("/api/dashboard"), api("/api/library")]);
});
</script>
