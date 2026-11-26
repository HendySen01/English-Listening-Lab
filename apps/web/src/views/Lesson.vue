<template>
  <section class="stack" v-if="lesson">
    <div class="card lesson-head">
      <div>
        <p class="origin">{{ lesson.sourceLabel }}</p>
        <h2>{{ lesson.listening.title }}</h2>
        <p class="muted">{{ lessonMetadata(lesson) }}</p>
      </div>
      <div class="row">
        <button class="choice"  :disabled="saving || generating || childBusy" @click="details = true">课程详情</button>
        <button class="choice" :disabled="generating || saving || childBusy" :aria-busy="generating" @click="makeAiVersion">{{ generating ? "正在生成…" : "重新生成课程" }}</button>
        <span class="generation-note" role="status">{{ generating ? "正在准备新课程，原课程仍保留。" : "每次生成使用一次 AI 请求，旧课程保留。" }}</span>
      </div>
      <p v-if="error" class="bad" role="alert">{{ error }}</p>
    </div>
    <el-dialog v-model="details" title="课程详情" width="min(520px, 92vw)">
      <p>{{ lessonMetadata(lesson) }}</p>
      <p>当前学习使用这一节课的单词、例句、听力和进度。换一版不会删除已经做过的复习。</p>
      <div class="stack">
        <button v-for="item in versions" :key="item.id" class="choice" :class="{ active: item.active }" :disabled="saving || generating || childBusy" @click="activate(item.id)">
          {{ item.sourceLabel }}<span v-if="item.difficulty"> · {{ lessonMetadata(item) }}</span><span v-if="item.active"> · 正在学习</span>
        </button>
      </div>
    </el-dialog>
    <div class="course-path card">
      <div class="path-header"><div><p class="origin">YOUR LEARNING PATH</p><h3>{{ currentStep.english }}</h3><p class="muted">{{ currentStep.description }}</p></div><strong>{{ doneCount }} / {{ steps.length }} 已完成</strong></div>
      <div class="progress-track" role="progressbar" aria-label="课程进度" :aria-valuemin="0" :aria-valuemax="steps.length" :aria-valuenow="doneCount"><span :style="{width: doneCount / steps.length * 100 + '%'}"></span></div>
      <div class="flow" aria-label="学习步骤">
      <button v-for="(step, index) in steps" :key="step.id" class="step" :class="{ current: progress.step === step.id, done: progress.completed?.includes(step.id) }"  :aria-current="progress.step === step.id ? 'step' : undefined" :aria-label="`${index + 1} ${step.label}`" :disabled="saving || generating || childBusy" @click="go(step.id)">
        <span>{{ index + 1 }} {{ step.label }}</span><small>{{ progress.completed.includes(step.id) ? "✓ 已完成" : progress.step === step.id ? "进行中" : "未完成" }}</small>
      </button>
      </div>
      <p v-if="saving" class="muted" role="status">正在保存学习进度…</p>
    </div>

    <article class="card" v-if="progress.step === 'review'">
      <h3>旧词复习 · 建议 10 分钟</h3>
      <div v-if="!reviews.length" class="course-review-empty"><p class="muted">今天没有到期的旧词。可以进入新词。</p><button class="choice active" :disabled="saving" @click="go('vocabulary', true)">开始新词</button></div>
      <ReviewCard v-else :key="reviews[0].id" :item="reviews[0]" :remaining="reviews.length" @done="loadReviews" />
    </article>

    <article v-else-if="progress.step === 'vocabulary' && word">
      <p class="muted">新词 {{ progress.wordIndex + 1 }} / {{ lesson.words.length }}</p>
      <LessonWord :key="word.id" :word="word" :lesson-id="lesson.id" @changed="refreshCurrent" />
      <div class="row" style="margin-top: 12px">
        <button class="choice" @click="moveWord(-1)" :disabled="saving || progress.wordIndex === 0">上一个</button>
        <button class="choice active" :disabled="saving" @click="moveWord(1)">{{ progress.wordIndex === lesson.words.length - 1 ? "完成新词，继续 →" : "下一个" }}</button>
      </div>
    </article>

    <article v-else-if="progress.step === 'vocabulary'" class="card"><p class="muted">本课没有新词。</p><button class="choice active" @click="go('parts',true)" :disabled="saving">继续学习</button></article>
    <LessonParts v-else-if="progress.step === 'parts'" :words="parts" :lesson-id="lesson.id" @next="go('listening', true)" />

    <LessonListening v-else-if="progress.step === 'listening'" :key="lesson.id" :lesson="lesson" :saving="saving" @save="save" @busy="childBusy = $event" @next="go('shadow',true)" />
    <ShadowPanel v-else-if="progress.step === 'shadow'" :lesson="lesson" :saving="saving" @save="save" @next="go('recall',true)" />

    <article class="card" v-else-if="progress.step === 'recall'">
      <h3>主动回忆 · Active output</h3>
      <p class="muted">不看答案，先试着用目标词说一句自己的英文，再根据实际记忆评分。</p>
      <ReviewCard v-if="recallWord" :key="recallWord.id" :item="recallWord" :remaining="recallRemaining" active-output @done="refreshCurrent" />
      <div v-else class="recall-finish">
        <p class="ok">本课新词均已进入复习计划。</p>
        <QuizBlock v-if="lesson.questions.length" :lesson="lesson" @changed="refreshCurrent" />
        <div class="lesson-summary" v-if="progress.completed.includes('recall')">
          <p class="origin">SESSION SUMMARY</p>
          <h3>{{ doneCount === steps.length ? "本课学习完成" : "回忆与测验已完成" }}</h3>
          <p>已完成 {{ doneCount }} / {{ steps.length }} 个阶段。下次复习由已有 FSRS 排程决定。</p>
          <p v-if="unfinished.length" class="muted">尚未完成：{{ unfinished.map(s=>s.label).join('、') }}</p>
          <div class="row"><button v-if="unfinished.length" class="choice active" :disabled="saving" @click="go(unfinished[0].id)">继续未完成阶段</button><router-link class="choice" to="/">返回今日学习</router-link><router-link class="choice" to="/review">查看复习计划</router-link></div>
        </div>
        <button v-else class="choice active" :disabled="saving || !quizDone" @click="go('recall',true)">完成本课回忆</button>
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
import { steps, completedCount, nextProgress } from "../lib/learningFlow";
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
const saving=ref(false),childBusy=ref(false);
const progress = computed(() => lesson.value?.progress as Progress);
const doneCount=computed(()=>completedCount(lesson.value?.progress));
const currentStep=computed(()=>steps.find(s=>s.id===progress.value?.step)||steps[0]);
const unfinished=computed(()=>steps.filter(s=>!progress.value?.completed.includes(s.id)));
const quizDone=computed(()=>lesson.value?.questions.every(q=>q.answered)??false);
const recallRemaining=computed(()=>lesson.value?.words.filter(w=>w.reps===0&&!w.knownAlready).length||0);
const word = computed(() => lesson.value?.words[progress.value.wordIndex] || null);
const parts = computed(() => store.dashboard?.settings.wordPartsEnabled === false ? [] : lesson.value?.words.filter((item) => item.morphology).slice(0, 2) || []);
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

