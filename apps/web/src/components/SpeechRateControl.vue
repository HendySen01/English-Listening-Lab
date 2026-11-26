<template>
  <span class="speed-control" role="group" aria-label="语速">
    <button v-for="option in options" :key="option.rate" type="button" :aria-pressed="store.speechRate === option.rate" :disabled="store.speechRateBusy" @click="store.setSpeechRate(option.rate)" :aria-label="option.rate + '× ' + option.label">
      <strong>{{ option.rate }}×</strong><small>{{ option.label }}</small>
    </button>
  </span>
</template>
<script setup lang="ts">
import { speechRates, useAppStore } from "../stores/app";
const store = useAppStore();
const labels = ["慢速","正常","快速"];
const options = speechRates.map((rate,index)=>({rate,label:labels[index]}));
</script>
<style scoped>
.speed-control {display:inline-flex;max-width:100%;width:fit-content;gap:3px;align-items:center;flex-wrap:wrap;padding:3px;background:var(--surface-muted);border:1px solid var(--line);border-radius:14px;vertical-align:middle}
.speed-control button {display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:56px;min-height:44px;padding:4px 10px;border:1px solid transparent;border-radius:11px;color:var(--muted);background:transparent;cursor:pointer;line-height:1.2}
.speed-control button[aria-pressed="true"] {background:var(--accent-soft);color:var(--accent-text);border-color:var(--selected);box-shadow:0 2px 0 var(--selected)}
.speed-control button:disabled {cursor:wait;opacity:.7}
.speed-control button:focus-visible {outline:2px solid var(--focus);outline-offset:2px}
.speed-control button:active:not(:disabled) {transform:translateY(1px)}
.speed-control strong {font-size:14px;font-weight:650}
.speed-control small {font-size:11px}
</style>
