<template>
  <section class="rd">
    <p class="rd-kicker">Reading in context · 预览</p>
    <h1 class="rd-title">Words make sense <em>together.</em></h1>
    <p class="rd-note">英文保持清晰。整句中文默认模糊，悬停不会揭开。右边的词义是预览样本，不是这次的模型回复。</p>
    <div class="rd-frame">
      <div class="rd-read">
        <div class="rd-tools">
          <button class="rd-pill" type="button" :disabled="index === 0" @click="move(-1)">上一句</button>
          <button class="rd-pill" type="button" :disabled="index === contextPassages.length - 1" @click="move(1)">下一句</button>
          <button class="rd-pill leaf" type="button" @click="speakEnglish(passage.sentence, rate, (message) => voice = message)">朗读句子</button>
          <button class="rd-pill" type="button" :aria-pressed="rate === 0.7" @click="rate = rate === 0.7 ? 1 : 0.7">语速 {{ rate }}×</button>
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
      <ReaderNotes :key="cacheKey(passage.id, selected)" :word="selected" :analysis="analysis" :mark="marks[cacheKey(passage.id, selected)] || ''" @speak="speakEnglish($event, rate, (message) => voice = message)" @mark="setMark" />
    </div>
    <p class="rd-note"><router-link class="rd-link" to="/preview/words-card">上一版单词卡片还在</router-link></p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import BlurText from "./BlurText.vue"
import ReaderNotes from "./ReaderNotes.vue"
import { cacheKey, contextPassages, lookupAnalysis, speakEnglish, tokenize } from "./reader-data"
import "./reader.css"

const index = ref(0)
const selected = ref("parking space")
const rate = ref(1)
const voice = ref("尚未播放")
const showAll = ref(false)
const revealed = ref(new Set<string>())
const marks = ref<Record<string, "known" | "again">>({})
const passage = computed(() => contextPassages[index.value])
const tokens = computed(() => tokenize(passage.value.sentence, passage.value.phrases || []))
const analysis = computed(() => lookupAnalysis(passage.value.id, selected.value))

function move(step: number) {
  index.value = Math.min(contextPassages.length - 1, Math.max(0, index.value + step))
  selected.value = index.value === 0 ? "parking space" : "curious"
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
