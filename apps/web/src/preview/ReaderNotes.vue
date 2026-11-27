<template>
  <aside class="rd-notes">
    <p class="rd-kicker">Word notes</p>
    <p v-if="!word" class="rd-note">点击左边的单词。这里会显示这个词在当前句子里的意思，而不是一份词典列表。</p>
    <template v-else-if="summary && !analysis">
      <p class="rd-source">课程词条。深度解析会按这一课的句子单独缓存。</p>
      <div class="rd-meta" style="justify-content: space-between;">
        <h2 class="rd-word" style="font-size: 40px" translate="no">{{ word }}</h2>
        <button class="rd-icon" type="button" :aria-label="`朗读 ${word}`" @click="$emit('speak', word)">
          <Volume2 aria-hidden="true" :size="16" />
        </button>
      </div>
      <p class="rd-meta" translate="no"><span>{{ summary.pronunciation || "没有单独标音标" }}</span><span>·</span><span>{{ summary.partOfSpeech }}</span></p>
      <p class="rd-copy">{{ summary.definition }}</p>
      <div class="rd-box">
        <h3 class="rd-label">当前句子里的用法 <span>IN CONTEXT</span></h3>
        <p class="rd-copy">{{ summary.usage }}</p>
      </div>
      <div class="rd-tools" style="margin-top: 16px">
        <button class="rd-pill primary" type="button" :disabled="loading" @click="$emit('explain')">{{ explainLabel }}</button>
        <button v-if="!hideMarks" class="rd-pill" type="button" :disabled="markBusy" :aria-pressed="mark === 'known'" @click="$emit('mark', 'known')">我已认识</button>
        <button v-if="!hideMarks" class="rd-pill" type="button" :disabled="markBusy" :aria-pressed="mark === 'again'" @click="$emit('mark', 'again')">需要加强</button>
      </div>
      <p v-if="error" class="rd-status" role="status">{{ error }}</p>
      <slot />
    </template>
    <template v-else-if="!analysis">
      <h2 class="rd-word" style="font-size: 36px" translate="no">{{ word }}</h2>
      <p class="rd-copy">这个词还没有静态样本，也没有匹配当前句子的缓存。</p>
      <button class="rd-pill primary" type="button" :disabled="loading" @click="$emit('explain')">{{ explainLabel }}</button>
      <p v-if="error" class="rd-status" role="status">{{ error }}</p>
    </template>
    <template v-else>
      <p class="rd-source">{{ sourceLabel }}</p>
      <div class="rd-meta" style="justify-content: space-between;">
        <h2 class="rd-word" style="font-size: 40px" translate="no">{{ analysis.text }}</h2>
        <button class="rd-icon" type="button" :aria-label="`朗读 ${analysis.text}`" @click="$emit('speak', analysis.text)">
          <Volume2 aria-hidden="true" :size="16" />
        </button>
      </div>
      <p class="rd-meta" translate="no"><span>{{ analysis.pronunciation }}</span><span>·</span><span>{{ analysis.partOfSpeech }}</span></p>
      <p class="rd-copy">{{ analysis.definition }}</p>
      <div class="rd-box">
        <h3 class="rd-label">当前句子里的用法 <span>IN CONTEXT</span></h3>
        <p class="rd-copy">{{ analysis.usage }}</p>
      </div>
      <div class="rd-tools" style="margin-top: 16px">
        <button class="rd-pill primary" type="button" :disabled="loading || (source === 'cache' || source === 'live') && !canSupplement" @click="$emit('explain', canSupplement)">{{ explainLabel }}</button>
        <button v-if="!hideMarks" class="rd-pill" type="button" :disabled="markBusy" :aria-pressed="mark === 'known'" @click="$emit('mark', 'known')">我已认识</button>
        <button v-if="!hideMarks" class="rd-pill" type="button" :disabled="markBusy" :aria-pressed="mark === 'again'" @click="$emit('mark', 'again')">需要加强</button>
      </div>
      <p v-if="error" class="rd-status" role="status">{{ error }}</p>
      <p v-if="mark && !markNote" class="rd-status" role="status">{{ mark === "known" ? "已在这次预览里记为认识。" : "已标成需要加强。" }}没有新建复习记录，重复点击也不会再加一条。</p>
      <p v-else-if="markNote" class="rd-status" role="status">{{ markNote }}</p>
      <button :id="`${foldId}-button`" class="rd-pill" style="margin-top: 14px" type="button" :aria-expanded="deep" :aria-controls="foldId" @click="toggleDeep">
        {{ deep ? "收起深入解析" : "深入解析：词源、词根和语义线路" }}
      </button>
      <ExpandFold :id="foldId" :open="deep" :limit="!columnScroll">
        <div v-if="analysis.wordFormation && !formationShown" class="rd-section">
          <h3 class="rd-label">现代构词 <span>WORD FORMATION</span></h3>
          <WordFormation :word="word" :formation="analysis.wordFormation" />
        </div>
        <div class="rd-section">
          <h3 class="rd-label">词源与原始画面 <span>ETYMOLOGY</span></h3>
          <p class="rd-copy">{{ analysis.etymology.originalImage }}</p>
          <EtymologyParts :etymology="analysis.etymology" />
          <p class="rd-copy">{{ analysis.etymology.origin }}<template v-if="analysis.etymology.certainty">（{{ analysis.etymology.certainty }}）</template></p>
        </div>
        <div class="rd-section">
          <h3 class="rd-label">语义演变 <span>SEMANTIC ROUTES</span></h3>
          <div v-for="route in analysis.semanticRoutes" :key="route.label" class="rd-compare">
            <strong>{{ route.label }} · {{ route.domain }}</strong>
            <p class="rd-copy">{{ route.steps }}</p>
            <p class="rd-copy">现在常指：{{ route.modernMeaning }}</p>
          </div>
        </div>
        <div class="rd-section">
          <h3 class="rd-label">容易混的说法 <span>COMPARE</span></h3>
          <div v-for="item in analysis.comparisons" :key="item.word" class="rd-compare">
            <strong translate="no">{{ item.word }} · {{ item.partOfSpeech }}</strong>
            <p class="rd-copy">{{ item.difference }}</p>
          </div>
        </div>
        <div class="rd-section">
          <h3 class="rd-label">另外两句 <span>EXAMPLES</span></h3>
          <div v-for="example in analysis.examples" :key="example.text" class="rd-example">
            <p translate="no">{{ example.text }}</p>
            <BlurText :text="example.translation" :clear="open.has(example.text)" @toggle="toggle(example.text)" />
            <p class="rd-source">{{ example.contextNote }}</p>
          </div>
        </div>
      </ExpandFold>
      <slot />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue"
