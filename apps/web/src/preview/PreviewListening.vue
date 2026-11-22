<template>
  <section class="rd">
    <p class="rd-kicker">听力 · {{ lesson.title }}</p>
    <div class="rd-stages" role="tablist" aria-label="听力阶段">
      <button v-for="(label, stageIndex) in stages" :key="label" class="rd-pill" type="button" :aria-pressed="stage === stageIndex" @click="stage = stageIndex">{{ label }}</button>
    </div>
    <div class="rd-tools" style="margin-bottom: 12px">
      <button class="rd-play" type="button" @click="toggle">{{ playing ? "暂停" : "播放" }}</button>
      <button class="rd-pill" type="button" @click="replay">重播</button>
      <button v-for="item in previewRates" :key="item" class="rd-pill" type="button" :aria-pressed="rate === item" @click="setRate(item)">{{ item }}×</button>
      <span class="rd-source">{{ voice }} · 第 {{ current + 1 }} 句 · 浏览器语音</span>
    </div>
    <p v-if="stage === 0" class="rd-note">盲听不显示原文，也不显示中文。写下的大意会留在这里。</p>
    <label v-if="stage === 0" class="rd-note">这段话大概在说什么？
      <textarea v-model="gist" class="rd-field" rows="3"></textarea>
    </label>

    <div v-if="stage === 1 || stage === 2" class="rd-frame">
      <div class="rd-read">
        <div class="rd-tools">
          <button class="rd-pill" type="button" :aria-pressed="showAll" @click="showAll = !showAll">{{ showAll ? "隐藏整篇翻译" : "显示整篇翻译" }}</button>
          <span class="rd-source">切换阶段不会自动揭开中文。</span>
        </div>
        <p v-for="(item, sentenceIndex) in listeningPassages" :key="item.id" class="rd-sentence" style="font-size: 28px; margin: 18px 0" translate="no">
          <button class="rd-icon" type="button" :aria-label="`朗读第 ${sentenceIndex + 1} 句`" @click="playSentence(sentenceIndex)"><Volume2 aria-hidden="true" :size="16" /></button>
          <template v-for="(token, tokenIndex) in tokenize(item.sentence)" :key="tokenIndex">
            <button v-if="token.key" class="rd-token" type="button" :aria-pressed="current === sentenceIndex && selected === token.key" @click="choose(sentenceIndex, token.key)">{{ token.text }}</button>
            <span v-else>{{ token.text }}</span>
          </template>
        </p>
        <BlurText :text="listeningPassages[current].translation" :clear="showAll || revealed.has(listeningPassages[current].id)" @toggle="toggleCurrent" />
      </div>
      <ReaderNotes :key="listeningPassages[current].id + selected" :word="selected" :analysis="analysis" :source="source" :loading="loading" :error="error" :mark="marks[cacheKey(listeningPassages[current].id, selected)] || ''" @speak="speakEnglish($event, rate, note)" @mark="setMark" @explain="explain" />
    </div>

    <div v-if="stage === 3" class="rd-box">
      <p class="rd-copy">用中文或简单英文写下主要意思。原文先不展开。</p>
      <textarea v-model="recall" class="rd-field" rows="4"></textarea>
      <button class="rd-pill primary" style="margin-top: 8px" type="button" @click="checkRecall">对照原文</button>
      <p v-if="recallNote" class="rd-status" role="status">{{ recallNote }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"
import { Volume2 } from "lucide-vue-next"
import BlurText from "./BlurText.vue"
import ReaderNotes from "./ReaderNotes.vue"
import { useExplanation } from "./explain"
import { cacheKey, listeningPassages, tokenize } from "./reader-data"
import { previewLesson } from "./sample"
import { choosePreviewRate, previewRate, previewRates, speakEnglish, stopEnglish } from "./speech"
import "./reader.css"

const lesson = previewLesson
const stages = ["1 盲听", "2 原文", "3 再听", "4 回忆"]
const stage = ref(0)
const current = ref(0)
const selected = ref("")
const rate = previewRate
const playing = ref(false)
const voice = ref("尚未播放")
const gist = ref("")
const recall = ref("")
const recallNote = ref("")
const showAll = ref(false)
const revealed = ref(new Set<string>())
const marks = ref<Record<string, "known" | "again">>({})
const passageId = computed(() => listeningPassages[current.value].id)
const sentence = computed(() => listeningPassages[current.value].sentence)
const { analysis, source, loading, error, explain } = useExplanation(passageId, selected, sentence)
let playToken = 0

function note(message: string) {
  voice.value = message
  playing.value = message.startsWith("浏览器语音") && !message.includes("用时")
}
function setRate(next: number) {
  const wasPlaying = playing.value
  choosePreviewRate(next)
  if (!wasPlaying) return
  playToken += 1
  void speakEnglish(listeningPassages[current.value].sentence, next, note)
}
function choose(sentenceIndex: number, word: string) {
  current.value = sentenceIndex
  selected.value = word
}
function toggleCurrent() {
  const id = listeningPassages[current.value].id
  const next = new Set(revealed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  revealed.value = next
  showAll.value = false
}
function setMark(value: "known" | "again") {
  if (!selected.value) return
  marks.value = { ...marks.value, [cacheKey(listeningPassages[current.value].id, selected.value)]: value }
}
function playSentence(index: number) {
  current.value = index
  speakEnglish(listeningPassages[index].sentence, rate.value, note)
}
function playAll(from = 0) {
  const token = ++playToken
  const step = (index: number) => {
    if (token !== playToken) return
    current.value = index
    void speakEnglish(listeningPassages[index].sentence, rate.value, (message) => {
      note(message)
      if (message.includes("用时") && token === playToken && index + 1 < listeningPassages.length) step(index + 1)
    })
  }
  step(from)
}
function toggle() {
  if (playing.value) {
    playToken += 1
    stopEnglish()
    playing.value = false
    voice.value = "已暂停"
    return
  }
  playAll(current.value)
}
function replay() {
  playToken += 1
  stopEnglish()
  playAll(0)
}
function checkRecall() {
  const text = recall.value.trim()
  recallNote.value = !text
    ? "先写一句大意，再对照。"
    : /bus|公交|schedule|日程|appointment|预约/i.test(text)
      ? "提到了等车或日程。这是本地关键词对照，不是 AI 评分。"
      : "可以补一句：他在等车，还看了日程。这是本地对照，不是 AI 评分。"
}
onBeforeUnmount(() => stopEnglish())
</script>
