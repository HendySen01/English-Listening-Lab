<template>
  <div class="rd-trans">
    <p class="rd-trans-text" :class="{ 'is-blurred': !clear }" :aria-hidden="!clear" translate="no" @click="$emit('toggle')">{{ text }}</p>
    <button class="rd-pill" type="button" :aria-pressed="clear" :aria-label="clear ? '隐藏翻译' : '显示翻译'" @click="$emit('toggle')">
      {{ clear ? "隐藏翻译" : "显示翻译" }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ text: string; clear: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<style scoped>
.rd-trans-text { cursor: pointer; overflow-wrap: anywhere; }
.rd-trans .rd-pill { min-height: 44px; flex-shrink: 0; }
</style>
