<template>
  <section class="rd review-study" aria-label="旧词复习">
    <header class="review-head"><span class="rd-kicker">ACTIVE RECALL</span><span v-if="remaining !== undefined" class="rd-note">剩余 {{ remaining }} 个词</span></header>
    <div class="review-focus">
      <p class="rd-note">先回忆含义，再试着用它说一句话。</p>
      <div class="review-word"><h2 class="rd-word" translate="no">{{ item.lemma }}</h2><button class="rd-icon" type="button" :aria-label="'朗读 '+item.lemma" @click="speak(item.lemma)"><Volume2 :size="20" aria-hidden="true" /></button></div>
      <p class="rd-meta">{{ item.pos }} <span v-if="item.ipa">· {{ item.ipa }}</span></p>
      <button v-if="!show" class="rd-pill primary reveal" type="button" @click="show = true">显示答案</button>
    </div>
    <div v-if="show" class="review-answer">
      <header class="review-head"><span class="rd-kicker">MEANING & USAGE</span><button class="rd-pill" type="button" @click="hideAnswer">隐藏答案</button></header>
      <h3 class="meaning">{{ item.meaningZh }}</h3>
      <div v-if="item.example" class="review-example"><p translate="no">{{ item.example }}</p><button class="rd-icon" type="button" aria-label="朗读例句" @click="speak(item.example)"><Volume2 :size="18" aria-hidden="true" /></button></div>
      <BlurText v-if="item.exampleZh" :text="item.exampleZh" :clear="translation" @toggle="translation = !translation" />
      <label class="recognize"><input v-model="recognizeOnly" type="checkbox" :disabled="ratingBusy" /> 我能认出这个词，但还不能主动使用。</label>
      <div class="grade-grid" role="group" aria-label="记忆评分">
        <button v-for="grade in grades" :key="grade.id" class="rd-pill rate grade" :class="'rate-'+grade.id" type="button" :disabled="ratingBusy" @click="rate(grade.id)"><strong>{{ grade.label }}</strong><small>{{ intervalLabel(item, grade.id) }}</small></button>
      </div>
      <p class="rd-note" role="status">{{ ratingBusy ? '正在保存…' : '根据真实记忆程度评分，系统会安排下次复习。' }}</p>
    </div>
    <p v-if="error" class="bad" role="alert">{{ error }}</p>
    <p v-if="speech.detail.value" class="rd-note" role="status">{{ speech.detail.value }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Volume2 } from "lucide-vue-next";
import { api } from "../api";
import { progressStamp, withReviewRequest } from "../lib/reviewRequest";
import { useStudySpeech } from "../composables/useStudySpeech";
import { intervalLabel, grades, type Grade } from "../lib/reviewPresentation";
import BlurText from "../preview/BlurText.vue";
import "../preview/reader.css";
const props = defineProps<{ item: any; remaining?: number }>();
const emit = defineEmits<{ done: [] }>();
const show = ref(false), translation = ref(false), recognizeOnly = ref(false), ratingBusy = ref(false), error = ref("");
const { speech, rate: speechRate } = useStudySpeech();
function hideAnswer() { show.value = false; translation.value = false; }
function speak(text: string) { if (text) void speech.play(text, speechRate.value, false); }
watch(() => props.item.id, () => { hideAnswer(); recognizeOnly.value = false; error.value = ""; speech.stop(); });
async function rate(rating: Grade) {
  if (ratingBusy.value || !show.value) return;
  ratingBusy.value = true; error.value = "";
  try {
    await withReviewRequest(`formal:${props.item.id}`, { rating, recallAbility: recognizeOnly.value ? "recognize" : "recall", progress: progressStamp(props.item) }, (body) =>
      api(`/api/review/${props.item.id}/rate`, { method: "POST", body: JSON.stringify(body) }));
    emit("done");
  } catch (err) { error.value = err instanceof Error ? err.message : "本次复习未保存，请重试。"; }
  finally { ratingBusy.value = false; }
}
</script>

<style scoped>
.review-study { max-width:760px; margin:0 auto; padding:8px 0; }
.review-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.review-focus { display:grid; justify-items:center; text-align:center; padding:26px 8px; gap:10px; }
.review-focus p { margin:0; }
.review-word { display:flex; align-items:center; justify-content:center; gap:12px; max-width:100%; }
.review-word .rd-word { margin:0; font-size:clamp(38px,6vw,64px); overflow-wrap:anywhere; min-width:0; }
.reveal { min-height:44px; min-width:160px; margin-top:10px; }
.review-answer { border-top:1px solid var(--line); padding-top:20px; display:grid; gap:14px; }
.meaning { margin:0; font-size:22px; color:var(--accent-text); }
.review-example { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px; border-radius:12px; background:var(--surface-muted); }
.review-example p { margin:0; font:clamp(20px,3vw,28px)/1.45 "DM Serif Display",Georgia,serif; overflow-wrap:anywhere; }
.recognize { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:14px; min-height:44px; }
.grade-grid .grade { min-height:60px; flex-direction:column; gap:3px; }
.grade small { font-size:12px; font-weight:400; }
.review-answer > .rd-note { text-align:center; margin:0; }
</style>
