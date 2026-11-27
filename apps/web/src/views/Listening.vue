<template>
  <LessonListening v-if="lesson" :key="lesson.id" :lesson="lesson" :saving="saving" @save="save" @next="next" />
  <p v-if="error" class="bad" role="alert">{{ error }}</p>
  <p v-else-if="!lesson">正在准备听力……</p>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { nextProgress } from "../lib/learningFlow";
import { api } from "../api";
import { useAppStore, type Lesson, type Progress } from "../stores/app";
import LessonListening from "../components/LessonListening.vue";
import { useStudyClock } from "../composables/useStudyClock";

const store = useAppStore();
const lesson = ref<Lesson | null>(null);
useStudyClock("listening", () => lesson.value?.id || null);
const error = ref("");
const saving=ref(false),router=useRouter();

async function save(progress?: Progress) {
  if (!lesson.value || saving.value) return false;
  saving.value=true;error.value="";
  try{lesson.value=await api(`/api/lessons/${lesson.value.id}/progress`,{method:"PATCH",body:JSON.stringify({progress:progress||lesson.value.progress})});return true;}
  catch(err){error.value=err instanceof Error?err.message:"进度保存失败。";return false;}
  finally{saving.value=false;}
}

async function next(){if(!lesson.value)return;const current={...lesson.value.progress,step:"listening"};if(await save(nextProgress(current,"shadow",true)))await router.push(`/lesson/${lesson.value.id}`);}
onMounted(async () => {
  try {
    if (!store.dashboard) await store.load();
    const id = store.dashboard?.lesson?.id;
    if (!id) {
      error.value = "今天没有听力课程。";
      return;
    }
    lesson.value = await api(`/api/lessons/${id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "听力加载失败";
  }
});
</script>
