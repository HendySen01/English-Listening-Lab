<template>
  <section class="stack">
    <div class="card row">
      <input class="plain-input" v-model="query" placeholder="搜索单词或中文" />
    </div>
    <article class="card" v-for="word in filtered" :key="word.id">
      <div class="row" style="justify-content: space-between">
        <strong>{{ word.lemma }}</strong>
        <span class="muted">{{ word.meaningZh }} · {{ word.familiarity }} · 复习 {{ word.reps }} 次</span>
      </div>
      <p>{{ word.example }}</p>
    </article>
    <p v-if="!filtered.length" class="muted">词库还是空的。先完成今天的课。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";

const words = ref<any[]>([]);
const query = ref("");
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return words.value;
  return words.value.filter((word) => word.lemma.toLowerCase().includes(q) || word.meaningZh.includes(query.value.trim()));
});
onMounted(async () => {
  words.value = await api("/api/library");
});
</script>
