<template>
  <section class="stack">
    <div class="card">
      <h2>复习计划</h2>
      <p class="muted">到期时间来自数据库。页面上的剩余时间每 30 秒根据这个时间重算，刷新、休眠恢复后也会重算。</p>
      <div class="filters">
        <button v-for="item in filters" :key="item.id" class="step" :class="{ current: filter === item.id }" @click="filter = item.id; load()">{{ item.label }}</button>
      </div>
      <input class="plain-input" v-model="query" placeholder="搜索单词或中文" @input="load" />
    </div>
    <article class="card" v-if="current">
      <p class="muted">{{ current.pos }} {{ current.ipa }}</p>
      <h2 class="word">{{ current.lemma }}</h2>
      <p>{{ current.meaningZh }}</p>
      <p>{{ current.example }}</p>
      <p>上次复习：{{ formatWhen(current.lastReview) }}</p>
      <p>下次复习：{{ formatWhen(current.due) }}</p>
      <p><strong>{{ remain(current.due) }}</strong></p>
      <label class="row"><input type="checkbox" v-model="formal" /> 将本次练习计入正式复习</label>
      <div class="row">
        <button class="choice" @click="submit('again')">忘记</button>
        <button class="choice" @click="submit('hard')">困难</button>
        <button class="choice" @click="submit('good')">记得</button>
        <button class="choice" @click="submit('easy')">非常熟悉</button>
      </div>
      <p v-if="feedback">{{ feedback }}</p>
    </article>
    <article class="card" v-for="item in items" :key="item.id">
      <div class="row" style="justify-content: space-between">
        <strong>{{ item.lemma }}</strong>
        <span>{{ remain(item.due) }}</span>
      </div>
      <p class="muted">{{ item.meaningZh }} · 下次 {{ formatWhen(item.due) }} · {{ familiarityLabel(item.familiarity) }}</p>
      <button class="choice" @click="current = item; feedback = ''">复习这个词</button>
    </article>
    <p v-if="!items.length" class="muted">这个筛选下没有词。可以切换到「所有已学单词」。</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "../api";
import { formatDue, formatWhen } from "../lib/due";

const filters = [
  { id: "due", label: "已到期" },
  { id: "soon", label: "即将到期" },
  { id: "all", label: "所有已学单词" },
  { id: "weak", label: "薄弱词汇" },
  { id: "known", label: "已掌握词汇" },
];
const filter = ref("all");
const query = ref("");
const items = ref<any[]>([]);
const current = ref<any>(null);
const formal = ref(false);
const feedback = ref("");
const now = ref(new Date());
let timer = 0;

function remain(due: string) {
  return formatDue(due, now.value);
}
function familiarityLabel(value: string) {
  if (value === "forgot") return "忘记";
  if (value === "hard") return "困难";
  if (value === "easy") return "非常熟悉";
  if (value === "remembered") return "记得";
  return "新学";
}
async function load() {
  const data = await api<{ items: any[] }>(`/api/review?filter=${filter.value}&q=${encodeURIComponent(query.value)}`);
  items.value = data.items;
  if (!current.value && data.items[0]) current.value = data.items[0];
}
async function submit(rating: string) {
  if (!current.value) return;
  if (formal.value && !confirm("计入正式复习后，会按这次表现用 FSRS 改写下一次复习时间。继续吗？")) return;
  const result = await api<{ note: string; due: string; changedSchedule: boolean }>(`/api/review/${current.value.id}/practice`, {
    method: "POST",
    body: JSON.stringify({ rating, formal: formal.value }),
  });
  feedback.value = `${result.note} 下次复习：${formatWhen(result.due)}，${formatDue(result.due, new Date())}。`;
  formal.value = false;
  await load();
  current.value = items.value.find((item) => item.id === current.value.id) || items.value[0] || null;
}
onMounted(() => {
  void load();
  timer = window.setInterval(() => {
    now.value = new Date();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) now.value = new Date();
  });
});
onUnmounted(() => window.clearInterval(timer));
</script>
