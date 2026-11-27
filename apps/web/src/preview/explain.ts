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
  let selection = 0
  let cacheRequest: AbortController | null = null

  async function loadCache() {
    const selected = ++selection
    cacheRequest?.abort()
    cacheRequest = null
    loading.value = false
    remote.value = null
    error.value = ""
    source.value = sample.value ? "sample" : "missing"
    if (!word.value || !passageId.value) return
    const params = new URLSearchParams({
      passageId: passageId.value,
      word: word.value,
      sentence: sentence.value,
    })
    cacheRequest = new AbortController()
    try {
      const response = await fetch(`/api/preview/explain?${params}`, { signal: cacheRequest.signal })
      if (!response.ok) return
      const data = await response.json()
      if (selected === selection && data?.analysis) {
        remote.value = data.analysis as Analysis
        source.value = "cache"
      }
    } catch { /* A cache lookup can fail independently of an explicit explanation request. */ }
  }

  async function explain(refreshFormation = false) {
    if (!word.value || loading.value) return
    const selected = selection
    cacheRequest?.abort()
    loading.value = true
    error.value = ""
    try {
      const response = await fetch("/api/preview/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passageId: passageId.value, word: word.value, sentence: sentence.value, refreshFormation }),
      })
      const data = await response.json()
      if (selected !== selection) return
      if (!response.ok) throw new Error(data.error || "解析失败")
      remote.value = data.analysis as Analysis
      source.value = data.source === "cache" ? "cache" : data.source === "mock" ? "mock" : "live"
    } catch (cause) {
      if (selected !== selection) return
      if (!remote.value) source.value = sample.value ? "sample" : "error"
      error.value = cause instanceof Error ? cause.message : "解析失败"
    } finally {
      if (selected === selection) loading.value = false
    }
  }

  watch([passageId, word, sentence], () => { void loadCache() }, { immediate: true })
  return { analysis, source, loading, error, explain }
}
