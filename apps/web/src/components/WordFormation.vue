<template>
  <div class="formation">
    <div v-if="formation.parts.length" class="pieces">
      <template v-for="(part, index) in formation.parts" :key="index">
        <span v-if="index" aria-hidden="true">+</span>
        <div class="piece">
          <small>{{ formationLabel(part.kind) }}</small>
          <strong lang="en" translate="no">{{ formationText(part) }}</strong>
        </div>
      </template>
    </div>
    <div class="formation-lines" lang="en" translate="no">
      <template v-for="(part, index) in formation.parts" :key="index">
        <p v-if="part.explanationEn"><strong>{{ formationText(part) }}</strong> — {{ part.explanationEn }}</p>
      </template>
      <p v-if="formation.definitionEn"><strong>{{ word }}</strong> — {{ formation.definitionEn }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formationLabel, formationText, type WordFormation } from "../lib/wordFormation"

defineProps<{ word: string; formation: WordFormation }>()
</script>

<style scoped>
.formation { display: grid; gap: 12px }
.pieces { display: flex; flex-wrap: wrap; align-items: center; gap: 8px }
.piece { flex: 1 1 72px; min-width: 0; display: grid; gap: 4px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 12px }
.piece small { color: var(--muted) }
.piece strong { font-size: 20px; color: var(--accent-text); overflow-wrap: anywhere }
.formation-lines { display: grid; gap: 4px }
.formation-lines p { margin: 0; font-weight: 400 }
</style>
