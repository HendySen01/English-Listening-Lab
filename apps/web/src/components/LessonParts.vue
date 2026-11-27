<template>
  <section class="rd parts-study">
    <header class="parts-head"><div><p class="rd-kicker">WORD FORMATION</p><h3>词源与构词</h3><p class="rd-note">理解词的构成，再回到原句。</p></div><span v-if="word" class="rd-note">{{ index + 1 }} / {{ words.length }}</span></header>
    <template v-if="word">
      <div class="rd-segment parts-tabs" role="group" aria-label="选择单词"><button v-for="(item,i) in words" :key="item.id" class="rd-pill" type="button" :aria-pressed="i === index" @click="index = i">{{ item.lemma }}</button></div>
      <div class="rd-frame rd-workspace parts-grid">
        <div class="rd-read parts-left">
          <div class="rd-meta"><h2 class="rd-word" translate="no">{{ word.lemma }}</h2><button class="rd-icon" type="button" :aria-label="'朗读 '+word.lemma" @click="speak(word.lemma)"><Volume2 :size="18" aria-hidden="true" /></button></div>
          <p class="rd-meta">{{ word.pos }} <span v-if="word.ipa">· {{ word.ipa }}</span></p>
          <p class="rd-copy">{{ word.meaningZh }}</p>
          <section v-if="formation" class="parts-structure">
            <p class="rd-kicker">现代构词 · STRUCTURE</p>
            <WordFormation :word="word.lemma" :formation="formation" />
          </section>
          <section><p class="rd-kicker">原始学习例句</p><p class="rd-sentence" translate="no">{{ word.example }}</p><BlurText v-if="word.exampleZh" :text="word.exampleZh" :clear="clear" @toggle="clear = !clear" /></section>
        </div>
        <ReaderNotes :key="word.id" :word="word.lemma" :analysis="analysis" :source="source" :loading="loading" :error="error" :summary="summary" mark="" hide-marks initially-expanded formation-shown @speak="speak" @explain="explain" />
      </div>
      <p class="rd-note">现代构词不等于历史词源。已有解析会读取原句缓存；缺少时可主动解析。</p>
      <div class="parts-footer"><button class="rd-pill" :disabled="index===0" @click="index--">上一个</button><button class="rd-pill primary" @click="advance">{{ index < words.length - 1 ? '下一个词' : '进入听力' }}</button></div>
    </template>
    <template v-else><p class="rd-note">今天没有足够明确的构词练习，不强行拆分。</p><button class="rd-pill primary" @click="emit('next')">进入听力</button></template>
  </section>
</template>
<script setup lang="ts">
import { computed,ref,watch } from "vue";
import { Volume2 } from "lucide-vue-next";
import type { Word } from "../stores/app";
import ReaderNotes from "../preview/ReaderNotes.vue";
import WordFormation from "./WordFormation.vue";
import { legacyWordFormation } from "../lib/wordFormation";
import BlurText from "../preview/BlurText.vue";
import { useExplanation } from "../preview/explain";
import { useStudySpeech } from "../composables/useStudySpeech";
import "../preview/reader.css";
const props=defineProps<{words:Word[];lessonId:string}>();
const emit=defineEmits<{next:[]}>();
const index=ref(0),clear=ref(false);
const word=computed(()=>props.words[index.value]);
const {speech,rate}=useStudySpeech();
const passageId=computed(()=>word.value ? `lesson:${props.lessonId}:word:${word.value.id}` : "");
const lemma=computed(()=>word.value?.lemma || "");
const sentence=computed(()=>word.value?.example || "");
const {analysis,source,loading,error,explain}=useExplanation(passageId,lemma,sentence);
const summary=computed(()=>word.value ? {pronunciation:word.value.ipa||"",partOfSpeech:word.value.pos,definition:word.value.meaningZh,usage:"通过深度解析查看这个词在原句中的用法。"}:undefined);
const formation = computed(() => word.value
  ? analysis.value?.wordFormation ?? legacyWordFormation(word.value.lemma, word.value.morphology, word.value.definitionEn)
  : null);
watch(()=>props.words.length,n=>{index.value=Math.max(0,Math.min(index.value,n-1))});
watch(passageId,()=>{clear.value=false;speech.stop()});
function speak(text:string){if(text)void speech.play(text,rate.value,false)}
function advance(){if(index.value<props.words.length-1)index.value++;else emit("next")}
</script>
<style scoped>
.parts-head {display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}
.parts-head h3{margin:4px 0;font-size:22px}.parts-head p{margin:0}.parts-tabs{margin-bottom:16px;flex-wrap:wrap}
.parts-left{display:flex;flex-direction:column;gap:12px}.parts-left .rd-word{margin:0;font-size:clamp(34px,5vw,52px);overflow-wrap:anywhere}.parts-left p{margin:0}
.parts-structure{background:var(--surface-muted);border-radius:12px;padding:16px;display:grid;gap:12px}
.parts-left .rd-sentence{font-size:clamp(22px,3vw,30px);margin:10px 0}.parts-footer{display:flex;justify-content:space-between;gap:12px;margin-top:16px}
@media(max-width:900px){.parts-grid{display:block}.parts-grid :deep(.rd-notes){border-left:0;border-top:1px solid var(--line)}}
</style>
