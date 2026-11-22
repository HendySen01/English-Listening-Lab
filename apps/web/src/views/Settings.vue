<template>
  <section class="settings-grid" v-if="form">
    <article class="card stack">
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
      <label class="row"><input type="checkbox" v-model="form.autoGenerate" /> 没有今天的课时自动生成</label>
      <label class="row"><input type="checkbox" v-model="form.wordPartsEnabled" /> 显示词根词缀</label>
      <label class="row"><input type="checkbox" v-model="form.recommendationsEnabled" /> 显示数量建议</label>
    </article>
    <article class="card stack">
      <h2>AI 课程生成</h2>
      <p>状态：{{ system?.llmState || "正在读取" }}</p>
      <p class="muted">服务：{{ system?.llmHost || "未配置" }} · 模型：{{ system?.llmModel || "无" }}</p>
      <p class="muted">最近成功：{{ system?.lastSuccessAt ? formatWhen(system.lastSuccessAt) : "还没有成功调用" }}</p>
      <p class="muted">今天 {{ system?.aiUsedToday || 0 }} / {{ system?.aiDailyLimit }} 次。输入 token {{ system?.promptTokens ?? "未知" }}，输出 token {{ system?.completionTokens ?? "未知" }}。没有可靠单价时不估算费用。</p>
      <p v-if="system?.lastError" class="bad">最近失败：{{ system.lastError }}</p>
      <button class="choice" @click="testAi">测试 AI 连接</button>
    </article>
    <article class="card stack">
      <h2>语音服务</h2>
      <p>在线语音：{{ system?.ttsState }}</p>
      <p class="muted">{{ system?.ttsHost || "未配置" }} · {{ system?.ttsModel || "无模型" }} · 音色 {{ system?.ttsVoice || "无" }}</p>
      <p>{{ system?.ttsNote }}</p>
      <p>浏览器语音：{{ browserVoices }}</p>
      <label class="field">语速，立即作用于浏览器播放
        <select v-model.number="form.speechRate">
          <option :value="0.8">0.8 倍</option>
          <option :value="0.9">0.9 倍</option>
          <option :value="1">1.0 倍</option>
          <option :value="1.1">1.1 倍</option>
        </select>
      </label>
      <p class="muted">默认播放使用浏览器语音，不会自动扣在线语音费用。播放器里可以另行确认后再用在线语音。</p>
    </article>
    <article class="card stack">
      <h2>外观</h2>
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
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { formatWhen } from "../lib/due";
import { applyTheme, useAppStore } from "../stores/app";

const store = useAppStore();
const form = ref<any>(null);
const system = ref<any>(null);
const message = ref("");
const error = ref(false);
const browserVoices = ref("正在检查");

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
  if (!confirm("测试会向当前语言模型发送一次很短的请求，可能产生少量费用。继续吗？")) return;
  try {
    const result = await api<{ model: string }>("/api/ai/test", { method: "POST", body: JSON.stringify({ confirmCost: true }) });
    message.value = `连接成功，模型 ${result.model}。`;
    error.value = false;
    system.value = await api("/api/system");
  } catch (err) {
    message.value = err instanceof Error ? err.message : "测试失败";
    error.value = true;
    system.value = await api("/api/system");
  }
}

onMounted(async () => {
  form.value = await api("/api/settings");
  system.value = await api("/api/system");
  applyTheme(form.value.colorMode);
  const voices = window.speechSynthesis?.getVoices().filter((item) => item.lang.toLowerCase().startsWith("en")) || [];
  browserVoices.value = voices.length ? `可用，检测到 ${voices.length} 个英语语音` : "当前没有列出英语语音";
});
</script>
