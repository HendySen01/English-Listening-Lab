<template>
  <section class="settings-shell" v-if="form">
    <nav class="settings-nav" aria-label="设置分类">
      <button v-for="item in sections" :key="item.id" class="choice" type="button" :aria-pressed="section === item.id" @click="section = item.id">{{ item.label }}</button>
    </nav>
    <div>
    <article class="card stack" v-show="section === 'plan'">
      <h2>学习计划</h2>
      <p class="notice">学习方向、英语水平和其他计划设置会在下一次生成新课时生效。</p>
      <label class="field">学习方向
        <select v-model="form.learningDirection" aria-describedby="learning-direction-help">
          <option v-for="[value, label] in learningDirections" :key="value" :value="value">{{ label }}</option>
        </select>
        <small id="learning-direction-help">{{ learningDirections.find(([value]) => value === form.learningDirection)?.[2] }}</small>
      </label>
      <label v-if="form.learningDirection === 'custom'" class="field">自定义学习目标
        <textarea v-model="form.customLearningGoal" rows="2" maxlength="160" placeholder="例如：练习旅游时问路和解决住宿问题"></textarea>
      </label>
      <label class="field">每天新词（3–20）<input type="number" min="3" max="20" v-model.number="form.dailyNewWords" /></label>
      <label class="field">计划分钟<input type="number" min="20" max="180" v-model.number="form.dailyMinutes" /></label>
      <label class="field">当前英语水平（CEFR）
        <select v-model="form.difficulty">
          <option v-for="[value, label] in cefr" :key="value" :value="value">{{ value }} · {{ label }}</option>
        </select>
      </label>
      <label class="field">听力难度
        <select v-model="form.listeningLevel">
          <option value="match">跟随当前英语水平</option>
          <option v-for="[value, label] in cefr" :key="value" :value="value">{{ value }} · {{ label }}</option>
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
      <p v-if="message" :class="error ? 'bad' : 'ok'" role="status">{{ message }}</p>
      <button class="choice active" @click="save">保存学习计划</button>
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
      <div class="field">全站播放语速
        <SpeechRateControl />
        <small>立即应用于浏览器朗读和在线语音，并保存到当前学习空间。</small>
      </div>
      <p v-if="store.speechRateError" class="bad" role="status">{{ store.speechRateError }}</p>
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
import SpeechRateControl from "../components/SpeechRateControl.vue";
import { sessionUser } from "../lib/authClient";

const store = useAppStore();
const cefr = [["A1", "入门"], ["A2", "初级"], ["B1", "中级"], ["B2", "中高级"], ["C1", "高级"], ["C2", "精通"]];
const learningDirections = [
  ["general", "日常英语", "练习生活词汇、自然对话和常见交际场景。"],
  ["highSchool", "高中英语", "围绕学校和社会主题练习句型、阅读与推断。"],
  ["cet4", "CET-4", "练习常用考试词汇、校园听力与主旨细节。"],
  ["cet6", "CET-6", "练习正式词汇、学术话题、立场和推断。"],
  ["postgraduate", "考研英语", "练习论证结构、同义改写和阅读推断。"],
  ["ielts", "IELTS", "练习生活与学术场景、改写及说话者态度。"],
  ["toefl", "TOEFL", "练习校园对话、学术讲座及信息组织。"],
  ["business", "商务英语", "练习职场邮件、会议、决策和表达语气。"],
  ["custom", "自定义学习目标", "按你给出的实际需求安排原创练习。"],
];
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
    const { speechRate, ...plan } = form.value;
    form.value = await api("/api/settings", { method: "PUT", body: JSON.stringify(plan) });
    applyTheme(form.value.colorMode);
    if (store.dashboard) store.dashboard.settings = form.value;
    message.value = "已保存。学习计划从下一次新课开始使用；颜色现在生效。";
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