async function refreshCurrent(){
  const id=lesson.value?.id;
  if(!id)return;
  try{const fresh=await api<Lesson>(`/api/lessons/${id}`);if(lesson.value?.id===id)lesson.value=fresh;}
  catch(err){error.value=err instanceof Error?err.message:"课程刷新失败，请刷新页面。";}
}
async function save(next?: Progress) {
  if (!lesson.value || saving.value) return;
  const id=lesson.value.id;
  saving.value=true; error.value="";
  try {
    const fresh=await api<Lesson>(`/api/lessons/${id}/progress`,{method:"PATCH",body:JSON.stringify({progress:next||lesson.value.progress})});
    if(lesson.value?.id===id)lesson.value=fresh;
  } catch(err){error.value=err instanceof Error?err.message:"学习进度未保存，请重试。";}
  finally{saving.value=false;}
}
async function go(step: string, complete=false) {
  if (!lesson.value || saving.value || childBusy.value) return;
  await save(nextProgress(lesson.value.progress,step,complete));
}
async function moveWord(delta: number) {
  if (!lesson.value || saving.value) return;
  const index=lesson.value.progress.wordIndex+delta;
  if(index>=lesson.value.words.length){await go("parts",true);return;}
  await save({...lesson.value.progress,wordIndex:Math.max(0,index)});
}

async function loadVersions() {
  versions.value = await api("/api/lessons/today/versions");
}

const generating = ref(false);

async function makeAiVersion() {
  if (generating.value || saving.value || childBusy.value) return;
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
.course-path {display:grid;gap:12px;padding:16px 20px}
.path-header {display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.path-header h3,.path-header p {margin:0 0 4px}.path-header strong{font-size:13px;color:var(--accent-text)}
.course-path .progress-track{margin:0;height:5px}.course-path .flow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;border:0;overflow:visible;background:transparent}
.course-path .step{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:0;min-height:56px;border:1px solid var(--line);border-radius:10px;padding:6px 3px}
.course-path .step small{font-size:11px;opacity:.85}.course-path .step.done:not(.current){background:var(--accent-soft);color:var(--accent-text)}
.lesson-summary{border:1px solid var(--line);border-radius:14px;background:var(--surface-muted);padding:20px;margin-top:18px}
.recall-finish{max-width:900px;margin:auto}
@media(max-width:650px){.course-path .flow{grid-template-columns:repeat(3,minmax(0,1fr))}.course-path{padding:12px}}
@media (max-width: 600px) { .generation-note { text-align: left; } }
</style>
