<template>
  <div
    ref="clip"
    class="rd-fold"
    :class="{ 'is-open': open, 'is-scroll': scrollable }"
    :style="{ height: height + 'px' }"
    :inert="open ? undefined : true"
    @transitionend="onEnd"
  >
    <div ref="body" class="rd-fold-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"

const props = withDefaults(defineProps<{ open: boolean; limit?: boolean }>(), { limit: true })
const clip = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const height = ref(0)
const full = ref(0)
const cap = ref(560)
const narrow = ref(false)
const settled = ref(false)
const motion = ref(false)
let observer: ResizeObserver | undefined

const scrollable = computed(() => props.limit && !narrow.value && settled.value && full.value > cap.value + 12)

function readFrame() {
  cap.value = Math.round(Math.min(620, Math.max(480, window.innerHeight * 0.58)))
  narrow.value = window.matchMedia("(max-width: 900px)").matches
  motion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function target() {
  if (!props.open) return 0
  if (!props.limit || narrow.value) return full.value
  return Math.min(full.value, cap.value)
}

function apply(animate: boolean) {
  full.value = body.value?.scrollHeight ?? 0
  const next = target()
  const node = clip.value
  if (!animate || motion.value) {
    node?.style.setProperty("transition", "none")
    height.value = next
    settled.value = props.open
    requestAnimationFrame(() => node?.style.removeProperty("transition"))
    return
  }
  if (!props.open) settled.value = false
  height.value = next
}

function onEnd(event: TransitionEvent) {
  if (event.propertyName !== "height" || event.target !== clip.value) return
  settled.value = props.open
}

watch(() => props.open, (value) => {
  if (value && clip.value) clip.value.scrollTop = 0
  apply(true)
})

function onResize() {
  readFrame()
  if (props.open) apply(true)
}

onMounted(() => {
  readFrame()
  window.addEventListener("resize", onResize)
  observer = new ResizeObserver(() => {
    const next = body.value?.scrollHeight ?? 0
    if (next === full.value) return
    full.value = next
    if (props.open) apply(true)
  })
  if (body.value) observer.observe(body.value)
  apply(false)
})

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize)
  observer?.disconnect()
})
</script>
