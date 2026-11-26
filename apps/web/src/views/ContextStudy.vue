<template>
  <section class="rd" v-if="lesson">
    <p class="rd-kicker">{{ lesson.lessonDate }} · {{ lesson.sourceLabel }}</p>
    <h2 class="rd-title">{{ lesson.listening.title }}</h2>
    <p class="rd-note">英文来自这节课。没有逐句中文的句子不会编造译文。</p>
    <div class="rd-frame rd-workspace">
      <div class="rd-read">
        <div class="rd-tools">
          <button class="rd-pill" type="button" :disabled="index === 0" @click="index -= 1">上一句</button>
          <button class="rd-pill" type="button" :disabled="index === passages.length - 1" @click="index += 1">下一句</button>
          <button class="rd-pill primary" type="button" @click="speak(passages[index].sentence)">朗读句子</button>
          <SpeechRateControl />
        </div>
        <p v-if="rateError" class="rd-note" role="status">{{ rateError }}</p>
        <p class="rd-sentence" translate="no">
          <template v-for="(token, tokenIndex) in tokens" :key="tokenIndex">
            <button v-if="token.key" class="rd-token" type="button" :aria-pressed="selected === token.key" @click="selected = token.key">{{ token.text }}</button>
            <span v-else>{{ token.text }}</span>
          </template>
        </p>
        <BlurText v-if="passages[index].translation" :text="passages[index].translation" :clear="clear" @toggle="clear = !clear" />
        <p v-else class="rd-source">这句没有保存中文译文。</p>
        <p class="rd-source">{{ voice }}</p>
      </div>
      <ReaderNotes
        column-scroll
        :key="passageKey + selected"
        :word="selected"
        :analysis="analysis"
        :summary="summary"
        :source="source"
        :loading="loading"
        :error="error"
        mark=""
        @speak="speak"
        @explain="explain"
      />
    </div>
  </section>
  <p v-else-if="errorText" class="bad">{{ errorText }}</p>
  <p v-else>正在读取课程语境……</p>
</template>

<script setup lang="ts">
import SpeechRateControl from "../components/SpeechRateControl.vue"
import { computed, onMounted, ref, watch } from "vue"
import { useRoute } from "vue-router"
import BlurText from "../preview/BlurText.vue"
import ReaderNotes from "../preview/ReaderNotes.vue"
import { useExplanation } from "../preview/explain"
import { tokenize } from "../preview/reader-data"
import { useStudySpeech } from "../composables/useStudySpeech"
import { api } from "../api"
import { useAppStore, type Lesson } from "../stores/app"
import { useStudyClock } from "../composables/useStudyClock"
import "../preview/reader.css"

const route = useRoute()
const store = useAppStore()
const lesson = ref<Lesson | null>(null)
useStudyClock("context", () => lesson.value?.id || null)
const errorText = ref("")
const index = ref(0)
const selected = ref("")
const clear = ref(false)
const voice = ref("浏览器语音，尚未播放")
const { speech, rate, rateError } = useStudySpeech()
const passages = computed(() => {
  if (!lesson.value) return []
  const chunks = lesson.value.listening.chunks.filter(Boolean).map((sentence, chunkIndex) => ({
    id: `${lesson.value?.id}:chunk:${chunkIndex}`,
    sentence: sentence.replace(/\s*\/\s*/g, " "),
    translation: "",
  }))
  const examples = lesson.value.words.map((word) => ({
    id: `${lesson.value?.id}:word:${word.id}`,
    sentence: word.example,
    translation: word.exampleZh,
  }))
  return chunks.length ? [...chunks, ...examples] : examples
})
const tokens = computed(() => tokenize(passages.value[index.value]?.sentence || ""))
const matched = computed(() => lesson.value?.words.find((word) => word.lemma.toLowerCase() === selected.value) || null)
const passageKey = computed(() => passages.value[index.value]?.id || "")
const passageId = computed(() => matched.value ? `lesson:${lesson.value?.id}:word:${matched.value.id}` : passageKey.value)
const lemma = computed(() => selected.value)
const sentence = computed(() => passages.value[index.value]?.sentence || "")
const { analysis, source, loading, error, explain } = useExplanation(passageId, lemma, sentence)
const summary = computed(() => {
  if (!matched.value || analysis.value) return undefined
  return {
    pronunciation: matched.value.ipa || "",
    partOfSpeech: matched.value.pos,
    definition: matched.value.meaningZh,
    usage: matched.value.definitionEn || matched.value.collocation,
  }
})

async function speak(text: string) {
  speech.stop()
  await speech.play(text, rate.value, false)
  voice.value = speech.sourceLabel.value.includes("浏览器") ? "浏览器语音" : speech.sourceLabel.value
}
watch(index, () => { clear.value = false })
onMounted(async () => {
  try {
    if (!store.dashboard) await store.load()
    const id = String(route.query.lesson || store.dashboard?.lesson?.id || "")
    if (!id) {
      errorText.value = "今天没有可阅读的课程。"
      return
    }
    lesson.value = await api<Lesson>(`/api/lessons/${id}`)
    const wordId = String(route.query.word || "")
    const word = lesson.value.words.find((item) => item.id === wordId)
    if (word) {
      const found = passages.value.findIndex((item) => item.id.endsWith(word.id))
      if (found >= 0) index.value = found
      selected.value = word.lemma.toLowerCase()
    }
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : "语境读取失败"
  }
})
</script>
