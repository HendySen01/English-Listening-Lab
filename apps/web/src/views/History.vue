<template>
  <section class="stack">
    <article class="card" v-for="lesson in lessons" :key="lesson.id">
      <router-link :to="`/lesson/${lesson.id}`">
        <strong>{{ lesson.lessonDate }}</strong>
        <span class="muted"> · {{ lesson.theme }} · {{ lesson.difficulty }} · {{ lesson.newWordCount }} 个词 · {{ lesson.sourceLabel }}<template v-if="lesson.model"> · {{ lesson.model }}</template></span>
      </router-link>
    </article>
    <p v-if="!lessons.length" class="muted">还没有历史课程。</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
const lessons = ref<any[]>([]);
onMounted(async () => {
  lessons.value = await api("/api/lessons");
});
</script>
