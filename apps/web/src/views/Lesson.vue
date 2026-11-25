<template>
  <section class="stack" v-if="lesson">
    <div class="card lesson-head">
      <div>
        <p class="origin">{{ lesson.sourceLabel }}</p>
        <h2>{{ lesson.listening.title }}</h2>
        <p class="muted">{{ lessonMetadata(lesson) }}</p>
      </div>
      <div class="row">
        <button class="choice" @click="details = true">课程详情</button>
        <button class="choice" :disabled="generating" :aria-busy="generating" @click="makeAiVersion">{{ generating ? "正在生成…" : "重新生成课程" }}</button>
        <span class="generation-note" role="status">{{ generating ? "正在准备新课程，原课程仍保留。" : "每次生成使用一次 AI 请求，旧课程保留。" }}</span>
      </div>
      <p v-if="error" class="bad" role="alert">{{ error }}</p>
    </div>
    <el-dialog v-model="details" title="课程详情" width="min(520px, 92vw)">
      <p>{{ lessonMetadata(lesson) }}</p>
      <p>当前学习使用这一节课的单词、例句、听力和进度。换一版不会删除已经做过的复习。</p>
      <div class="stack">
        <button v-for="item in versions" :key="item.id" class="choice" :class="{ active: item.active }" @click="activate(item.id)">
          {{ item.sourceLabel }}<span v-if="item.difficulty"> · {{ lessonMetadata(item) }}</span><span v-if="item.active"> · 正在学习</span>
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
      <div v-if="!reviews.length" class="course-review-empty"><p class="muted">今天没有到期的旧词。可以进入新词。</p><button class="choice active" @click="go('vocabulary')">开始新词</button></div>
      <ReviewCard v-else :key="reviews[0].id" :item="reviews[0]" :remaining="reviews.length" @done="loadReviews" />
    </article>

    <article v-else-if="progress.step === 'vocabulary' && word">
      <p class="muted">新词 {{ progress.wordIndex + 1 }} / {{ lesson.words.length }}</p>
      <LessonWord :word="word" :lesson-id="lesson.id" @changed="reload" />
      <div class="row" style="margin-top: 12px">
        <button class="choice" @click="moveWord(-1)" :disabled="progress.wordIndex === 0">上一个</button>
        <button class="choice active" @click="moveWord(1)">{{ progress.wordIndex === lesson.words.length - 1 ? "进入下一步" : "下一个" }}</button>
      </div>
    </article>

    <LessonParts v-else-if="progress.step === 'parts'" :words="parts" :lesson-id="lesson.id" @next="go('listening')" />

    <LessonListening v-else-if="progress.step === 'listening'" :lesson="lesson" @save="save" />
    <ShadowPanel v-else-if="progress.step === 'shadow'" :lesson="lesson" @save="save" />

    <article class="card" v-else-if="progress.step === 'recall'">
      <h3>主动回忆 · 建议 5 分钟</h3>
      <p class="muted">先不看中文，凭记忆给今天的词打分。认识和能自己用，是两件事。</p>
      <div v-if="recallWord" class="stack">
        <h2 class="word">{{ recallWord.lemma }}</h2>
        <p>{{ recallWord.pos }} <span v-if="recallWord.ipa">{{ recallWord.ipa }}</span></p>
        <label class="row"><input type="checkbox" v-model="recognizeOnly" /> 我只是认得，还不能自己用</label>
        <div class="row">
          <button class="choice" :disabled="ratingBusy" @click="submitRating('again')">忘记</button>
          <button class="choice" :disabled="ratingBusy" @click="submitRating('hard')">困难</button>
          <button class="choice" :disabled="ratingBusy" @click="submitRating('good')">记得</button>
          <button class="choice" :disabled="ratingBusy" @click="submitRating('easy')">非常熟悉</button>
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
import { lessonMetadata } from "../lib/lessonMetadata";
import { api } from "../api";
import { progressStamp, withReviewRequest } from "../lib/reviewRequest";
import { useAppStore, type Lesson, type Progress } from "../stores/app";
import LessonWord from "../components/LessonWord.vue";
import { useStudyClock } from "../composables/useStudyClock";
import LessonListening from "../components/LessonListening.vue";
import ShadowPanel from "../components/ShadowPanel.vue";
import QuizBlock from "../components/QuizBlock.vue";
import ReviewCard from "../components/ReviewCard.vue";
import LessonParts from "../components/LessonParts.vue";

const route = useRoute();
const store = useAppStore();
const lesson = ref<Lesson | null>(null);
useStudyClock("lesson", () => lesson.value?.id || null);
const details = ref(false);
const reviews = ref<any[]>([]);
const versions = ref<Array<Lesson & { version: number; active: boolean }>>([]);
const error = ref("");
const ratingBusy = ref(false);
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
const word = computed(() => lesson.value?.words[progress.value.wordIndex] || null);
const parts = computed(() => lesson.value?.words.filter((item) => item.morphology).slice(0, 2) || []);
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
  if (!recallWord.value || ratingBusy.value) return;
  ratingBusy.value = true;
  try {
    await withReviewRequest(`formal:${recallWord.value.id}`, {
      rating,
      recallAbility: recognizeOnly.value ? "recognize" : "recall",
      progress: progressStamp(recallWord.value),
    }, (body) =>
      api(`/api/review/${recallWord.value.id}/rate`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    recognizeOnly.value = false;
    await reload();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "这次评分没有写入。";
    await reload();
  } finally {
    ratingBusy.value = false;
  }
}

async function loadVersions() {
  versions.value = await api("/api/lessons/today/versions");
}

const generating = ref(false);

async function makeAiVersion() {
  if (generating.value) return;
  error.value = "";
  generating.value = true;
  try {
    lesson.value = await api<Lesson>("/api/lessons/ai-version", {
      method: "POST",
      body: JSON.stringify({ confirmCost: true, clientRequestId: crypto.randomUUID() }),
    });
    await loadVersions();
    await store.load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "AI 生成失败，原课程仍可学习";
  } finally {
    generating.value = false;
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

<style scoped>
.generation-note { flex-basis: 100%; text-align: right; color: var(--muted); font-size: 12px; line-height: 1.5; }
@media (max-width: 600px) { .generation-note { text-align: left; } }
</style>
