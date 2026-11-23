<template>
  <section class="rd" v-if="ready">
    <button v-if="narrow && current" class="rd-pill" type="button" style="margin-bottom: 8px" @click="currentId = ''">返回列表</button>
    <div class="rd-frame rd-workspace lib-workspace" :class="{ 'is-detail': Boolean(current) && narrow }">
      <div class="rd-read lib-list">
        <input class="rd-field" v-model="query" placeholder="搜索单词或中文意思" @input="persist" />
        <div class="rd-segment" role="group" aria-label="词汇筛选">
          <button v-for="item in filters" :key="item.id" class="rd-pill" type="button" :aria-pressed="filter === item.id" @click="filter = item.id; persist()">{{ item.label }}</button>
        </div>
        <p class="rd-source">{{ filtered.length }} 个词</p>
        <button v-for="word in filtered" :key="word.id" class="lib-row" type="button" :aria-pressed="current?.id === word.id" @click="choose(word.id)">
          <strong translate="no">{{ word.lemma }}</strong>
          <span>{{ word.meaningZh }}</span>
          <span>{{ familiarityLabel(word.familiarity) }}<template v-if="word.due"> · {{ remain(word.due) }}</template></span>
        </button>
        <p v-if="!filtered.length" class="rd-note">这个筛选下没有词。</p>
      </div>
      <ReaderNotes
        v-if="current"
        column-scroll
        :key="current.id + (analysis?.text || '')"
        :word="current.lemma"
        :analysis="analysis"
        :summary="summary"
        :source="source"
        :loading="loading"
        :error="error"
        :mark="mark"
        :mark-note="markNote"
        @speak="speak"
        @mark="onMark"
        @explain="explain"
      >
        <div class="rd-section">
          <h3 class="rd-label">复习状态 <span>FSRS</span></h3>
          <p class="rd-copy">{{ familiarityLabel(current.familiarity) }} · 已复习 {{ current.reps }} 次</p>
          <p class="rd-copy" v-if="current.due">下次 {{ when(current.due) }} · {{ remain(current.due) }}</p>
          <p class="rd-copy" v-else>还没有复习时间，这里不会新建一条记录。</p>
          <p class="rd-copy" v-if="current.collocation">搭配：{{ current.collocation }}</p>
          <p class="rd-copy" v-if="current.morphology">词根：{{ current.morphology.prefix || "无前缀" }} + {{ current.morphology.root }} + {{ current.morphology.suffix || "无后缀" }}</p>
          <div class="rd-tools" v-if="contexts.length > 1">
            <button v-for="item in contexts" :key="item.id" class="rd-pill" type="button" :aria-pressed="item.id === current.id" @click="choose(item.id)">{{ item.lessonDate || "语境" }}</button>
          </div>
          <div class="rd-tools" style="margin-top: 8px">
            <router-link class="rd-pill primary" :to="`/review?focus=${current.id}`">开始复习</router-link>
            <router-link class="rd-pill" :to="`/review?focus=${current.id}&practice=1`">提前练习</router-link>
            <router-link v-if="current.lessonId" class="rd-pill" :to="`/context?lesson=${current.lessonId}&word=${current.id}`">查看原学习语境</router-link>
          </div>
        </div>
      </ReaderNotes>
      <aside v-else class="rd-notes">
        <p class="rd-kicker">Word notes</p>
        <p class="rd-note">从左边选择一个词。</p>
      </aside>
    </div>
  </section>
  <p v-else-if="errorText" class="bad">{{ errorText }}</p>
  <p v-else>正在读取词库……</p>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import ReaderNotes from "../preview/ReaderNotes.vue"
import { useExplanation } from "../preview/explain"
import { useSpeech } from "../composables/useSpeech"
import { api } from "../api"
import { formatDue, formatWhen } from "../lib/due"
import "../preview/reader.css"

type LibraryWord = {
  id: string
  lemma: string
  pos: string
  ipa: string | null
  meaningZh: string
  definitionEn: string
  collocation: string
  example: string
  exampleZh: string
  morphology: { prefix?: string | null; root?: string; suffix?: string | null; meaningZh?: string } | null
  knownAlready: boolean
  familiarity: string
  due: string | null
  reps: number
  lessonId: string | null
  lessonDate: string | null
  lessonTitle: string
}

