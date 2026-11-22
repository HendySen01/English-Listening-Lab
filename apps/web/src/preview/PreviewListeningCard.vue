<template>
  <section class="pv-listen">
    <div class="pv-kicker">
      <span class="pv-badge">今日课程听力</span>
      <span class="pv-en" translate="no">{{ lesson.title }}</span>
    </div>
    <div class="pv-stage" role="tablist" aria-label="听力阶段">
      <button v-for="(label, i) in stages" :key="label" class="pv-btn" type="button" :aria-current="stage === i ? 'step' : undefined" @click="stage = i">{{ label }}</button>
    </div>

    <div class="pv-player">
      <button class="pv-play" type="button" @click="toggle">{{ playing ? "暂停" : "播放" }}</button>
      <button class="pv-btn" type="button" @click="replay">重播</button>
      <button v-for="item in rates" :key="item" class="pv-btn" type="button" :aria-pressed="rate === item" @click="rate = item">{{ item }}×</button>
      <div>
        <strong>{{ voice }}</strong>
        <div class="pv-muted">{{ status }} · 第 {{ current + 1 }} 句</div>
      </div>
    </div>
    <p v-if="error" class="pv-toast" role="alert">{{ error }}</p>

    <div class="pv-columns">
      <article class="pv-card">
        <h2 class="pv-section-title">{{ stageTitle }}</h2>
        <p class="pv-muted">{{ stageHelp }}</p>
        <div v-if="showText" class="pv-script">
          <p v-for="(sentence, sIndex) in previewSentences" :key="sentence">
            <button class="pv-btn pv-sentence-play" type="button" @click="playSentence(sIndex)">读这句</button>
            <template v-for="(token, tIndex) in tokens(sentence)" :key="sIndex + '-' + tIndex">
              <button
                v-if="clean(token)"
                class="pv-token"
                type="button"
                translate="no"
                :data-state="stateOf(token)"
                :aria-pressed="selected === clean(token)"
                @click="select(token)"
              >{{ token }}</button>
              <span v-else>{{ token }}</span>
            </template>
          </p>
          <p class="pv-muted">下划线是待学习，加粗是重点。文字标签在右侧，不只靠颜色。</p>
        </div>
        <label v-if="stage === 0" class="pv-fold">
          这段话大概在说什么？
          <textarea v-model="gist" rows="3" style="width: 100%; margin-top: 8px; border: 1px solid var(--pv-border); border-radius: 10px; padding: 12px; background: var(--pv-surface);"></textarea>
        </label>
        <label v-if="stage === 3" class="pv-fold">
          用中文或简单英文写下主要意思。
          <textarea v-model="recall" rows="4" style="width: 100%; margin-top: 8px; border: 1px solid var(--pv-border); border-radius: 10px; padding: 12px; background: var(--pv-surface);"></textarea>
          <button class="pv-btn" type="button" @click="checkRecall">对照原文</button>
          <p v-if="recallNote" class="pv-toast" role="status">{{ recallNote }}</p>
        </label>
      </article>

      <aside class="pv-card pv-panel" :class="{ 'is-drawer': selected && narrow }" v-if="selected || !narrow">
        <div class="pv-row" style="justify-content: space-between;">
          <h2 class="pv-section-title">{{ selectedWord ? selectedWord.lemma : "词义" }}</h2>
          <button v-if="narrow && selected" class="pv-btn" type="button" @click="selected = ''">关闭</button>
        </div>
        <template v-if="selectedWord">
          <p class="pv-meaning">{{ selectedWord.meaning }}</p>
          <p class="pv-muted">状态：{{ selectedWord.state }}</p>
          <p class="pv-en" translate="no">{{ selectedWord.definition }}</p>
          <p class="pv-muted">当前句：{{ previewSentences[current] }}</p>
          <div class="pv-row">
            <button class="pv-btn" type="button" @click="speak(selectedWord.lemma)">读这个词</button>
            <button class="pv-btn" type="button" @click="saved = true">加入词汇库</button>
            <button class="pv-btn quiet" type="button" @click="explain = true"><Sparkles aria-hidden="true" :size="16" />AI 解释</button>
          </div>
          <p v-if="saved" class="pv-toast">预览里只做了标记，没有写入词汇库。</p>
          <p v-if="explain" class="pv-toast">预览说明：{{ selectedWord.lemma }} 在这句里是「{{ selectedWord.meaning }}」。没有调用 AI。</p>
        </template>
        <p v-else class="pv-muted">点击原文里的单词，这里显示词义和当前句子。</p>
      </aside>
    </div>
    <div v-if="selected && narrow" class="pv-drawer-backdrop" @click="selected = ''"></div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Sparkles } from "lucide-vue-next";
