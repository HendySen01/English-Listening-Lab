<template>
  <section class="rd">
    <p class="rd-kicker">{{ lesson.sourceLabel }} · {{ lesson.listening.title }}</p>
    <div class="rd-stages">
      <div class="rd-segment" role="tablist" aria-label="听力阶段">
        <button v-for="(label, stageIndex) in stages" :key="label" class="rd-pill" type="button" :aria-pressed="stage === stageIndex" :disabled="feedbackBusy || saving || translationBusy" @click="setStage(stageIndex)">{{ label }}</button>
      </div>
    </div>
    <div class="rd-tools" style="margin-bottom: 12px">
      <button class="rd-pill primary" type="button" @click="toggle">{{ speech.status.value === "播放中" ? "暂停" : speech.status.value === "已暂停" ? "继续" : "播放" }}</button>
      <button class="rd-pill" type="button" @click="replay">重播</button>
      <button v-if="onlineAvailable" class="rd-pill" type="button" :disabled="speech.status.value === '准备'" @click="playOnline">在线朗读</button>
      <SpeechRateControl />
      <span class="rd-source" role="status">{{ speech.sourceLabel.value }} · {{ speech.status.value }}<template v-if="speech.detail.value"> · {{ speech.detail.value }}</template></span>
    </div>
    <p v-if="rateError" class="rd-note" role="status">{{ rateError }}</p>
    <ListeningGist v-if="stage === 0" :key="lesson.id" :lesson-id="lesson.id" :initial-answer="lesson.progress.listening.firstGist" :saving="saving" @saved="lesson.progress.listening.firstGist = $event" @busy="feedbackBusy = $event" @next="setStage(1)" />
    <div v-if="stage === 1 || stage === 2" class="rd-note listening-guide">{{ stage === 1 ? "对照原文，点击不熟悉的词；中文仅在需要时查看。" : "再听一遍，留意刚才没听出来的表达。可按需对照原文。" }}</div>
    <template v-if="stage === 1 || stage === 2">
      <div class="rd-frame rd-workspace">
        <div class="rd-read">
          <div v-for="(item, sentenceIndex) in passages" :key="item.id" class="transcript-sentence">
          <p class="rd-sentence" style="font-size: 28px" translate="no">
            <button class="rd-icon" type="button" :aria-label="`朗读第 ${sentenceIndex + 1} 句`" @click="playSentence(sentenceIndex)"><Volume2 aria-hidden="true" :size="16" /></button>
            <template v-for="(token, tokenIndex) in tokenize(item.sentence)" :key="tokenIndex">
              <button v-if="token.key" class="rd-token" type="button" :aria-pressed="selected === token.key" @click="selectWord(token.key,item.index)">{{ token.text }}</button>
              <span v-else>{{ token.text }}</span>
            </template>
          </p>
            <BlurText v-if="item.translation" :text="item.translation" :clear="Boolean(revealed[item.index])" @toggle="revealed[item.index] = !revealed[item.index]" />
          </div>
          <TranslationFill :missing="missing" :busy="translationBusy" :error="translationError" @complete="complete" />
        </div>
        <ReaderNotes column-scroll :key="selected" :word="selected" :analysis="analysis" :summary="summary" :source="source" :loading="loading" :error="error" mark="" @speak="(text) => speak(text)" @explain="explain" />
      </div>
    </template>
    <div v-if="stage === 1 || stage === 2" class="listening-next">
      <router-link v-if="stage===1" class="rd-pill" :to="{path:'/context',query:{lesson:lesson.id,from:lesson.progress.step==='listening'?'listening':'standalone-listening'}}">逐句语境阅读</router-link>
      <button class="rd-pill primary" :disabled="saving || translationBusy" @click="setStage(stage+1)">{{ stage===1 ? "原文已读，开始再听 →" : "再听结束，尝试回忆 →" }}</button>
    </div>
    <template v-if="stage === 3">
      <div class="rd-box">
        <p class="rd-copy">Without looking at the transcript, retell the main idea in your own words.</p>
        <p class="rd-note">试着用英文复述。此处保存自己的练习，不把关键词检查当成 AI 评分。</p>
        <textarea v-model="lesson.progress.listening.recall" class="rd-field" rows="4" lang="en" :disabled="saving" placeholder="Retell the passage in English…"></textarea>
        <button class="rd-pill" style="margin-top: 8px" type="button" :disabled="saving" @click="showReference = !showReference">{{ showReference ? "隐藏原文" : "对照原文" }}</button>
        <div v-if="showReference" class="recall-reference"><p v-for="item in passages" :key="item.id" lang="en" translate="no">{{ item.sentence }}</p></div>
        <div class="listening-next"><button class="rd-pill primary" :disabled="saving || !String(lesson.progress.listening.recall || '').trim()" @click="emit('next')">保存英文回忆，进入跟读 →</button><button class="rd-pill" :disabled="saving" @click="emit('next')">暂时跳过回忆</button></div>
      </div>

    </template>
  </section>
