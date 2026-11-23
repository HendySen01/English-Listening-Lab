<template>
  <section class="rd" v-if="loaded">
    <div class="rd-frame rd-workspace lib-workspace" :class="{ 'is-detail': Boolean(current) && narrow }">
      <div class="rd-read lib-list">
        <div class="rd-segment" role="group" aria-label="复习筛选">
          <button v-for="item in filters" :key="item.id" class="rd-pill" type="button" :aria-pressed="filter === item.id" @click="filter = item.id; load()">{{ item.label }}</button>
        </div>
        <input class="rd-field" v-model="query" placeholder="搜索单词或中文" @input="load" />
        <button v-for="item in items" :key="item.id" class="lib-row" type="button" :aria-pressed="current?.id === item.id" @click="open(item)">
          <strong translate="no">{{ item.lemma }}</strong>
          <span>{{ familiarityLabel(item.familiarity) }} · {{ remain(item.due) }}</span>
        </button>
        <p v-if="!items.length" class="rd-note">这个筛选下没有词。</p>
      </div>
      <aside class="rd-notes" v-if="current">
        <button v-if="narrow" class="rd-pill" type="button" @click="current = null">返回列表</button>
        <p class="rd-kicker">先回忆，再看答案</p>
        <h2 class="rd-word" translate="no">{{ current.lemma }}</h2>
        <p class="rd-meta">{{ current.pos }} <span v-if="current.ipa" translate="no">{{ current.ipa }}</span></p>
        <p class="rd-copy">上次复习：{{ formatWhen(current.lastReview) }}</p>
        <p class="rd-copy">下次复习：{{ formatWhen(current.due) }} · {{ remain(current.due) }}</p>
        <button v-if="!revealed" class="rd-pill primary" type="button" @click="revealed = true">显示答案</button>
        <template v-else>
          <p class="rd-copy">{{ current.meaningZh }}</p>
          <p class="rd-sentence" style="font-size: 28px" translate="no">{{ current.example }}</p>
          <p class="rd-copy">{{ current.exampleZh }}</p>
        </template>
        <label class="rd-note"><input type="checkbox" v-model="formal" /> 将本次计入正式复习。不勾选时只做提前练习，不改下一次时间。</label>
        <div class="rd-tools">
          <button class="rd-pill" type="button" @click="submit('again')">忘记</button>
          <button class="rd-pill" type="button" @click="submit('hard')">困难</button>
          <button class="rd-pill" type="button" @click="submit('good')">记得</button>
          <button class="rd-pill primary" type="button" @click="submit('easy')">非常熟悉</button>
        </div>
        <p v-if="feedback" class="rd-status" role="status">{{ feedback }}</p>
        <p v-if="missing" class="rd-note">{{ missing }}</p>
      </aside>
      <aside v-else class="rd-notes"><p class="rd-note">选择一个到期的词。没有记录时不会新建。</p></aside>
    </div>
  </section>
  <p v-else>正在读取复习……</p>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { formatDue, formatWhen } from "../lib/due";
import "../preview/reader.css";

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
const missing = ref("");
const revealed = ref(false);
const loaded = ref(false);
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
  revealed.value = false;
  feedback.value = "";
  missing.value = "";
}
async function load() {
  const data = await api<{ items: any[] }>(`/api/review?filter=${filter.value}&q=${encodeURIComponent(query.value)}`);
  items.value = data.items;
  if (current.value) current.value = data.items.find((item) => item.id === current.value.id) || null;
  else if (!narrow.value && data.items[0]) open(data.items[0]);
}
async function submit(rating: string) {
  if (!current.value) return;
  if (!revealed.value) {
    missing.value = "先显示答案，再评分。";
    return;
  }
  if (formal.value && !confirm("计入正式复习后，会按这次表现用 FSRS 改写下一次复习时间。继续吗？")) return;
  const result = await api<{ note: string; due: string; changedSchedule: boolean }>(`/api/review/${current.value.id}/practice`, {
    method: "POST",
    body: JSON.stringify({ rating, formal: formal.value }),
  });
  feedback.value = `${result.note} 下次复习：${formatWhen(result.due)}，${formatDue(result.due, new Date())}。`;
  formal.value = false;
  await load();
}
onMounted(async () => {
  const focus = String(route.query.focus || "");
  if (focus) filter.value = "all";
  formal.value = route.query.practice === "1" ? false : false;
  await load();
  if (focus) {
    const found = items.value.find((item) => item.id === focus);
    if (found) open(found);
    else missing.value = "这个词不在现有复习队列里。页面没有新建记录。";
  }
  loaded.value = true;
  timer = window.setInterval(() => { now.value = new Date(); }, 30000);
  window.addEventListener("resize", () => { narrow.value = window.matchMedia("(max-width: 900px)").matches; });
});
onUnmounted(() => window.clearInterval(timer));
</script>
