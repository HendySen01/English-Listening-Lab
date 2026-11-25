<template>
  <section class="rd">
    <p class="rd-kicker">{{ lesson.sourceLabel }} · {{ lesson.listening.title }}</p>
    <div class="rd-stages">
      <div class="rd-segment" role="tablist" aria-label="听力阶段">
        <button v-for="(label, stageIndex) in stages" :key="label" class="rd-pill" type="button" :aria-pressed="stage === stageIndex" @click="setStage(stageIndex)">{{ label }}</button>
      </div>
    </div>
    <div class="rd-tools" style="margin-bottom: 12px">
      <button class="rd-pill primary" type="button" @click="toggle">{{ speech.status.value === "播放中" ? "暂停" : speech.status.value === "已暂停" ? "继续" : "播放" }}</button>
      <button class="rd-pill" type="button" @click="replay">重播</button>
      <button v-if="onlineAvailable" class="rd-pill" type="button" :disabled="speech.status.value === '准备'" @click="playOnline">在线朗读</button>
      <span class="rd-segment" role="group" aria-label="语速">
        <button v-for="item in rates" :key="item" class="rd-pill" type="button" :aria-pressed="rate === item" :disabled="rateBusy" @click="setRate(item)">{{ item }}×</button>
      </span>
      <span class="rd-source" role="status">{{ speech.sourceLabel.value }} · {{ speech.status.value }}<template v-if="speech.detail.value"> · {{ speech.detail.value }}</template></span>
    </div>
    <p v-if="rateError" class="rd-note" role="status">{{ rateError }}</p>
    <label v-if="stage === 0" class="rd-note">这段话大概在说什么？
      <textarea v-model="lesson.progress.listening.firstGist" class="rd-field" rows="3" placeholder="用简体中文写一句大意" @change="emit('save')"></textarea>
    </label>
    <ExpandFold :open="stage === 1 || stage === 2" :limit="false">
      <div class="rd-frame rd-workspace">
        <div class="rd-read">
          <p v-for="(item, sentenceIndex) in passages" :key="item.id" class="rd-sentence" style="font-size: 28px" translate="no">
            <button class="rd-icon" type="button" :aria-label="`朗读第 ${sentenceIndex + 1} 句`" @click="playSentence(sentenceIndex)"><Volume2 aria-hidden="true" :size="16" /></button>
            <template v-for="(token, tokenIndex) in tokenize(item.sentence)" :key="tokenIndex">
              <button v-if="token.key" class="rd-token" type="button" :aria-pressed="selected === token.key" @click="selected = token.key">{{ token.text }}</button>
              <span v-else>{{ token.text }}</span>
            </template>
          </p>
          <p class="rd-source">这节课没有逐句中文，所以这里不显示翻译。</p>
        </div>
        <ReaderNotes column-scroll :key="selected" :word="selected" :analysis="analysis" :summary="summary" :source="source" :loading="loading" :error="error" mark="" @speak="(text) => speak(text)" @explain="explain" />
      </div>
    </ExpandFold>
    <ExpandFold :open="stage === 3" :limit="false">
      <div class="rd-box">
        <p class="rd-copy">先不看原文，写下主要意思。</p>
        <textarea v-model="lesson.progress.listening.recall" class="rd-field" rows="4" placeholder="用简体中文或简单英文写下大意"></textarea>
        <button class="rd-pill primary" style="margin-top: 8px" type="button" @click="checkRecall">对照原文</button>
        <p v-if="lesson.progress.listening.recallNote" class="rd-status" role="status">{{ lesson.progress.listening.recallNote }}</p>
      </div>
      <QuizBlock :lesson="lesson" @changed="emit('save')" />
    </ExpandFold>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Volume2 } from "lucide-vue-next"
import ExpandFold from "../preview/ExpandFold.vue"
import ReaderNotes from "../preview/ReaderNotes.vue"
import { useExplanation } from "../preview/explain"
import { tokenize } from "../preview/reader-data"
import { useStudySpeech } from "../composables/useStudySpeech"
import { api } from "../api"
import QuizBlock from "./QuizBlock.vue"
import type { Lesson, Progress } from "../stores/app"
import "../preview/reader.css"

const props = defineProps<{ lesson: Lesson }>()
const emit = defineEmits<{ save: [progress?: Progress] }>()
const stages = ["1 盲听", "2 原文", "3 再听", "4 回忆"]
const stage = ref(Math.max(0, Math.min(3, (props.lesson.progress.listening.round || 1) - 1)))
const selected = ref("")
const { speech, rate, rates, rateBusy, rateError, setRate } = useStudySpeech()
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
const passages = computed(() => {
  const chunks = props.lesson.listening.chunks.filter(Boolean)
  const source = chunks.length ? chunks : [props.lesson.listening.text]
  return source.map((sentence, index) => ({ id: `${props.lesson.id}:${index}`, sentence: sentence.replace(/\s*\/\s*/g, " ") }))
})
const matched = computed(() => props.lesson.words.find((word) => word.lemma.toLowerCase() === selected.value) || null)
const passageId = computed(() => matched.value ? `lesson:${props.lesson.id}:word:${matched.value.id}` : `${props.lesson.id}:listen`)
const lemma = computed(() => selected.value)
const sentence = computed(() => passages.value.find((item) => item.sentence.toLowerCase().includes(selected.value))?.sentence || props.lesson.listening.text)
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
  stage.value = next
  props.lesson.progress.listening.round = next + 1
  speech.stop()
  emit("save")
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
async function checkRecall() {
  const result = await api<{ mode: string; note: string }>(`/api/lessons/${props.lesson.id}/recall`, {
    method: "POST",
    body: JSON.stringify({ text: props.lesson.progress.listening.recall }),
  })
  props.lesson.progress.listening.recallMode = result.mode
  props.lesson.progress.listening.recallNote = result.note
  emit("save")
}
</script>