import { glosses, previewLesson, previewSentences } from "./sample";

const lesson = previewLesson;
const stages = ["1 盲听", "2 原文", "3 再听", "4 回忆"];
const rates = [0.8, 1, 1.2];
const stage = ref(0);
const playing = ref(false);
const voice = ref("尚未播放");
const status = ref("空闲");
const error = ref("");
const current = ref(0);
const rate = ref(1);
const gist = ref("");
const recall = ref("");
const recallNote = ref("");
const selected = ref("");
const saved = ref(false);
const explain = ref(false);
const narrow = ref(window.matchMedia("(max-width: 767px)").matches);
const media = window.matchMedia("(max-width: 767px)");
media.addEventListener("change", onMedia);
function onMedia() { narrow.value = media.matches; }
onBeforeUnmount(() => {
  media.removeEventListener("change", onMedia);
  window.speechSynthesis?.cancel();
});

let playToken = 0;
const showText = computed(() => stage.value === 1);
const stageTitle = computed(() => ["先听，不看原文", "对照原文", "再听一遍", "回忆大意"][stage.value]);
const stageHelp = computed(() => [
  "播放的是这节示例课的三句话。",
  "点单词查看词义。下划线表示待学习，加粗表示重点。",
  "原文先收起来。刚才写下的理解还留在盲听页。",
  "不要求逐字背诵。这里只用原文关键词做对照。",
][stage.value]);

const selectedWord = computed(() => {
  if (!selected.value) return null;
  const item = glosses[selected.value];
  if (!item) return { lemma: selected.value, meaning: "这句里没有单独收录", definition: "可以继续听整句。", state: "未收录" };
  return { lemma: selected.value, ...item };
});

function clean(token: string) {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}
function tokens(sentence: string) {
  return sentence.match(/[A-Za-z']+|[^A-Za-z']+/g) || [sentence];
}
function stateOf(token: string) {
  return glosses[clean(token)]?.state || "";
}
function select(token: string) {
  const key = clean(token);
  if (!key) return;
  selected.value = key;
  saved.value = false;
  explain.value = false;
}

function speak(text: string, done?: () => void) {
  if (!("speechSynthesis" in window)) {
    error.value = "这台浏览器不能朗读。可以改用系统语音后再试。";
    status.value = "未能播放";
    return;
  }
  error.value = "";
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.rate = rate.value;
  playing.value = true;
  status.value = "正在播放";
  voice.value = "浏览器语音";
  utter.onend = () => {
    playing.value = false;
    status.value = "空闲";
    done?.();
  };
  utter.onerror = () => {
    playing.value = false;
    status.value = "未能播放";
    error.value = "浏览器没有开始朗读。可以点重播再试。";
  };
  window.speechSynthesis.speak(utter);
}

function playSentence(index: number) {
  current.value = index;
  speak(previewSentences[index]);
}

function playAll(from = 0) {
  const token = ++playToken;
  const step = (index: number) => {
    if (token !== playToken) return;
    current.value = index;
    speak(previewSentences[index], () => {
      if (token !== playToken) return;
      if (index + 1 < previewSentences.length) step(index + 1);
    });
  };
  step(from);
}

function toggle() {
  if (playing.value) {
    playToken += 1;
    window.speechSynthesis?.cancel();
    playing.value = false;
    status.value = "已暂停";
    return;
  }
  playAll(current.value);
}

function replay() {
  playToken += 1;
  window.speechSynthesis?.cancel();
  playAll(0);
}

function checkRecall() {
  const text = recall.value.trim();
  if (!text) {
    recallNote.value = "先写一句大意，再对照。";
    return;
  }
  const hit = /bus|公交|schedule|日程|appointment|预约/i.test(text);
  recallNote.value = hit
    ? "提到了等车或日程。这是本地关键词对照，不是 AI 评分。"
    : "可以补一句：他在等车，还看了日程。这是本地对照，不是 AI 评分。";
}
</script>
