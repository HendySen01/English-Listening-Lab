import { onMounted, onUnmounted } from "vue"

export function useStudyClock(module: string, lessonId: () => string | null) {
  let start = Date.now()
  let sent = false
  function flush() {
    if (sent) return
    const minutes = Math.floor((Date.now() - start) / 60000)
    if (minutes < 1) return
    sent = true
    void fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId: lessonId(), module, minutes }),
      keepalive: true,
    })
  }
  onMounted(() => {
    start = Date.now()
    window.addEventListener("pagehide", flush)
  })
  onUnmounted(() => {
    window.removeEventListener("pagehide", flush)
    flush()
  })
}
