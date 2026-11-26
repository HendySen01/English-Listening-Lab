<template>
  <article class="card stack">
    <h3>跟读 · 建议 5 分钟</h3>
    <p class="muted">先听一句，再自己读。这里只记录你是否跟上，不会编造发音分数。</p>
    <p class="word" style="font-size: 28px">{{ plain }}</p>
    <div class="row">
      <button class="choice active" @click="speech.play(plain, rate)">播放这一句</button>
      <SpeechRateControl />
      <button class="choice" @click="mark('followed')">跟上了</button>
      <button class="choice" @click="mark('missed')">没跟上</button>
    </div>
    <p v-if="rateError" class="bad" role="status">{{ rateError }}</p>
    <p class="audio-state">{{ speech.status.value }} · {{ speech.sourceLabel.value }} {{ speech.detail.value }}</p>
    <p>第 {{ index + 1 }} / {{ lines.length }} 句</p>
    <button class="choice" v-if="done" @click="emit('save', { ...lesson.progress, step: 'recall' })">去做回忆和测验</button>
  </article>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import SpeechRateControl from "./SpeechRateControl.vue";
import { useStudySpeech } from "../composables/useStudySpeech";
import type { Lesson, Progress } from "../stores/app";

const props = defineProps<{ lesson: Lesson }>();
const emit = defineEmits<{ save: [progress?: Progress] }>();
const { speech, rate, rateError } = useStudySpeech();
const lines = computed(() => props.lesson.listening.chunks.map((line) => line.replace(/\s*\/\s*/g, " ")));
const index = computed(() => props.lesson.progress.shadow.index || 0);
const plain = computed(() => lines.value[index.value] || "");
const done = computed(() => index.value >= lines.value.length - 1 && props.lesson.progress.shadow.marks[index.value]);

watch(plain, () => speech.stop());

function mark(value: string) {
  const marks = [...props.lesson.progress.shadow.marks];
  marks[index.value] = value;
  const nextIndex = Math.min(lines.value.length - 1, index.value + (index.value < lines.value.length - 1 ? 1 : 0));
  emit("save", { ...props.lesson.progress, shadow: { index: nextIndex, marks } });
}
</script>
