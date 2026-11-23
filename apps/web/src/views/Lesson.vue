<template>
  <section class="stack" v-if="lesson">
    <div class="card lesson-head">
      <div>
        <p class="origin">{{ lesson.sourceLabel }}</p>
        <h2>{{ lesson.listening.title }}</h2>
        <p class="muted">{{ lesson.themeLabel }} · {{ lesson.difficulty }} · {{ lesson.newWordCount }} 个新词 · 约 {{ lesson.estimatedMinutes }} 分钟</p>
      </div>
      <div class="row">
        <button class="choice" @click="details = true">课程详情</button>
        <button class="choice" @click="makeAiVersion">重新生成课程</button>
      </div>
      <p v-if="error" class="bad">{{ error }}</p>
    </div>
    <el-dialog v-model="details" title="课程详情" width="520px">
      <p>当前学习使用这一节课的单词、例句、听力和进度。换一版不会删除已经做过的复习。</p>
      <div class="stack">
        <button v-for="item in versions" :key="item.id" class="choice" :class="{ active: item.active }" @click="activate(item.id)">
          {{ item.sourceLabel }}<span v-if="item.active"> · 正在学习</span>
        </button>
      </div>
    </el-dialog>
    <div class="flow" aria-label="学习步骤">
      <button v-for="(step, index) in steps" :key="step.id" class="step" :class="{ current: progress.step === step.id, done: progress.completed?.includes(step.id) }" @click="go(step.id)">
        {{ index + 1 }} {{ step.label }}
      </button>
    </div>

    <article class="card" v-if="progress.step === 'review'">
      <h3>旧词复习 · 建议 10 分钟</h3>
      <p v-if="!reviews.length" class="muted">今天没有到期的旧词。可以进入新词。</p>
      <ReviewCard v-else :item="reviews[0]" @done="loadReviews" />
    </article>

    <article v-else-if="progress.step === 'vocabulary' && word">
      <p class="muted">新词 {{ progress.wordIndex + 1 }} / {{ lesson.words.length }}</p>
      <LessonWord :word="word" :lesson-id="lesson.id" @changed="reload" />
      <div class="row" style="margin-top: 12px">
        <button class="choice" @click="moveWord(-1)" :disabled="progress.wordIndex === 0">上一个</button>
        <button class="choice active" @click="moveWord(1)">{{ progress.wordIndex === lesson.words.length - 1 ? "进入下一步" : "下一个" }}</button>
      </div>
    </article>

    <article class="card" v-else-if="progress.step === 'parts'">
      <h3>词根词缀 · 最多 2 个</h3>
      <p v-if="!parts.length" class="muted">今天的词没有足够明确的构词，不强行拆分。</p>
      <div v-for="item in parts" :key="item.id" class="stack" style="margin-bottom: 12px">
        <h2 class="word" style="font-size: 32px">{{ item.lemma }}</h2>
        <p>{{ item.morphology?.prefix || "无前缀" }} + {{ item.morphology?.root }} + {{ item.morphology?.suffix || "无后缀" }}</p>
        <p>{{ item.morphology?.meaningZh }}</p>
        <p>{{ item.morphology?.example }}</p>
      </div>
      <button class="choice active" @click="go('listening')">去听</button>
    </article>

    <LessonListening v-else-if="progress.step === 'listening'" :lesson="lesson" @save="save" />
    <ShadowPanel v-else-if="progress.step === 'shadow'" :lesson="lesson" :rate="rate" @save="save" />

    <article class="card" v-else-if="progress.step === 'recall'">
      <h3>主动回忆 · 建议 5 分钟</h3>
      <p class="muted">先不看中文，凭记忆给今天的词打分。认识和能自己用，是两件事。</p>
      <div v-if="recallWord" class="stack">
        <h2 class="word">{{ recallWord.lemma }}</h2>
        <p>{{ recallWord.pos }} <span v-if="recallWord.ipa">{{ recallWord.ipa }}</span></p>
        <label class="row"><input type="checkbox" v-model="recognizeOnly" /> 我只是认得，还不能自己用</label>
        <div class="row">
          <button class="choice" @click="submitRating('again')">忘记</button>
          <button class="choice" @click="submitRating('hard')">困难</button>
          <button class="choice" @click="submitRating('good')">记得</button>
          <button class="choice" @click="submitRating('easy')">非常熟悉</button>
        </div>
        <p class="muted" v-if="recallWord.intervals">大约：忘记 {{ recallWord.intervals.again }} 天，困难 {{ recallWord.intervals.hard }} 天，记得 {{ recallWord.intervals.good }} 天，非常熟悉 {{ recallWord.intervals.easy }} 天。这是 FSRS 排出的间隔。</p>
      </div>
      <div v-else>
        <p class="ok">今天的新词已经进入复习计划。</p>
        <QuizBlock :lesson="lesson" @changed="reload" />
      </div>
    </article>
  </section>
  <p v-else-if="error" class="bad">{{ error }}</p>
  <p v-else>正在打开课程……</p>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { useAppStore, type Lesson, type Progress } from "../stores/app";