import { Volume2 } from "lucide-vue-next"
import BlurText from "./BlurText.vue"
import ExpandFold from "./ExpandFold.vue"
import EtymologyParts from "./EtymologyParts.vue"
import WordFormation from "../components/WordFormation.vue"
import type { Analysis } from "./reader-data"
import type { ExplainSource } from "./explain"

const props = defineProps<{
  word: string
  analysis: Analysis | null
  mark: "" | "known" | "again"
  source: ExplainSource
  loading: boolean
  error: string
  columnScroll?: boolean
  hideMarks?: boolean
  initiallyExpanded?: boolean
  formationShown?: boolean
  summary?: { pronunciation: string; partOfSpeech: string; definition: string; usage: string }
  markNote?: string
  markBusy?: boolean
}>()
defineEmits<{ speak: [text: string]; mark: [value: "known" | "again"]; explain: [refreshFormation?: boolean] }>()
const canSupplement = computed(() => props.source === "cache" && props.analysis?.type === "word" && !props.analysis.wordFormation)
const sourceLabel = computed(() => {
  if (props.source === "mock") return "Mock 解析。没有调用真实模型。"
  if (props.source === "live") return "实时 AI。刚刚由 DeepSeek 生成，并写入了预览缓存。"
  if (props.source === "cache") return "AI 缓存。同一句子和词再次打开时直接读取，没有再次调用。"
  if (props.source === "sample") return "静态示范。结构与 Context Reader 一致，不是这次的模型回复。"
  return "还没有可用解释。"
})
const explainLabel = computed(() => {
  if (props.loading) return "正在解析"
  if (canSupplement.value) return "AI 补充英文构词"
  if (props.source === "cache" || props.source === "live" || props.source === "mock") return "已载入 AI 解释"
  return "AI 深度解析"
})
const deep = ref(Boolean(props.initiallyExpanded))
const foldId = useId()
const open = ref(new Set<string>())
function toggleDeep() {
  if (deep.value) {
    const fold = document.getElementById(foldId)
    const button = document.getElementById(`${foldId}-button`)
    if (fold?.contains(document.activeElement) && button instanceof HTMLElement) button.focus()
  }
  deep.value = !deep.value
}
function toggle(key: string) {
  const next = new Set(open.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  open.value = next
}
</script>
