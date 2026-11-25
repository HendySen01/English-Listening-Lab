<template>
  <section class="rd" v-if="loaded">
    <p v-if="feedback" class="rd-status" role="status">{{ feedback }}</p>
    <p v-if="missing" class="rd-note" role="status">{{ missing }}</p>
    <div class="rd-frame rd-workspace lib-workspace" :class="{ 'is-detail': Boolean(current) && narrow }">
      <div class="rd-read lib-list">
        <div class="rd-segment" role="group" aria-label="复习筛选">
          <button v-for="item in filters" :key="item.id" class="rd-pill" type="button" :aria-pressed="filter === item.id" :disabled="ratingBusy" @click="filter = item.id; resetQueue()">{{ item.label }}</button>
        </div>
        <input class="rd-field" v-model="query" placeholder="搜索单词或中文" :disabled="ratingBusy" @input="resetQueue" />
        <button v-for="item in items" :key="item.id" class="lib-row" type="button" :aria-pressed="current?.id === item.id" :disabled="ratingBusy" @click="open(item)">
          <strong translate="no">{{ item.lemma }}</strong>
          <span>{{ familiarityLabel(item.familiarity) }} · {{ remain(item.due) }}</span>
        </button>
        <p v-if="!items.length" class="rd-note">这个筛选下没有词。</p>
      </div>
      <aside class="rd-notes" v-if="current">
        <button v-if="narrow" :disabled="ratingBusy" class="rd-pill" type="button" @click="current = null">返回列表</button>
        <p class="rd-kicker">先回忆，再看答案</p>
        <h2 class="rd-word" translate="no">{{ current.lemma }}</h2>
        <p class="rd-meta">{{ current.pos }} <span v-if="current.ipa" translate="no">{{ current.ipa }}</span></p>
        <p class="rd-copy">上次复习：{{ formatWhen(current.lastReview) }}</p>
        <p class="rd-copy">下次复习：{{ formatWhen(current.due) }} · {{ remain(current.due) }}</p>
        <div class="recall-panel">
          <div class="recall-answer">
            <button v-if="!revealed" class="rd-pill primary" type="button" @click="revealed = true">显示答案</button>
            <p v-if="!revealed" class="rd-note">先看答案，再选择记忆程度。</p>
          </div>
          <div v-if="revealed">
            <p class="rd-copy">{{ current.meaningZh }}</p>
            <p class="rd-sentence" style="font-size: 28px" translate="no">{{ current.example }}</p>
            <p class="rd-copy">{{ current.exampleZh }}</p>
          </div>
          <label class="formal-check"><input type="checkbox" v-model="formal" :disabled="ratingBusy" /> <span>将本次计入正式复习。不勾选时只做提前练习，不改下一次时间。</span></label>
        </div>
        <div class="grade-grid" role="group" aria-label="记忆评分">
          <button class="rd-pill rate rate-again" type="button" :disabled="ratingBusy" @click="submit('again')">忘记</button>
          <button class="rd-pill rate rate-hard" type="button" :disabled="ratingBusy" @click="submit('hard')">困难</button>
          <button class="rd-pill rate rate-good" type="button" :disabled="ratingBusy" @click="submit('good')">记得</button>
          <button class="rd-pill rate rate-easy" type="button" :disabled="ratingBusy" @click="submit('easy')">非常熟悉</button>
        </div>
      </aside>
      <aside v-else-if="completed.size && queueFinished" class="rd-notes" role="status">
        <h2>本轮复习完成</h2>
        <p>已完成 {{ completed.size }} 个词的正式复习。</p>
      </aside>
      <aside v-else class="rd-notes"><p class="rd-note">选择一个到期的词。没有记录时不会新建。</p></aside>
    </div>
  </section>
  <p v-else>正在读取复习……</p>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { formatDue, formatWhen } from "../lib/due";
import { progressStamp, withReviewRequest } from "../lib/reviewRequest";
import "../preview/reader.css";
import { useStudyClock } from "../composables/useStudyClock";
useStudyClock("review", () => null);

