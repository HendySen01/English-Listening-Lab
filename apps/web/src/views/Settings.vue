<template>
  <section class="settings-shell" v-if="form">
    <nav class="settings-nav" aria-label="设置分类">
      <button v-for="item in sections" :key="item.id" class="choice" type="button" :aria-pressed="section === item.id" @click="section = item.id">{{ item.label }}</button>
    </nav>
    <div>
    <article class="card stack" v-show="section === 'plan'">
      <h2>学习计划</h2>
      <p class="notice">新词数量、难度和主题会在下一次生成新课时生效。已经生成的今天课程不会被悄悄覆盖。</p>
      <label class="field">每天新词（3–20）<input type="number" min="3" max="20" v-model.number="form.dailyNewWords" /></label>
      <label class="field">计划分钟<input type="number" min="20" max="180" v-model.number="form.dailyMinutes" /></label>
      <label class="field">词汇难度
        <select v-model="form.difficulty">
          <option>A1</option><option>A2</option><option>A2+</option><option>B1</option><option>B1+</option><option>B2</option><option>CET-4</option>
        </select>
      </label>
      <label class="field">听力难度
        <select v-model="form.listeningLevel">
          <option value="match">跟词汇难度</option>
          <option>A1</option><option>A2</option><option>A2+</option><option>B1</option><option>B1+</option><option>B2</option><option>CET-4</option>
        </select>
      </label>
      <label class="field">主题
        <select v-model="form.theme">
          <option value="Daily Life">日常生活</option>
          <option value="Health">健康</option>
          <option value="Technology">科技</option>
          <option value="Education">学习</option>
          <option value="Travel">旅行</option>
          <option value="Transportation">交通</option>
          <option value="Workplace">工作</option>
          <option value="Food">饮食</option>
          <option value="Social Life">社交</option>
          <option value="Custom">自定义</option>
        </select>
      </label>
      <label class="field" v-if="form.theme === 'Custom'">自定义主题<input v-model="form.customTheme" maxlength="40" /></label>
      <label v-if="!sessionUser" class="row"><input type="checkbox" v-model="form.autoGenerate" /> 没有今天的课时自动生成</label>
      <label class="row"><input type="checkbox" v-model="form.wordPartsEnabled" /> 显示词根词缀</label>
      <label class="row"><input type="checkbox" v-model="form.recommendationsEnabled" /> 显示数量建议</label>
    </article>
    <article class="card stack" v-show="section === 'ai'">
      <h2>AI 服务</h2>
      <p>每日课程生成：{{ system?.llmState || "正在读取" }}</p>
      <p class="muted">提供商：{{ system?.llmProvider || "未配置" }} · 模型：{{ system?.llmModel || "无" }}</p>
      <p v-if="system?.lastSuccessAt" class="muted">最近成功：{{ formatWhen(system.lastSuccessAt) }}</p>
      <p v-if="system" class="muted">今天已用 {{ system.aiUsedToday }} / {{ system.aiDailyLimit }} 次。</p>
      <p v-if="system?.lastError" class="bad">最近失败：{{ system.lastError }}</p>
      <p v-if="aiMessage" :class="aiError ? 'bad' : 'ok'">{{ aiMessage }}</p>
      <button class="choice" :disabled="system?.llmUsable === false || !system || aiBusy" @click="testAi">测试模型连接</button>
    </article>
    <article class="card stack" v-show="section === 'voice'">
      <h2>语音与听力</h2>
      <p>在线朗读：{{ system?.ttsState || "正在读取" }}</p>
      <p v-if="system?.ttsHost" class="muted">{{ system.ttsHost }} · {{ system.ttsModel }} · 音色 {{ system.ttsVoice }}</p>
      <p v-if="system?.ttsNote">{{ system.ttsNote }}</p>
      <p>浏览器语音：{{ browserVoices }}</p>
      <label class="field">语速，立即作用于浏览器播放
        <select v-model.number="form.speechRate">
          <option :value="0.8">0.8 倍</option>
          <option :value="0.9">0.9 倍</option>
          <option :value="1">1.0 倍</option>
          <option :value="1.1">1.1 倍</option>
          <option :value="1.2">1.2 倍</option>
        </select>
      </label>
    </article>
    <article class="card stack" v-show="section === 'look'">
      <h2>外观</h2>
      <p class="muted">颜色选择后立即生效。学习计划要点保存，并在下一节新课使用。</p>
      <label class="field">颜色
        <select v-model="form.colorMode" @change="applyTheme(form.colorMode)">
          <option value="light">浅色</option>
          <option value="dark">深色</option>
          <option value="system">跟随系统</option>
        </select>
      </label>
      <p class="muted">界面语言固定为简体中文。英语学习内容保持英文。</p>
      <p v-if="message" :class="error ? 'bad' : 'ok'">{{ message }}</p>
      <button class="choice active" @click="save">保存设置</button>
    </article>
    <article class="card stack" v-show="section === 'data'">
      <h2>数据管理</h2>
      <p>课程、词汇、听力和 FSRS 复习记录保存在当前学习空间。</p>
      <p v-if="sessionUser">邮箱状态：{{ sessionUser.emailVerified ? "已验证" : "待验证" }}
        <router-link v-if="!sessionUser.emailVerified && mailConfigured === true" to="/email-verification">验证邮箱</router-link>
      </p>
      <p v-if="sessionUser && mailConfigured === false" class="muted">邮箱验证和密码找回暂不可用。</p>
      <p class="muted">这个页面不能清空数据库，也不能删除历史课程。生成新版本时，旧版本仍可在历史课程里打开。</p>
    </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { formatWhen } from "../lib/due";
