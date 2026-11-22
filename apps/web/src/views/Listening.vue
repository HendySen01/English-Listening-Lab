<template>
  <ListeningPanel v-if="lesson" :lesson="lesson" :rate="rate" @save="save" />
  <p v-else-if="error" class="bad">{{ error }}</p>
  <p v-else>正在准备听力……</p>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { useAppStore, type Lesson, type Progress } from "../stores/app";
import ListeningPanel from "../components/ListeningPanel.vue";

const store = useAppStore();
const lesson = ref<Lesson | null>(null);
const error = ref("");
const rate = computed(() => store.dashboard?.settings.speechRate || 1);

async function save(progress?: Progress) {
  if (!lesson.value) return;
  lesson.value = await api(`/api/lessons/${lesson.value.id}/progress`, {
    method: "PATCH",
    body: JSON.stringify({ progress: progress || lesson.value.progress }),
  });
}

onMounted(async () => {
  try {
    if (!store.dashboard) await store.load();
    const id = store.dashboard?.lesson?.id;
    lesson.value = id ? await api(`/api/lessons/${id}`) : await api("/api/lessons/today", { method: "POST" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "听力加载失败";
  }
});
</script>
