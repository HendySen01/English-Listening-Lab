<template>
  <article class="card stack">
    <h3>听力 · 建议 20 分钟</h3>
    <p class="muted">先听，不看原文。离线课是慢速短句；配置 AI 后才会按学习天数生成更完整的短文。</p>
    <div class="steps">
      <button class="step" :class="{ current: lesson.progress.listening.round === 1 }" @click="setRound(1)">1 盲听</button>
      <button class="step" :class="{ current: lesson.progress.listening.round === 2 }" @click="setRound(2)">2 原文</button>
      <button class="step" :class="{ current: lesson.progress.listening.round === 3 }" @click="setRound(3)">3 再听</button>
      <button class="step" :class="{ current: lesson.progress.listening.round === 4 }" @click="setRound(4)">4 复述</button>
    </div>
    <div class="row">
      <button class="choice active" @click="speech.play(currentText, rate)">播放</button>
      <button class="choice" @click="speech.play(currentText, Math.max(0.8, rate - 0.2))">慢一点</button>
      <button class="choice" @click="speech.pause">暂停</button>
      <button class="choice" @click="speech.resume">继续</button>
      <button class="choice" @click="speech.stop">停止</button>
    </div>
    <p class="audio-state">状态：{{ speech.status.value }} · {{ speech.sourceLabel.value }} {{ speech.detail.value }}</p>

    <div v-if="lesson.progress.listening.round === 1">
      <p>这段话大概在说什么？用几个词写下来即可。</p>
      <textarea class="plain-input" rows="3" v-model="lesson.progress.listening.firstGist" @change="emit('save')"></textarea>
    </div>
    <div v-else-if="lesson.progress.listening.round === 2" class="stack">
      <p v-for="(chunk, index) in lesson.listening.chunks" :key="chunk">
        <button class="choice" @click="speech.play(plain(chunk), rate)">这一句</button>
        <button v-for="token in tokens(chunk)" :key="token + index" class="token" :class="{ known: gloss(token) }" @click="selected = gloss(token) || '这节课没有这个词的释义，不会自动展开新词。'">
          {{ token }}
        </button>
      </p>
      <p class="popover" v-if="selected">{{ selected }}</p>
      <button class="text-button" @click="chinese = !chinese">{{ chinese ? "隐藏中文提示" : "需要时查看大意" }}</button>
      <p v-if="chinese" class="muted">中文大意只作核对。请先根据英文判断。</p>
    </div>
    <div v-else-if="lesson.progress.listening.round === 3">
      <p>原文已隐藏。再听一次，写下现在理解到的内容。</p>
      <textarea class="plain-input" rows="3" v-model="lesson.progress.listening.thirdGist" @change="emit('save')"></textarea>
      <p v-if="lesson.progress.listening.firstGist" class="muted">第一次你写下：{{ lesson.progress.listening.firstGist }}</p>
    </div>
    <div v-else class="stack">
      <p>不看原文，用简单英文或中文说出主要内容。不要求逐字背诵。</p>
      <textarea class="plain-input" rows="4" v-model="lesson.progress.listening.recall"></textarea>
      <button class="choice active" @click="check">检查大意</button>
      <p v-if="lesson.progress.listening.recallNote">{{ lesson.progress.listening.recallNote }}</p>
      <button class="choice" @click="emit('save', { ...lesson.progress, step: 'shadow' })">去跟读</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import { useSpeech } from "../composables/useSpeech";
import type { Lesson, Progress } from "../stores/app";

const props = defineProps<{ lesson: Lesson; rate: number }>();
const emit = defineEmits<{ save: [progress?: Progress] }>();
const speech = useSpeech();
const selected = ref("");
const chinese = ref(false);
const currentText = computed(() =>
  props.lesson.progress.listening.round === 2
    ? plain(props.lesson.listening.chunks[0] || props.lesson.listening.text)
    : props.lesson.listening.text,
);

function plain(text: string) {
  return text.replace(/\s*\/\s*/g, " ");
}
function tokens(text: string) {
  return text.split(/(\s+|\/)/).filter((item) => item.trim() && item !== "/");
}
function gloss(token: string) {
  const key = token.toLowerCase().replace(/[^a-z'-]/g, "");
  return props.lesson.listening.gloss[key] || "";
}
function setRound(round: number) {
  props.lesson.progress.listening.round = round;
  emit("save");
}
async function check() {
  const result = await api<{ mode: string; note: string }>(`/api/lessons/${props.lesson.id}/recall`, {
    method: "POST",
    body: JSON.stringify({ text: props.lesson.progress.listening.recall }),
  });
  props.lesson.progress.listening.recallMode = result.mode;
  props.lesson.progress.listening.recallNote = result.note;
  emit("save");
}
</script>
