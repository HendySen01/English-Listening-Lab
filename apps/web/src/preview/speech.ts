import { ref } from "vue"

import { normalizeSpeechRate, speechRates } from "../lib/speechRates"
export const previewRates = speechRates
const stored = Number(sessionStorage.getItem("ell-preview-rate"))
export const previewRate = ref<number>(normalizeSpeechRate(stored))

export type SpeechRecord = {
  rate: number
  text: string
  voice: string
  startedAt: number
  endedAt: number
  durationMs: number
  event: "end" | "error" | "cancelled"
  error?: string
}

export const speechLog = ref<SpeechRecord[]>([])
let generation = 0
let pendingTimer = 0

function englishVoice() {
  const voices = window.speechSynthesis?.getVoices() || []
  return voices.find((item) => item.lang.toLowerCase() === "en-us")
    || voices.find((item) => item.lang.toLowerCase().startsWith("en"))
    || null
}

export function choosePreviewRate(next: number) {
  previewRate.value = normalizeSpeechRate(next)
  sessionStorage.setItem("ell-preview-rate", String(previewRate.value))
}

export function stopEnglish() {
  generation += 1
  window.clearTimeout(pendingTimer)
  window.speechSynthesis?.cancel()
}

export function speakEnglish(text: string, rate = previewRate.value, onDone?: (message: string) => void) {
  const id = ++generation
  window.clearTimeout(pendingTimer)
  if (!("speechSynthesis" in window)) {
    onDone?.("这台浏览器不能朗读")
    return Promise.resolve<SpeechRecord>({
      rate, text, voice: "", startedAt: 0, endedAt: 0, durationMs: 0, event: "error", error: "unsupported",
    })
  }
  window.speechSynthesis.cancel()
  return new Promise<SpeechRecord>((resolve) => {
    pendingTimer = window.setTimeout(() => {
      if (id !== generation) {
        resolve({ rate, text, voice: "", startedAt: 0, endedAt: 0, durationMs: 0, event: "cancelled" })
        return
      }
      const synth = window.speechSynthesis
      const utter = new SpeechSynthesisUtterance(text)
      const voice = englishVoice()
      utter.lang = voice?.lang || "en-US"
      if (voice) utter.voice = voice
      utter.rate = rate
      utter.pitch = 1
      const startedAt = performance.now()
      onDone?.(`浏览器语音 · ${rate}×`)
      const finish = (event: SpeechRecord["event"], error?: string) => {
        if (id !== generation && event !== "cancelled") return
        const endedAt = performance.now()
        const record: SpeechRecord = {
          rate,
          text,
          voice: voice?.name || "系统默认英语语音",
          startedAt,
          endedAt,
          durationMs: Math.round(endedAt - startedAt),
          event,
          error,
        }
        if (event === "end") {
          speechLog.value = [...speechLog.value, record].slice(-12)
          onDone?.(`浏览器语音 · ${rate}× · 用时 ${(record.durationMs / 1000).toFixed(1)} 秒`)
        } else if (event === "error") onDone?.(`浏览器没有开始朗读${error ? ` · ${error}` : ""}`)
        resolve(record)
      }
      utter.onend = () => finish("end")
      utter.onerror = (event) => {
        if (id !== generation || event.error === "interrupted" || event.error === "canceled") finish("cancelled", event.error)
        else finish("error", event.error)
      }
      synth.resume()
      synth.speak(utter)
    }, 80)
  })
}

if ("speechSynthesis" in window) window.speechSynthesis.getVoices()
