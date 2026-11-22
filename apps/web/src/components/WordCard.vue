<template>
  <div class="stack">
    <div class="row" style="justify-content: space-between">
      <h2 class="word">{{ word.lemma }}</h2>
      <span class="muted">{{ word.pos }}</span>
    </div>
    <p v-if="word.ipa">{{ word.ipa }} <span class="muted">{{ word.ipaNote }}</span></p>
    <p v-else class="muted">音标没有经过词典核对，所以不显示。</p>
    <p v-if="word.stress">{{ word.stress }}</p>
    <div class="row">
      <button class="choice" @click="speech.play(word.lemma, rate)">读单词</button>
      <button class="choice" @click="speech.play(word.example, rate)">读例句</button>
      <button class="choice" @click="speech.pause">暂停</button>
      <button class="choice" @click="speech.resume">继续</button>
      <button class="choice" @click="show = !show">{{ show ? "隐藏意思" : "查看意思" }}</button>
    </div>
    <p class="audio-state">{{ speech.status.value }} · {{ speech.sourceLabel.value }} {{ speech.detail.value }}</p>
    <template v-if="show">
      <p>{{ word.meaningZh }}</p>
      <p>{{ word.definitionEn }}</p>
      <p>搭配：{{ word.collocation }}</p>
      <p>{{ word.example }}</p>
      <p class="muted">{{ word.exampleZh }}</p>
    </template>
    <div class="row">
      <button class="choice" @click="easier">例句太难</button>
      <button class="choice" @click="known">我已经认识</button>
    </div>
    <p v-if="message">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import { useSpeech } from "../composables/useSpeech";
import type { Word } from "../stores/app";

const props = defineProps<{ word: Word; rate: number }>();
const emit = defineEmits<{ changed: [] }>();
const speech = useSpeech();
const show = ref(false);
const message = ref("");

async function easier() {
  message.value = "";
  try {
    const result = await api<{ example: string; exampleZh: string; source: string }>(`/api/vocabulary/${props.word.id}/easier`, {
      method: "POST",
      body: JSON.stringify({ confirmCost: false }),
    });
    message.value = result.source === "ai" ? "已用 AI 换成更短的例句。" : "已换成离线词库里更短的例句，没有调用 AI。";
    emit("changed");
  } catch (error) {
    const text = error instanceof Error ? error.message : "没有换成新例句";
    if (text.includes("费用")) {
      if (confirm(`${text} 确认调用吗？`)) {
        const result = await api<{ source: string }>(`/api/vocabulary/${props.word.id}/easier`, {
          method: "POST",
          body: JSON.stringify({ confirmCost: true }),
        });
        message.value = result.source === "ai" ? "已用 AI 换成更短的例句。" : "已更换例句。";
        emit("changed");
      }
      return;
    }
    message.value = text;
  }
}

async function known() {
  await api(`/api/vocabulary/${props.word.id}/known`, { method: "POST" });
  message.value = "已标为认识，并按“非常熟悉”排进复习，后面的新课不会再把它当新词。";
  emit("changed");
}
</script>