</template>

<script setup lang="ts">
import SpeechRateControl from "./SpeechRateControl.vue"
import ListeningGist from "./ListeningGist.vue"
import { computed, onMounted, ref, toRef, watch } from "vue"
import BlurText from "../preview/BlurText.vue"
import TranslationFill from "./TranslationFill.vue"
import { useLessonTranslations } from "../composables/useLessonTranslations"
import { Volume2 } from "lucide-vue-next"
import ReaderNotes from "../preview/ReaderNotes.vue"
import { useExplanation } from "../preview/explain"
import { tokenize } from "../preview/reader-data"
import { useStudySpeech } from "../composables/useStudySpeech"
import { api } from "../api"
import type { Lesson, Progress } from "../stores/app"
import "../preview/reader.css"

const props = defineProps<{ lesson: Lesson; saving?: boolean }>()
const emit = defineEmits<{ save: [progress?: Progress]; next: []; busy:[value:boolean] }>()
const showReference=ref(false)
const stages = ["1 盲听", "2 原文", "3 再听", "4 回忆"]
// Render only the last acknowledged stage; an in-flight PATCH cannot expose an editable next stage.
const stage = computed(() => Math.max(0, Math.min(3, (props.lesson.progress.listening.round || 1) - 1)))
const selected = ref("")
const selectedIndex=ref(-1),revealed=ref<Record<number,boolean>>({})
const {rows,missing,busy:translationBusy,error:translationError,complete}=useLessonTranslations(toRef(props,"lesson"))
function selectWord(word:string,index:number){selectedIndex.value=index;selected.value=word}
const feedbackBusy = ref(false)
watch([feedbackBusy,translationBusy],()=>emit("busy",feedbackBusy.value||translationBusy.value))
const { speech, rate, rateError } = useStudySpeech()
watch(stage, () => {
  showReference.value=false; revealed.value={}; selected.value=""; selectedIndex.value=-1
  speech.stop()
})
const onlineAvailable = ref(false)
onMounted(async () => {
  const services = await api<{ ttsUsable?: boolean }>("/api/system").catch(() => null)
  onlineAvailable.value = services?.ttsUsable === true
})

function playOnline() {
  const text = props.lesson.listening.text
  if (!speech.hasOnlineClip(text) && !confirm("在线朗读会发送本节课的听力原文到语音服务，并可能产生费用。继续吗？")) return
  void speech.play(text, rate.value, true)
}
const passages=computed(()=>rows.value.map(row=>({...row,id:`${props.lesson.id}:chunk:${row.index}`})))
const matched = computed(() => props.lesson.words.find((word) => word.lemma.toLowerCase() === selected.value) || null)
const passageId = computed(() => matched.value ? `lesson:${props.lesson.id}:word:${matched.value.id}` : props.lesson.listening.chunks.some(x=>x.trim()) ? `${props.lesson.id}:chunk:${selectedIndex.value}` : `${props.lesson.id}:listen`)
const lemma = computed(() => selected.value)
const sentence = computed(() => passages.value.find(item=>item.index===selectedIndex.value)?.sentence || "")
const { analysis, source, loading, error, explain } = useExplanation(passageId, lemma, sentence)
const summary = computed(() => {
  if (!matched.value || analysis.value) return undefined
  return {
    pronunciation: matched.value.ipa || "",
    partOfSpeech: matched.value.pos,
    definition: matched.value.meaningZh,
    usage: matched.value.definitionEn || "这节课收录了这个词。",
  }
})

function setStage(next: number) {
  if (feedbackBusy.value || props.saving || translationBusy.value || next === stage.value) return
  // Send an immutable next progress value. The parent replaces the lesson only after a successful response.
  emit("save", { ...props.lesson.progress, listening: { ...props.lesson.progress.listening, round: next + 1 } })
}
async function speak(text: string) {
  speech.stop()
  await speech.play(text, rate.value, false)
}
function toggle() {
  if (speech.status.value === "播放中") speech.pause()
  else if (speech.status.value === "已暂停") speech.resume()
  else void speak(props.lesson.listening.text)
}
function replay() {
  void speech.replay(props.lesson.listening.text, rate.value)
}
function playSentence(index: number) {
  void speak(passages.value[index].sentence)
}
</script>

<style scoped>
.listening-next{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin:16px 0}.listening-guide{margin:14px 0}.recall-reference{background:var(--surface-muted);padding:12px;border-radius:12px;line-height:1.6}
.transcript-sentence{padding:12px 0;border-bottom:1px solid var(--line)}.transcript-sentence .rd-sentence{margin:0 0 10px}
</style>
