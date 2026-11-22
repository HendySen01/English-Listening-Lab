<template>
  <div class="stack" style="margin-top: 16px">
    <h3>今天的 3 道题</h3>
    <article v-for="question in lesson.questions" :key="question.id" class="card">
      <p>{{ kindLabel(question.kind) }}</p>
      <p>{{ question.prompt }}</p>
      <div class="stack">
        <button
          v-for="(option, index) in question.options"
          :key="option"
          class="choice"
          :class="{ active: question.selected === index }"
          :disabled="question.answered"
          @click="answer(question.id, index)"
        >
          {{ option }}
        </button>
      </div>
      <div v-if="question.answered" class="stack" style="margin-top: 10px">
        <p :class="question.correct ? 'ok' : 'bad'">{{ question.correct ? "答对了" : "这题不一致" }}</p>
        <p>正确答案：{{ question.options[question.answerIndex || 0] }}</p>
        <p>{{ question.explanationEn }}</p>
        <p>{{ question.explanationZh }}</p>
        <p class="muted">原文：{{ question.evidence }}</p>
        <p v-for="(reason, index) in question.whyWrong || []" :key="index" v-show="reason" class="muted">{{ reason }}</p>
        <button class="text-button" @click="simpler(question.id)">我仍然不理解</button>
        <p v-if="notes[question.id]">{{ notes[question.id] }}</p>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";
import { api } from "../api";
import type { Lesson } from "../stores/app";

const props = defineProps<{ lesson: Lesson }>();
const emit = defineEmits<{ changed: [] }>();
const notes = reactive<Record<string, string>>({});

function kindLabel(kind: string) {
  if (kind === "context") return "词汇语境";
  if (kind === "sentence") return "句子意思";
  return "听力大意";
}

async function answer(id: string, selected: number) {
  await api(`/api/quiz/${id}/answer`, { method: "POST", body: JSON.stringify({ selected }) });
  emit("changed");
}

async function simpler(id: string) {
  try {
    const result = await api<{ mode: string; text: string }>(`/api/quiz/${id}/simpler`, {
      method: "POST",
      body: JSON.stringify({ confirmCost: false }),
    });
    notes[id] = result.mode === "ai" ? result.text : `更短的解释：${result.text}`;
  } catch (error) {
    const text = error instanceof Error ? error.message : "暂时不能换说法";
    if (!text.includes("费用") || !confirm(text)) {
      notes[id] = text;
      return;
    }
    const result = await api<{ text: string }>(`/api/quiz/${id}/simpler`, {
      method: "POST",
      body: JSON.stringify({ confirmCost: true }),
    });
    notes[id] = result.text;
  }
}
</script>
