<template>
  <div v-if="parts.length" class="rd-grid etymology-parts">
    <div v-for="part in parts" :key="part.label"><strong>{{ part.label }}</strong>{{ part.value }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { isEmptyPart } from "../lib/wordFormation"
import type { Analysis } from "./reader-data"

const props = defineProps<{ etymology: Analysis["etymology"] }>()
const parts = computed(() => {
  const root = props.etymology.root?.trim()
  const stem = (part: string) => part.replace(/^-|-$/g, "").toLowerCase()
  return (["prefix", "root", "suffix"] as const).flatMap(label => {
    const value = props.etymology[label]?.trim()
    if (!value || isEmptyPart(value) || (label !== "root" && root && stem(value) === stem(root))) return []
    return [{ label, value }]
  })
})
</script>

<style scoped>
.etymology-parts { display: flex; flex-wrap: wrap }
.etymology-parts > div { flex: 1 1 85px; min-width: 0; overflow-wrap: anywhere }
</style>
