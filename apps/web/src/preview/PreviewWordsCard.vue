<template>
  <section class="pv-study">
    <div class="pv-study-top">
      <div>
        <p class="pv-kicker"><span class="pv-badge">新词</span><span>{{ lesson.title }}</span></p>
        <p class="pv-index">{{ String(index + 1).padStart(2, "0") }} / 06</p>
      </div>
      <p class="pv-muted">{{ lesson.level }} · {{ lesson.theme }}</p>
    </div>
    <div class="pv-progress" role="progressbar" aria-valuemin="1" aria-valuemax="6" :aria-valuenow="index + 1" aria-label="单词进度">
      <span :style="{ width: ((index + 1) / 6) * 100 + '%' }"></span>
    </div>

    <article class="pv-card" :key="word.lemma">
      <div class="pv-wordline">
        <h2 class="pv-word" translate="no">{{ word.lemma }}<span class="pv-pos">{{ word.pos }}</span></h2>
        <button class="pv-icon-btn" type="button" :aria-label="`读这个词：${word.lemma}`" @click="speak(word.lemma)">
          <Volume2 aria-hidden="true" :size="20" />
        </button>
        <span class="pv-voice">{{ voice }}</span>
      </div>
      <p class="pv-meaning">{{ word.meaning }}</p>
      <p class="pv-definition pv-en" translate="no">{{ word.definition }}</p>
      <p class="pv-example" translate="no">
        <span>{{ shownExample }}</span>
        <button class="pv-icon-btn" type="button" aria-label="读例句" @click="speak(shownExample)">
          <Volume2 aria-hidden="true" :size="18" />
        </button>
      </p>
      <p class="pv-zh">{{ word.exampleZh }}</p>
      <p class="pv-meta-line">
        搭配：<span class="pv-en" translate="no">{{ word.collocation }}</span>
        <span aria-hidden="true"> · </span>
        <span>{{ word.stress }}。没有可靠音标，所以不显示 IPA。</span>
      </p>

      <div class="pv-assist" role="group" aria-label="辅助操作">
        <button class="pv-btn ghost" type="button" :aria-expanded="morph" @click="morph = !morph">{{ morph ? "收起词根" : "查看词根" }}</button>
        <button class="pv-btn ghost" type="button" :disabled="aiState === 'loading'" @click="simplify">
          <Sparkles aria-hidden="true" :size="16" />
          {{ aiState === "loading" ? "正在生成…" : "AI 简化例句" }}
        </button>
        <button v-if="aiState === 'cached'" class="pv-btn ghost" type="button" @click="restore">恢复原句</button>
      </div>
      <p v-if="morph" class="pv-morph">{{ word.morphology }}</p>
      <p v-if="aiState === 'cached'" class="pv-toast" role="status">这是预览里写好的短句，没有调用 AI。原句还在，可以恢复。</p>

      <p v-if="feedback" class="pv-toast" role="status">{{ feedback }}</p>
      <div class="pv-actions">
        <div class="pv-feedback" role="group" aria-label="学习反馈">
          <button class="pv-btn secondary" type="button" :aria-pressed="mark === 'known'" @click="setMark('known')">我已认识</button>
          <button class="pv-btn secondary strengthen" type="button" :aria-pressed="mark === 'again'" @click="setMark('again')">需要加强</button>
        </div>
        <div class="pv-move">
          <button class="pv-btn ghost" type="button" @click="prev" :disabled="index === 0">上一个</button>
          <button class="pv-btn primary" type="button" @click="next">{{ index === previewWords.length - 1 ? "去听力" : "下一个" }}</button>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { Sparkles, Volume2 } from "lucide-vue-next";
import { previewLesson, previewWords } from "./sample";

const router = useRouter();
const lesson = previewLesson;
const index = ref(1);
const morph = ref(false);
const feedback = ref("");
const mark = ref<"" | "known" | "again">("");
const voice = ref("尚未播放");
const aiState = ref<"idle" | "loading" | "cached">("idle");
const useSimple = ref(false);
const word = computed(() => previewWords[index.value]);
const shownExample = computed(() => (useSimple.value ? word.value.simpler : word.value.example));

function speak(text: string) {
  if (!("speechSynthesis" in window)) {
    voice.value = "这台浏览器没有语音";
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.onend = () => { voice.value = "浏览器语音 · 已读完"; };
  window.speechSynthesis.speak(utter);
  voice.value = "浏览器语音";
}

function simplify() {
  aiState.value = "loading";
  window.setTimeout(() => {
    useSimple.value = true;
    aiState.value = "cached";
  }, 700);
}

function restore() {
  useSimple.value = false;
  aiState.value = "idle";
}

function setMark(next: "known" | "again") {
  mark.value = next;
  feedback.value = next === "known"
    ? "已记为认识。预览没有写入记忆记录。"
    : "已标成需要加强。预览没有改变复习时间。";
}

function prev() {
  if (index.value === 0) return;
  index.value -= 1;
  resetCard();
}

function next() {
  if (index.value === previewWords.length - 1) {
    void router.push("/preview/listening");
    return;
  }
  index.value += 1;
  resetCard();
}

function resetCard() {
  morph.value = false;
  feedback.value = "";
  mark.value = "";
  useSimple.value = false;
  aiState.value = "idle";
}
</script>
