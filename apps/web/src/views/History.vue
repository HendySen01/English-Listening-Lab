<template>
  <section class="stack">
    <article class="card" v-for="lesson in lessons" :key="lesson.id">
      <p class="home-kicker">
        <span class="badge">{{ lesson.active ? "当前版本" : `版本 ${lesson.version}` }}</span>
        <span>{{ lesson.lessonDate }} · {{ lesson.sourceLabel }}</span>
      </p>
      <h2>{{ lesson.listeningTitle || lesson.theme }}</h2>
      <p class="muted">{{ lesson.theme }} · {{ lesson.difficulty }} · {{ lesson.newWordCount }} 个词<template v-if="lesson.model"> · {{ lesson.model }}</template></p>
      <p class="muted" v-if="lesson.progress">进度步骤：{{ stepLabel(lesson.progress.step) }}</p>
      <div class="row">
        <router-link class="choice" :to="`/lesson/${lesson.id}`">词汇和进度</router-link>
        <router-link class="choice" :to="`/context?lesson=${lesson.id}`">语境</router-link>
        <router-link class="choice" :to="`/lesson/${lesson.id}`">听力材料</router-link>
      </div>
    </article>
    <p v-if="!lessons.length" class="muted">还没有历史课程。旧版本不会在这里被删除。</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
const lessons = ref<any[]>([]);
function stepLabel(step: string) {
  const names: Record<string, string> = { review: "复习", vocabulary: "新词", parts: "词根", listening: "听力", shadow: "跟读", recall: "回忆" };
  return names[step] || step || "未记录";
}
onMounted(async () => {
  lessons.value = await api("/api/lessons");
});
</script>