const words = ref<LibraryWord[]>([])
const query = ref(sessionStorage.getItem("ell-library-query") || "")
const filter = ref(sessionStorage.getItem("ell-library-filter") || "all")
const currentId = ref(sessionStorage.getItem("ell-library-word") || "")
const ready = ref(false)
const errorText = ref("")
const narrow = ref(window.matchMedia("(max-width: 900px)").matches)
const now = ref(new Date())
const mark = ref<"" | "known" | "again">("")
const markNote = ref("")
const speech = useSpeech()
const filters = [
  { id: "all", label: "全部" },
  { id: "due", label: "待复习" },
  { id: "soon", label: "即将到期" },
  { id: "known", label: "已掌握" },
]
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const soon = now.value.getTime() + 48 * 60 * 60 * 1000
  return words.value.filter((word) => {
    if (q && !word.lemma.toLowerCase().includes(q) && !word.meaningZh.includes(query.value.trim())) return false
    if (filter.value === "due") return Boolean(word.due && new Date(word.due) <= now.value && word.reps > 0 && !word.knownAlready)
    if (filter.value === "soon") return Boolean(word.due && new Date(word.due) > now.value && new Date(word.due).getTime() <= soon)
    if (filter.value === "known") return word.knownAlready || word.familiarity === "easy"
    return true
  })
})
const current = computed(() => words.value.find((word) => word.id === currentId.value) || null)
const contexts = computed(() => words.value.filter((word) => current.value && word.lemma.toLowerCase() === current.value.lemma.toLowerCase()))
const passageId = computed(() => current.value ? `lesson:${current.value.lessonId || "none"}:word:${current.value.id}` : "")
const lemma = computed(() => current.value?.lemma || "")
const sentence = computed(() => current.value?.example || "")
const { analysis, source, loading, error, explain } = useExplanation(passageId, lemma, sentence)
const summary = computed(() => current.value ? {
  pronunciation: current.value.ipa || "",
  partOfSpeech: current.value.pos,
  definition: current.value.meaningZh,
  usage: current.value.definitionEn ? `这句用的是「${current.value.collocation || current.value.lemma}」。${current.value.definitionEn}` : current.value.example,
} : undefined)
let timer = 0

function familiarityLabel(value: string) {
  if (value === "forgot") return "忘记"
  if (value === "hard") return "困难"
  if (value === "easy") return "非常熟悉"
  if (value === "remembered") return "记得"
  return "新学"
}
function remain(due: string) { return formatDue(due, now.value) }
function when(due: string) { return formatWhen(due) }
function persist() {
  sessionStorage.setItem("ell-library-query", query.value)
  sessionStorage.setItem("ell-library-filter", filter.value)
  sessionStorage.setItem("ell-library-word", current.value?.id || "")
}
function choose(id: string) {
  currentId.value = id
  mark.value = ""
  markNote.value = ""
  persist()
}
async function speak(text: string) {
  await speech.play(text, 1, false)
}
async function onMark(value: "known" | "again") {
  if (!current.value) return
  if (value === "known") {
    await api(`/api/vocabulary/${current.value.id}/known`, { method: "POST" })
    mark.value = "known"
    markNote.value = "已记为认识，使用的是原来的词汇记录。"
  } else {
    await api(`/api/review/${current.value.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ rating: "hard", recallAbility: "recognize" }),
    })
    mark.value = "again"
    markNote.value = "已记为需要加强，没有另建一条复习记录。"
  }
  words.value = await api("/api/library")
}
function onResize() { narrow.value = window.matchMedia("(max-width: 900px)").matches }
watch(current, () => persist())
onMounted(async () => {
  try {
    words.value = await api("/api/library")
    if (currentId.value && !words.value.some((word) => word.id === currentId.value)) currentId.value = ""
    if (!narrow.value && !currentId.value && words.value[0]) currentId.value = words.value[0].id
    ready.value = true
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : "词库读取失败"
  }
  window.addEventListener("resize", onResize)
  timer = window.setInterval(() => { now.value = new Date() }, 30000)
})
onUnmounted(() => {
  window.removeEventListener("resize", onResize)
  window.clearInterval(timer)
})
</script>
