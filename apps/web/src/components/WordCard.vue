<template>
  <article class="word-sheet">
    <header>
      <p class="pos">{{ word.pos }}</p>
      <h2 class="word" translate="no">{{ word.lemma }}</h2>
      <p class="meaning">{{ word.meaningZh }}</p>
      <div class="row">
        <button class="play compact" @click="speech.play(word.lemma, rate)">读这个词</button>
        <p v-if="word.ipa" class="ipa" translate="no">{{ word.ipa }}</p>
      </div>
      <p v-if="word.stress" class="muted">{{ word.stress }}</p>
      <p v-if="!word.ipa" class="fine">没有可靠音标，所以不编造。发音按钮仍然可用。</p>
    </header>
    <section>
      <p>{{ word.definitionEn }}</p>
      <p class="example" translate="no">{{ word.example }}</p>
      <p class="muted">{{ word.exampleZh }}</p>
      <p>搭配：{{ word.collocation }}</p>
      <button class="choice" @click="speech.play(word.example, rate)">读例句</button>
    </section>
    <details v-if="word.morphology">
      <summary>查看词根词缀</summary>
      <p>{{ word.morphology.prefix || "无前缀" }} + {{ word.morphology.root }} + {{ word.morphology.suffix || "无后缀" }}</p>
      <p>{{ word.morphology.meaningZh }}</p>
    </details>
    <div class="row">
      <button class="choice" :disabled="busy" @click="easier">{{ busy ? "正在改写…" : "AI 简化例句" }}</button>
      <button class="choice" @click="known">我已认识</button>
      <button class="choice" @click="strengthen">需要加强</button>
    </div>
    <p class="audio-state">{{ voiceLabel }}</p>
    <p v-if="message" :class="failed ? 'bad' : 'ok'">{{ message }}</p>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import { useSpeech } from "../composables/useSpeech";
import type { Word } from "../stores/app";

const props = defineProps<{ word: Word; rate: number }>();
const emit = defineEmits<{ changed: [] }>();
const speech = useSpeech();
const message = ref("");
const failed = ref(false);
const busy = ref(false);
const voiceLabel = computed(() => speech.sourceLabel.value.replace("当前语音：", "") || "尚未播放");

async function easier() {
  message.value = "";
  failed.value = false;
  if (!confirm("AI 会把例句改得更短，并保留这个单词。这次可能产生少量费用。继续吗？")) return;
  busy.value = true;
  try {
    const result = await api<{ example: string; exampleZh: string; source: string }>(`/api/vocabulary/${props.word.id}/easier`, {
      method: "POST",
      body: JSON.stringify({ confirmCost: true }),
    });
    message.value = result.source === "ai" ? "例句已经改短，并保留了这个单词。" : "已换成更短的例句。";
    emit("changed");
  } catch (error) {
    failed.value = true;
    message.value = error instanceof Error ? error.message : "例句没有改成，原来的句子还在。";
  } finally {
    busy.value = false;
  }
}

async function known() {
  await api(`/api/vocabulary/${props.word.id}/known`, { method: "POST" });
  message.value = "已记为认识。后面的新课不会再把它当新词。";
  emit("changed");
}

async function strengthen() {
  await api(`/api/review/${props.word.id}/rate`, {
    method: "POST",
    body: JSON.stringify({ rating: "hard", recallAbility: "recognize" }),
  });
  message.value = "已记为需要加强，复习会来得更早。";
  emit("changed");
}
</script>
