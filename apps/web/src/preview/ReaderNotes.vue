<template>
  <aside class="rd-notes">
    <p class="rd-kicker">Word notes</p>
    <p v-if="!word" class="rd-note">点击左边的单词。这里会显示这个词在当前句子里的意思，而不是一份词典列表。</p>
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
      <button class="rd-pill" style="margin-top: 14px" type="button" :aria-expanded="deep" @click="deep = !deep">
        {{ deep ? "收起深入解析" : "深入解析：词源、词根和语义线路" }}
      </button>
      <div v-if="deep">
        <div class="rd-section">
          <h3 class="rd-label">词源与原始画面 <span>ETYMOLOGY</span></h3>
          <p class="rd-copy">{{ analysis.etymology.originalImage }}</p>
          <div class="rd-grid">
            <div><strong>prefix</strong>{{ analysis.etymology.prefix || "无" }}</div>
            <div><strong>root</strong>{{ analysis.etymology.root || "无" }}</div>
            <div><strong>suffix</strong>{{ analysis.etymology.suffix || "无" }}</div>
          </div>
          <p class="rd-copy">{{ analysis.etymology.origin }}（{{ analysis.etymology.certainty }}）</p>
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
      </div>
      <div class="rd-tools" style="margin-top: 16px">
        <button class="rd-pill primary" type="button" :disabled="loading || source === 'cache' || source === 'live'" @click="$emit('explain')">{{ explainLabel }}</button>
        <button class="rd-pill" type="button" :aria-pressed="mark === 'known'" @click="$emit('mark', 'known')">我已认识</button>
        <button class="rd-pill" type="button" :aria-pressed="mark === 'again'" @click="$emit('mark', 'again')">需要加强</button>
      </div>
      <p v-if="error" class="rd-status" role="status">{{ error }}</p>
      <p v-if="mark" class="rd-status" role="status">{{ mark === "known" ? "已在这次预览里记为认识。" : "已标成需要加强。" }}没有新建复习记录，重复点击也不会再加一条。</p>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { Volume2 } from "lucide-vue-next"
import BlurText from "./BlurText.vue"
import { computed } from "vue"
import type { Analysis } from "./reader-data"
import type { ExplainSource } from "./explain"

const props = defineProps<{
  word: string
  analysis: Analysis | null
  mark: "" | "known" | "again"
  source: ExplainSource
  loading: boolean
  error: string
}>()
defineEmits<{ speak: [text: string]; mark: [value: "known" | "again"]; explain: [] }>()
const sourceLabel = computed(() => {
  if (props.source === "live") return "实时 AI。刚刚由 DeepSeek 生成，并写入了预览缓存。"
  if (props.source === "cache") return "AI 缓存。同一句子和词再次打开时直接读取，没有再次调用。"
  if (props.source === "sample") return "静态示范。结构与 Context Reader 一致，不是这次的模型回复。"
  return "还没有可用解释。"
})
const explainLabel = computed(() => {
  if (props.loading) return "正在解析"
  if (props.source === "cache" || props.source === "live") return "已载入 AI 解释"
  return "AI 深度解析"
})
const deep = ref(false)
const open = ref(new Set<string>())
function toggle(key: string) {
  const next = new Set(open.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  open.value = next
}
</script>
