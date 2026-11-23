<template>
  <section class="rd">
    <div class="rd-frame rd-workspace">
      <div class="rd-read">
        <div class="rd-meta">
          <h2 class="rd-word" translate="no">{{ word.lemma }}</h2>
          <button class="rd-icon" type="button" :aria-label="`朗读 ${word.lemma}`" @click="speak(word.lemma)"><Volume2 aria-hidden="true" :size="18" /></button>
        </div>
        <p class="rd-meta" translate="no">
          <span>{{ word.ipa || "没有单独标音标" }}</span>
          <span>·</span>
          <span>{{ word.pos }}</span>
          <span>·</span>
          <span>{{ speech.sourceLabel.value }} · {{ speech.status.value }}</span>
          <button class="rd-pill" type="button" @click="speak(word.example)">读例句</button>
          <span class="rd-segment" role="group" aria-label="语速">
            <button v-for="item in rates" :key="item" class="rd-pill" type="button" :aria-pressed="rate === item" @click="rate = item">{{ item }}×</button>
          </span>
        </p>
        <p class="rd-sentence" style="font-size: clamp(22px, 2.4vw, 32px)" translate="no">{{ word.example }}</p>
        <BlurText :text="word.exampleZh" :clear="clear" @toggle="clear = !clear" />
        <p v-if="word.collocation" class="rd-copy">搭配：{{ word.collocation }}</p>
        <p v-if="speech.detail.value" class="rd-status" role="status">{{ speech.detail.value }}</p>
        <p v-if="message" class="rd-status" role="status">{{ message }}</p>
      </div>
      <ReaderNotes
        column-scroll
        :key="word.id"
        :word="word.lemma"
        :analysis="analysis"
        :summary="summary"
        :source="source"
        :loading="loading"
        :error="error"
        :mark="mark"
        :mark-busy="markBusy"
        @speak="speak"
        @mark="onMark"
        @explain="explain"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Volume2 } from "lucide-vue-next"
import BlurText from "../preview/BlurText.vue"
import ReaderNotes from "../preview/ReaderNotes.vue"
import { useExplanation } from "../preview/explain"
import { api } from "../api"
import { progressStamp, withReviewRequest } from "../lib/reviewRequest"
import { useSpeech } from "../composables/useSpeech"
import type { Word } from "../stores/app"
import "../preview/reader.css"

const props = defineProps<{ word: Word; lessonId: string }>()
const emit = defineEmits<{ changed: [] }>()
const rates = [0.8, 1, 1.2]
const rate = ref(1)
const clear = ref(false)
const mark = ref<"" | "known" | "again">(props.word.knownAlready ? "known" : "")
const markBusy = ref(false)
const message = ref("")
const speech = useSpeech()
const passageId = computed(() => `lesson:${props.lessonId}:word:${props.word.id}`)
const lemma = computed(() => props.word.lemma)
const sentence = computed(() => props.word.example)
watch(() => props.word.id, () => {
  mark.value = props.word.knownAlready ? "known" : ""
  message.value = ""
  clear.value = false
})
const { analysis, source, loading, error, explain } = useExplanation(passageId, lemma, sentence)
const summary = computed(() => ({
  pronunciation: props.word.ipa || "",
  partOfSpeech: props.word.pos,
  definition: props.word.meaningZh,
  usage: props.word.definitionEn
    ? `这句用的是「${props.word.collocation || props.word.lemma}」。${props.word.definitionEn}`
    : props.word.collocation,
}))

async function speak(text: string) {
  await speech.play(text, rate.value, false)
}

async function onMark(value: "known" | "again") {
  if (markBusy.value) return
  markBusy.value = true
  try {
    if (value === "known") {
      await withReviewRequest(`known:${props.word.id}`, { progress: progressStamp(props.word) }, (body) =>
        api(`/api/vocabulary/${props.word.id}/known`, { method: "POST", body: JSON.stringify(body) }),
      )
      mark.value = "known"
      message.value = "已记为认识。后面的新课不会再把它当新词。"
    } else {
      await withReviewRequest(`formal:${props.word.id}`, { rating: "hard", recallAbility: "recognize", progress: progressStamp(props.word) }, (body) =>
        api(`/api/review/${props.word.id}/rate`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      )
      mark.value = "again"
      message.value = "已记为需要加强，复习会来得更早。"
    }
    emit("changed")
  } catch (err) {
    message.value = err instanceof Error ? err.message : "这次操作没有写入。"
  } finally {
    markBusy.value = false
  }
}
</script>