const route = useRoute();
const filters = [
  { id: "due", label: "已到期" },
  { id: "soon", label: "即将到期" },
  { id: "all", label: "所有已学单词" },
  { id: "weak", label: "薄弱词汇" },
  { id: "known", label: "已掌握词汇" },
];
const filter = ref("due");
const query = ref("");
const items = ref<any[]>([]);
const current = ref<any>(null);
const formal = ref(false);
const feedback = ref("");
const ratingBusy = ref(false);
const missing = ref("");
const revealed = ref(false);
const loaded = ref(false);
const completed = ref(new Set<string>());
const queueFinished = ref(false);
let loadVersion = 0;
const narrow = ref(window.matchMedia("(max-width: 900px)").matches);
const now = ref(new Date());
let timer = 0;

function remain(due: string) { return formatDue(due, now.value); }
function familiarityLabel(value: string) {
  if (value === "forgot") return "忘记";
  if (value === "hard") return "困难";
  if (value === "easy") return "非常熟悉";
  if (value === "remembered") return "记得";
  return "新学";
}
function open(item: any) {
  current.value = item;
  formal.value = route.query.practice !== "1" && !item.knownAlready && new Date(item.due) <= new Date();
  revealed.value = false;
  feedback.value = "";
  missing.value = "";
}
async function load() {
  const version = ++loadVersion;
  const data = await api<{ items: any[] }>(`/api/review?filter=${filter.value}&q=${encodeURIComponent(query.value)}&focus=${encodeURIComponent(String(route.query.focus || ""))}`);
  if (version !== loadVersion) return false;
  items.value = data.items;
  return true;
}
async function resetQueue() {
  completed.value.clear();
  queueFinished.value = false;
  try {
    if (!await load()) return;
    const selected = items.value.find((item) => item.id === current.value?.id);
    if (selected) current.value = selected;
    else if (!narrow.value && items.value[0]) open(items.value[0]);
    else current.value = null;
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "无法读取复习队列。";
  } finally {
    loaded.value = true;
  }
}
async function submit(rating: string) {
  if (!current.value || ratingBusy.value) return;
  if (!revealed.value) {
    missing.value = "先显示答案，再评分。";
    return;
  }
  const card = current.value;
  const isFormal = formal.value;
  ratingBusy.value = true;
  try {
    const payload: Record<string, unknown> = { rating, formal: isFormal };
    if (isFormal) payload.progress = progressStamp(card);
    const result = await withReviewRequest(
      `${isFormal ? "formal" : "practice"}:${card.id}`,
      payload,
      (body) => api<{ note: string; due: string; changedSchedule: boolean }>(`/api/review/${card.id}/practice`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    const note = `${result.note} 下次复习：${formatWhen(result.due)}，${formatDue(result.due, new Date())}。`;
    if (result.changedSchedule) {
      completed.value.add(card.id);
      current.value = null;
      queueFinished.value = false;
      try {
        if (!await load()) return;
        const next = items.value.find((item) => !completed.value.has(item.id)
          && !item.knownAlready && new Date(item.due) <= new Date());
        if (next) open(next);
        else queueFinished.value = true;
      } catch {
        feedback.value = `${note} 队列刷新失败，可以切换筛选重新读取。`;
        return;
      }
    }
    feedback.value = note;
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "这次评分没有写入。";
  } finally {
    ratingBusy.value = false;
  }
}
async function selectTarget() {
  const focus = String(route.query.focus || "");
  if (focus) {
    filter.value = "all";
    query.value = "";
  }
  await resetQueue();
  if (focus) {
    const found = items.value.find((item) => item.id === focus || item.relatedIds?.includes(focus));
    if (found) open(found);
    else missing.value = "这个词不在现有复习队列里。页面没有新建记录。";
  }
  loaded.value = true;
}
watch(() => [route.query.focus, route.query.practice], () => { void selectTarget(); });
onMounted(async () => {
  await selectTarget();
  timer = window.setInterval(() => { now.value = new Date(); }, 30000);
  window.addEventListener("resize", resize);
});
function resize() { narrow.value = window.matchMedia("(max-width: 900px)").matches; }
onUnmounted(() => {
  window.clearInterval(timer);
  window.removeEventListener("resize", resize);
});
</script>
