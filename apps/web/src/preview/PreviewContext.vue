<template>
  <section class="rd">
    <p class="rd-kicker">Reading in context · 预览</p>
    <h1 class="rd-title">Words make sense <em>together.</em></h1>
    <p class="rd-note">英文保持清晰。整句中文默认模糊，悬停不会揭开。右侧会标明这是静态示范、AI 缓存，还是刚刚生成的解释。</p>
    <div class="rd-frame rd-workspace">
      <div class="rd-read">
        <div class="rd-tools">
          <button class="rd-pill" type="button" :disabled="index === 0" @click="move(-1)">上一句</button>
          <button class="rd-pill" type="button" :disabled="index === contextPassages.length - 1" @click="move(1)">下一句</button>
          <button class="rd-pill primary" type="button" @click="speakEnglish(passage.sentence, rate, (message) => voice = message)">朗读句子</button>
          <div class="rd-segment" role="group" aria-label="语速">
            <button v-for="item in previewRates" :key="item" class="rd-pill" type="button" :aria-pressed="rate === item" @click="setRate(item)">{{ item }}×</button>
          </div>
          <button class="rd-pill" type="button" :aria-pressed="showAll" @click="showAll = !showAll">{{ showAll ? "隐藏整篇翻译" : "显示整篇翻译" }}</button>
        </div>
        <p class="rd-sentence" translate="no">
          <template v-for="(token, tokenIndex) in tokens" :key="tokenIndex">
            <button v-if="token.key" class="rd-token" type="button" :aria-pressed="selected === token.key" @click="selected = token.key">{{ token.text }}</button>
            <span v-else>{{ token.text }}</span>
          </template>
        </p>
        <p class="rd-source">{{ voice }}</p>
        <BlurText :text="passage.translation" :clear="showAll || revealed.has(passage.id)" @toggle="toggleSentence" />
      </div>
      <ReaderNotes column-scroll :key="cacheKey(passage.id, selected)" :word="selected" :analysis="analysis" :source="source" :loading="loading" :error="error" :mark="marks[cacheKey(passage.id, selected)] || ''" @speak="speakEnglish($event, rate, (message) => voice = message)" @mark="setMark" @explain="explain" />
    </div>
    <p class="rd-note"><router-link class="rd-link" to="/preview/words-card">上一版单词卡片还在</router-link></p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import BlurText from "./BlurText.vue"
import ReaderNotes from "./ReaderNotes.vue"
import { useExplanation } from "./explain"
import { cacheKey, contextPassages, tokenize } from "./reader-data"
import { choosePreviewRate, previewRate, previewRates, speakEnglish } from "./speech"
import "./reader.css"

const index = ref(0)
const selected = ref("parking space")
const rate = previewRate
const voice = ref("尚未播放")
const showAll = ref(false)
const revealed = ref(new Set<string>())
const marks = ref<Record<string, "known" | "again">>({})
const passage = computed(() => contextPassages[index.value])
const tokens = computed(() => tokenize(passage.value.sentence, passage.value.phrases || []))
const passageId = computed(() => passage.value.id)
const sentence = computed(() => passage.value.sentence)
const { analysis, source, loading, error, explain } = useExplanation(passageId, selected, sentence)

function setRate(next: number) {
  const speaking = voice.value.startsWith("浏览器语音") && !voice.value.includes("用时")
  choosePreviewRate(next)
  if (speaking) void speakEnglish(passage.value.sentence, next, (message) => { voice.value = message })
}

function move(step: number) {
  index.value = Math.min(contextPassages.length - 1, Math.max(0, index.value + step))
  const id = contextPassages[index.value].id
  selected.value = id === "museum" ? "parking space" : "curious"
}

function toggleSentence() {
  const next = new Set(revealed.value)
  if (next.has(passage.value.id)) next.delete(passage.value.id)
  else next.add(passage.value.id)
  revealed.value = next
  showAll.value = false
}

function setMark(value: "known" | "again") {
  marks.value = { ...marks.value, [cacheKey(passage.value.id, selected.value)]: value }
}
</script>
