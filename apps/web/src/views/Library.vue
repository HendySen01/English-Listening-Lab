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
          <span>{{ word.knownAlready ? "已掌握" : word.due ? familiarityLabel(word.familiarity) : "待学习" }}<template v-if="word.due && !word.knownAlready"> · {{ remain(word.due) }}</template></span>
        </button>
        <p v-if="!filtered.length" class="rd-note">这个筛选下没有词。</p>
      </div>
      <aside v-if="current" class="rd-notes" :key="current.id">
        <p class="rd-kicker">Word notes</p>
        <div class="rd-meta" style="justify-content: space-between">
          <h2 class="rd-word" style="font-size: 40px" translate="no">{{ current.lemma }}</h2>
          <button class="rd-icon" type="button" :aria-label="`朗读 ${current.lemma}`" @click="speak(current.lemma)"><Volume2 aria-hidden="true" :size="16" /></button>
        </div>
        <p v-if="speech.status.value !== '空闲' || speech.detail.value" class="rd-status" role="status">{{ speech.sourceLabel.value }} · {{ speech.status.value }}<template v-if="speech.detail.value"> · {{ speech.detail.value }}</template></p>
        <p class="rd-meta"><span translate="no">{{ current.ipa || "没有可靠音标" }}</span><span>·</span><span>{{ current.pos }}</span></p>
        <p class="rd-copy">{{ current.meaningZh }}</p>
        <p v-if="current.definitionEn" class="rd-copy">{{ current.definitionEn }}</p>
        <p v-if="current.collocation" class="rd-source">常见搭配：{{ current.collocation }}</p>
        <div v-if="contexts.length > 1" class="rd-tools" style="margin-top: 12px">
          <button v-for="item in contexts" :key="item.id" class="rd-pill" type="button" :aria-pressed="item.id === current.id" @click="choose(item.id)">{{ item.lessonDate || "另一条记录" }}</button>
        </div>
        <div v-if="current.example" class="rd-section">
          <h3 class="rd-label">原始学习例句 <span>FROM THE LESSON</span></h3>
          <p class="rd-sentence" style="font-size: 28px" translate="no">{{ current.example }}</p>
          <BlurText v-if="current.exampleZh" :text="current.exampleZh" :clear="clear" @toggle="clear = !clear" />
          <h3 class="rd-label" style="margin-top: 14px">这句话中的用法 <span>IN THIS SENTENCE</span></h3>
          <p v-if="analysis" class="rd-copy">{{ analysis.usage }}</p>
          <p v-else class="rd-copy">深度解析会只针对上面这句，不会把词典定义当成句子用法。</p>
          <button class="rd-pill" type="button" :disabled="loading" @click="explain">{{ loading ? "正在解析" : analysis ? "已载入这句的解析" : "深入解析这句" }}</button>
          <p v-if="error" class="rd-status">{{ error }}</p>
          <ExpandFold :open="Boolean(analysis)" :limit="false">
            <div v-if="analysis" class="rd-section">
              <h3 class="rd-label">词源与词根 <span>ETYMOLOGY</span></h3>
              <p class="rd-copy">{{ analysis.etymology.originalImage }}</p>
              <div class="rd-grid">
                <div><strong>prefix</strong>{{ analysis.etymology.prefix || "无" }}</div>
                <div><strong>root</strong>{{ analysis.etymology.root || "无" }}</div>
                <div><strong>suffix</strong>{{ analysis.etymology.suffix || "无" }}</div>
              </div>
              <h3 class="rd-label">语义演变 <span>ROUTES</span></h3>
              <div v-for="route in analysis.semanticRoutes" :key="route.label" class="rd-compare">
                <strong>{{ route.label }}</strong>
                <p class="rd-copy">{{ route.steps }}</p>
              </div>
              <h3 class="rd-label">近义区别 <span>COMPARE</span></h3>
              <div v-for="item in analysis.comparisons" :key="item.word" class="rd-compare">
                <strong translate="no">{{ item.word }}</strong>
                <p class="rd-copy">{{ item.difference }}</p>
              </div>
            </div>
          </ExpandFold>
        </div>
        <div v-else class="rd-section">
          <h3 class="rd-label">常见含义与搭配 <span>NO SAVED SENTENCE</span></h3>
          <p class="rd-copy">这条词没有保存学习例句，所以这里不写「当前句子里的用法」。</p>
        </div>
        <div class="rd-section">
          <h3 class="rd-label">复习状态 <span>FSRS</span></h3>
          <p class="rd-copy">{{ familiarityLabel(current.familiarity) }} · 已复习 {{ current.reps }} 次</p>
          <p class="rd-copy" v-if="current.due">下次 {{ when(current.due) }} · {{ remain(current.due) }}</p>
          <p class="rd-copy" v-else>还没有复习时间。打开复习不会新建记录。</p>
          <div class="rd-actions" style="margin-top: 12px">
            <router-link v-if="current.due && !current.knownAlready && new Date(current.due) <= now" class="rd-pill primary" :to="`/review?focus=${current.id}`">开始复习</router-link>
            <router-link v-if="current.due" class="rd-pill secondary" :to="`/review?focus=${current.id}&practice=1`">提前练习</router-link>
            <span v-else class="rd-copy">暂无复习计划</span>
            <router-link v-if="current.lessonId" class="rd-pill quiet" :to="`/context?lesson=${current.lessonId}&word=${current.id}`">返回学习语境</router-link>
          </div>
        </div>
      </aside>
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
import { Volume2 } from "lucide-vue-next"
import BlurText from "../preview/BlurText.vue"
import ExpandFold from "../preview/ExpandFold.vue"
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
  lapses: number
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
const clear = ref(false)
const speech = useSpeech()
const filters = [
  { id: "all", label: "全部" },
  { id: "due", label: "待复习" },
  { id: "soon", label: "即将到期" },
  { id: "weak", label: "薄弱词汇" },
  { id: "known", label: "已掌握" },
]
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const soon = now.value.getTime() + 48 * 60 * 60 * 1000
  return words.value.filter((word) => {
    if (q && !word.lemma.toLowerCase().includes(q) && !word.meaningZh.includes(query.value.trim())) return false
    if (filter.value === "due") return Boolean(word.due && new Date(word.due) <= now.value && !word.knownAlready)
    if (filter.value === "soon") return Boolean(word.due && !word.knownAlready && new Date(word.due) > now.value && new Date(word.due).getTime() <= soon)
    if (filter.value === "weak") return Boolean(word.due && (word.familiarity === "forgot" || word.familiarity === "hard" || word.lapses > 0))
    if (filter.value === "known") return word.knownAlready || word.familiarity === "easy"
    return true
  })
})
const current = computed(() => words.value.find((word) => word.id === currentId.value) || null)
const contexts = computed(() => words.value.filter((word) => current.value && word.lemma.toLowerCase() === current.value.lemma.toLowerCase()))
const passageId = computed(() => current.value ? `lesson:${current.value.lessonId || "none"}:word:${current.value.id}` : "")
const lemma = computed(() => current.value?.lemma || "")
const sentence = computed(() => current.value?.example || "")
const { analysis, loading, error, explain } = useExplanation(passageId, lemma, sentence)
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
  clear.value = false
  persist()
}
async function speak(text: string) {
  await speech.play(text, 1, false)
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
