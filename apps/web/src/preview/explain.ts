import { computed, ref, watch, type Ref } from "vue"
import { lookupAnalysis, type Analysis } from "./reader-data"

export type ExplainSource = "sample" | "cache" | "live" | "mock" | "missing" | "error"

export function useExplanation(passageId: Ref<string>, word: Ref<string>, sentence: Ref<string>) {
  const remote = ref<Analysis | null>(null)
  const source = ref<ExplainSource>("missing")
  const loading = ref(false)
  const error = ref("")
  const sample = computed(() => (word.value ? lookupAnalysis(passageId.value, word.value) : null))
  const analysis = computed(() => remote.value || sample.value)

  async function loadCache() {
    remote.value = null
    error.value = ""
    source.value = sample.value ? "sample" : "missing"
    if (!word.value || !passageId.value) return
    const params = new URLSearchParams({
      passageId: passageId.value,
      word: word.value,
      sentence: sentence.value,
    })
    const response = await fetch(`/api/preview/explain?${params}`)
    if (!response.ok) return
    const data = await response.json()
    if (data?.analysis) {
      remote.value = data.analysis as Analysis
      source.value = "cache"
    }
  }

  async function explain() {
    if (!word.value || loading.value) return
    loading.value = true
    error.value = ""
    try {
      const response = await fetch("/api/preview/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passageId: passageId.value, word: word.value, sentence: sentence.value }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "解析失败")
      remote.value = data.analysis as Analysis
      source.value = data.source === "cache" ? "cache" : data.source === "mock" ? "mock" : "live"
    } catch (cause) {
      source.value = sample.value ? "sample" : "error"
      error.value = cause instanceof Error ? cause.message : "解析失败"
    } finally {
      loading.value = false
    }
  }

  watch([passageId, word, sentence], () => { void loadCache() }, { immediate: true })
  return { analysis, source, loading, error, explain }
}
