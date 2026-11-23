<template>
  <section class="timeline">
    <article v-for="day in days" :key="day.date" class="day-block">
      <h2>{{ day.label }}</h2>
      <div class="card day-card">
        <div class="day-head">
          <div>
            <p class="home-kicker">
              <span class="badge" v-if="day.primary.active && day.date === days[0].date">今天正在学</span>
              <span class="badge" v-else-if="day.primary.active">这一天选用的版本</span>
              <span v-else class="badge">第 {{ day.primary.version }} 版</span>
              <span>{{ day.primary.sourceLabel }} · {{ day.primary.difficulty }}</span>
            </p>
            <h3>{{ day.primary.listeningTitle || day.primary.theme }}</h3>
            <p class="muted">{{ day.primary.theme }} · {{ day.primary.newWordCount }} 个词 · {{ stepLabel(day.primary.progress?.step) }}</p>
            <div class="progress-track" aria-hidden="true"><span :style="{ width: progressWidth(day.primary) }"></span></div>
          </div>
          <div class="row">
            <router-link class="choice active" :to="`/lesson/${day.primary.id}`">继续学习</router-link>
            <button class="choice" type="button" @click="toggle(day.primary.id)">{{ openId === day.primary.id ? "收起详情" : "查看课程详情" }}</button>
          </div>
        </div>
        <div v-if="day.rest.length" class="version-line">
          <button class="text-button" type="button" @click="versions[day.date] = !versions[day.date]">共 {{ day.lessons.length }} 个版本 · {{ versions[day.date] ? "收起历史版本" : "查看历史版本" }}</button>
          <div v-if="versions[day.date]" class="version-list">
            <div v-for="item in day.rest" :key="item.id" class="version-row">
              <span>第 {{ item.version }} 版 · {{ item.listeningTitle || item.theme }} · {{ item.sourceLabel }}</span>
              <button class="choice" type="button" @click="toggle(item.id)">{{ openId === item.id ? "收起" : "查看" }}</button>
            </div>
          </div>
        </div>
        <div v-if="detail && detail.id === openId" class="detail-panel">
          <p>{{ detail.listening.text }}</p>
          <p v-for="word in detail.words" :key="word.id"><strong translate="no">{{ word.lemma }}</strong> {{ word.meaningZh }} · {{ word.example }}</p>
          <p class="muted">理解题 {{ detail.questions.length }} 道。旧版本仍保留，这里不能删除。</p>
          <router-link class="choice" :to="`/context?lesson=${detail.id}`">打开语境</router-link>
        </div>
      </div>
    </article>
    <p v-if="!days.length" class="muted">还没有历史课程。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type { Lesson } from "../stores/app";

const lessons = ref<any[]>([]);
const openId = ref("");
const detail = ref<Lesson | null>(null);
const versions = ref<Record<string, boolean>>({});
const days = computed(() => {
  const groups = new Map<string, any[]>();
  for (const lesson of lessons.value) {
    const list = groups.get(lesson.lessonDate) || [];
    list.push(lesson);
    groups.set(lesson.lessonDate, list);
  }
  return [...groups.entries()].map(([date, items]) => {
    const sorted = [...items].sort((a, b) => Number(b.active) - Number(a.active) || b.version - a.version);
    return { date, label: date.replace("-", "年").replace("-", "月") + "日", lessons: sorted, primary: sorted[0], rest: sorted.slice(1) };
  });
});
function stepLabel(step: string) {
  const names: Record<string, string> = { review: "复习", vocabulary: "新词", parts: "词根", listening: "听力", shadow: "跟读", recall: "回忆" };
  return names[step] || "还没有进度";
}
function progressWidth(lesson: { progress?: { completed?: string[] } }) {
  const done = lesson.progress?.completed?.length || 0;
  return `${Math.round(done / 6 * 100)}%`;
}
async function toggle(id: string) {
  if (openId.value === id) {
    openId.value = "";
    detail.value = null;
    return;
  }
  detail.value = await api<Lesson>(`/api/lessons/${id}`);
  openId.value = id;
}
onMounted(async () => {
  lessons.value = await api("/api/lessons");
});
</script>