import LessonWord from "../components/LessonWord.vue";
import LessonListening from "../components/LessonListening.vue";
import ShadowPanel from "../components/ShadowPanel.vue";
import QuizBlock from "../components/QuizBlock.vue";
import ReviewCard from "../components/ReviewCard.vue";

const route = useRoute();
const store = useAppStore();
const lesson = ref<Lesson | null>(null);
const details = ref(false);
const reviews = ref<any[]>([]);
const versions = ref<Array<{ id: string; version: number; active: boolean; source: string; sourceLabel: string }>>([]);
const error = ref("");
const recognizeOnly = ref(false);
const steps = [
  { id: "review", label: "复习" },
  { id: "vocabulary", label: "新词" },
  { id: "parts", label: "词根" },
  { id: "listening", label: "听力" },
  { id: "shadow", label: "跟读" },
  { id: "recall", label: "回忆" },
];
const progress = computed(() => lesson.value?.progress as Progress);
const rate = computed(() => store.dashboard?.settings.speechRate || 1);
const word = computed(() => lesson.value?.words[progress.value.wordIndex] || null);
const parts = computed(() => lesson.value?.words.filter((item) => item.morphology) || []);
const recallWord = computed(() => lesson.value?.words.find((item) => item.reps === 0 && !item.knownAlready) || null);

async function reload() {
  const id = String(route.params.id || store.dashboard?.lesson?.id || "");
  if (!id) {
    const created = await api<Lesson>("/api/lessons/today", { method: "POST" });
    lesson.value = created;
    return;
  }
  lesson.value = await api<Lesson>(`/api/lessons/${id}`);
}

async function loadReviews() {
  const data = await api<{ items: any[] }>("/api/review");
  reviews.value = data.items;
}

async function save(next?: Progress) {
  if (!lesson.value) return;
  lesson.value = await api<Lesson>(`/api/lessons/${lesson.value.id}/progress`, {
    method: "PATCH",
    body: JSON.stringify({ progress: next || lesson.value.progress }),
  });
}

async function go(step: string) {
  if (!lesson.value) return;
  const next = { ...lesson.value.progress, step };
  if (!next.completed.includes(lesson.value.progress.step)) next.completed = [...next.completed, lesson.value.progress.step];
  await save(next);
}

async function moveWord(delta: number) {
  if (!lesson.value) return;
  const index = lesson.value.progress.wordIndex + delta;
  if (index >= lesson.value.words.length) {
    await go(store.dashboard?.settings.wordPartsEnabled === false ? "listening" : "parts");
    return;
  }
  await save({ ...lesson.value.progress, wordIndex: Math.max(0, index) });
}

async function submitRating(rating: string) {
  if (!recallWord.value) return;
  await api(`/api/review/${recallWord.value.id}/rate`, {
    method: "POST",
    body: JSON.stringify({ rating, recallAbility: recognizeOnly.value ? "recognize" : "recall" }),
  });
  recognizeOnly.value = false;
  await reload();
}

async function loadVersions() {
  versions.value = await api("/api/lessons/today/versions");
}

async function makeAiVersion() {
  if (!confirm("重新生成会再调用一次 AI，可能产生费用。现在这节课会保留，可以在课程详情里切换回来。继续吗？")) return;
  error.value = "";
  try {
    lesson.value = await api<Lesson>("/api/lessons/ai-version", { method: "POST", body: JSON.stringify({ confirmCost: true }) });
    await loadVersions();
    await store.load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "AI 生成失败，原课程仍可学习";
  }
}

async function activate(id: string) {
  lesson.value = await api<Lesson>(`/api/lessons/${id}/activate`, { method: "POST" });
  details.value = false;
  await loadVersions();
  await store.load();
}

onMounted(async () => {
  try {
    if (!store.dashboard) await store.load();
    await reload();
    await loadVersions();
    await loadReviews();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "课程打开失败";
  }
});
watch(() => route.params.id, reload);
</script>
