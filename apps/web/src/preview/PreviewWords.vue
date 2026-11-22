<template>
  <section class="rd">
    <div class="rd-tools" style="justify-content: space-between;">
      <div>
        <p class="rd-kicker">新词 {{ String(index + 1).padStart(2, "0") }} / 06 · {{ lesson.title }}</p>
        <h1 class="rd-title">一次看一个词，解释放在旁边。</h1>
      </div>
      <router-link class="rd-pill" to="/preview/context">去语境阅读</router-link>
    </div>
    <div class="rd-frame">
      <div class="rd-read">
        <div class="rd-meta">
          <h2 class="rd-word" translate="no">{{ lemma }}</h2>
          <button class="rd-icon" type="button" :aria-label="`朗读 ${lemma}`" @click="speakEnglish(lemma, 1, (message) => voice = message)"><Volume2 aria-hidden="true" :size="18" /></button>
        </div>
        <p class="rd-meta" translate="no">
          <span>{{ analysis?.pronunciation || "没有单独标音标" }}</span><span>·</span><span>{{ analysis?.partOfSpeech }}</span><span>·</span><span>{{ voice }}</span>
          <button class="rd-pill leaf" type="button" @click="speakEnglish(passage.sentence, 1, (message) => voice = message)">读例句</button>
        </p>
        <p class="rd-sentence" style="font-size: clamp(22px, 2.4vw, 32px)" translate="no">
          <template v-for="(token, tokenIndex) in tokens" :key="tokenIndex">
            <button v-if="token.key" class="rd-token" type="button" :aria-pressed="selected === token.key" @click="selected = token.key">{{ token.text }}</button>
            <span v-else>{{ token.text }}</span>
          </template>
        </p>
        <BlurText :text="passage.translation" :clear="clear" @toggle="clear = !clear" />
        <div class="rd-tools" style="margin-top: 16px">
          <button class="rd-pill" type="button" @click="prev" :disabled="index === 0">上一个</button>
          <button class="rd-pill primary" type="button" @click="next">{{ index === wordPassages.length - 1 ? "去听力" : "下一个" }}</button>
        </div>
      </div>
      <ReaderNotes :key="passage.id + selected" :word="selected" :analysis="analysis" :mark="marks[cacheKey(passage.id, selected)] || ''" @speak="speakEnglish($event, 1, (message) => voice = message)" @mark="setMark" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { useRouter } from "vue-router"
import { Volume2 } from "lucide-vue-next"
import BlurText from "./BlurText.vue"
import ReaderNotes from "./ReaderNotes.vue"
import { cacheKey, lookupAnalysis, speakEnglish, tokenize, wordPassages } from "./reader-data"
import { previewLesson } from "./sample"
import "./reader.css"

const router = useRouter()
const lesson = previewLesson
const index = ref(0)
const selected = ref("curious")
const clear = ref(false)
const voice = ref("尚未播放")
const marks = ref<Record<string, "known" | "again">>({})
const passage = computed(() => wordPassages[index.value])
const lemma = computed(() => passage.value.id.replace("word-", ""))
const tokens = computed(() => tokenize(passage.value.sentence))
const analysis = computed(() => lookupAnalysis(passage.value.id, selected.value))

function shift(nextIndex: number) {
  index.value = nextIndex
  selected.value = wordPassages[nextIndex].id.replace("word-", "")
  clear.value = false
}
function prev() { if (index.value > 0) shift(index.value - 1) }
function next() {
  if (index.value === wordPassages.length - 1) {
    void router.push("/preview/listening")
    return
  }
  shift(index.value + 1)
}
function setMark(value: "known" | "again") {
  marks.value = { ...marks.value, [cacheKey(passage.value.id, selected.value)]: value }
}
</script>