import { applyTheme, useAppStore } from "../stores/app";
import { sessionUser } from "../lib/authClient";

const store = useAppStore();
const sections = [
  { id: "plan", label: "学习计划" },
  { id: "ai", label: "AI 服务" },
  { id: "voice", label: "语音与听力" },
  { id: "look", label: "外观" },
  { id: "data", label: "数据管理" },
];
const section = ref("plan");
const form = ref<any>(null);
const system = ref<any>(null);
const message = ref("");
const error = ref(false);
const aiMessage = ref("");
const aiError = ref(false);
const aiBusy = ref(false);
const browserVoices = ref("正在检查");
const mailConfigured = ref<boolean | null>(null);

async function save() {
  try {
    form.value = await api("/api/settings", { method: "PUT", body: JSON.stringify(form.value) });
    applyTheme(form.value.colorMode);
    if (store.dashboard) store.dashboard.settings = form.value;
    message.value = "已保存。学习计划从下一次新课开始使用；颜色和语速现在生效。";
    error.value = false;
  } catch (err) {
    message.value = err instanceof Error ? err.message : "保存失败";
    error.value = true;
  }
}

async function testAi() {
  if (aiBusy.value) return;
  if (!confirm("测试会向当前语言模型发送一次很短的请求，可能产生少量费用。继续吗？")) return;
  aiBusy.value = true;
  try {
    const result = await api<{ model: string; message?: string }>("/api/ai/test", { method: "POST", body: JSON.stringify({ confirmCost: true }) });
    aiMessage.value = result.message || `AI 连接成功 · ${result.model}`;
    aiError.value = false;
  } catch (err) {
    aiMessage.value = err instanceof Error ? err.message : "测试失败";
    aiError.value = true;
  } finally {
    aiBusy.value = false;
    system.value = await api("/api/system").catch(() => system.value);
  }
}

onMounted(async () => {
  form.value = await api("/api/settings");
  system.value = await api("/api/system");
  applyTheme(form.value.colorMode);
  const voices = window.speechSynthesis?.getVoices().filter((item) => item.lang.toLowerCase().startsWith("en")) || [];
  browserVoices.value = voices.length ? `可用，检测到 ${voices.length} 个英语语音` : "当前没有列出英语语音";
  if (sessionUser.value) {
    const status = await api<{ emailDelivery: string }>("/api/signup-status").catch(() => null);
    mailConfigured.value = status ? status.emailDelivery === "configured" : null;
  }
});
</script>
