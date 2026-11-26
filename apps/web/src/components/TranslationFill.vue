<template>
  <div v-if="missing" class="translation-fill">
    <div><strong>补齐本课译文</strong><p class="rd-note">还有 {{ missing }} 句没有译文。已有内容直接复用，必要时使用一次 AI 额度。</p></div>
    <button class="rd-pill" type="button" :disabled="busy" @click="$emit('complete')">{{ busy?"正在补充…":"补齐中文译文" }}</button>
    <p v-if="error" class="bad" role="alert">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
defineProps<{missing:number;busy:boolean;error:string}>();
defineEmits<{complete:[]}>();
</script>
<style scoped>
.translation-fill{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:12px;padding:12px;margin:12px 0}
.translation-fill strong{font-size:14px;color:var(--accent-text)}.translation-fill p{margin:4px 0 0}.translation-fill .rd-pill{min-height:44px}.translation-fill .bad{flex-basis:100%}
</style>
