<template>
  <section class="gist-card" aria-labelledby="gist-title">
    <header class="gist-head"><div><p class="rd-kicker">FIRST LISTEN · ACTIVE OUTPUT</p><h3 id="gist-title">What did you hear?</h3></div><span class="rd-note">01 / 04</span></header>
    <p class="rd-note">先听完整段音频，再用自己的英语概括大意。不需要逐字复述。</p>
    <label for="listening-gist-answer" class="gist-label">Your summary</label>
    <textarea id="listening-gist-answer" v-model="draft" class="rd-field" lang="en" rows="4" maxlength="1800" :disabled="busy || restoring || saving" placeholder="Write one or two sentences in English…" />
    <div class="gist-actions">
      <button class="rd-pill primary" type="button" :disabled="busy || restoring || saving || !draft.trim() || Boolean(currentFeedback)" @click="submit">{{ busy ? "正在批改…" : currentFeedback ? "已完成批改" : "提交 AI 批改" }}</button>
      <span class="rd-note">新答案使用一次 AI 额度；相同答案复用已有结果。</span>
    </div>
    <p v-if="error" class="bad" role="alert">{{ error }}</p>
    <p v-if="restoring" class="rd-note" role="status">正在读取已保存的答案…</p>
    <section v-if="currentFeedback" class="gist-feedback" aria-label="AI listening feedback">
      <header class="gist-head"><div><p class="rd-kicker">YOUR LISTENING REVIEW</p><h3>{{ understandingLabels[currentFeedback.understanding] }}</h3></div><span class="rd-source">{{ resultSource === "cache" ? "已保存的反馈" : "AI 批改" }}</span></header>
      <article v-for="item in sections" :key="item.key" class="gist-section">
        <h4>{{ item.label }}</h4>
        <p lang="en" translate="no">{{ currentFeedback[item.key].en }}</p>
        <BlurText :text="currentFeedback[item.key].zh" :clear="Boolean(revealed[item.key])" @toggle="revealed[item.key] = !revealed[item.key]" />
      </article>
      <details class="gist-evidence"><summary>Check the evidence · 对照原文依据</summary><p v-for="quote in currentFeedback.evidence" :key="quote" lang="en" translate="no">{{ quote }}</p></details>
    </section>
    <footer class="gist-footer"><button class="rd-pill" type="button" :disabled="busy || restoring || saving" @click="advance">{{ currentFeedback ? "对照原文 →" : "暂不批改，查看原文 →" }}</button></footer>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api";
import BlurText from "../preview/BlurText.vue";
type Pair = { en: string; zh: string };
type Feedback = { understanding: "accurate"|"partial"|"misunderstood"|"unclear"; comprehension: Pair; language: Pair; naturalVersion: Pair; evidence: string[] };
type Result = { answer: string; feedback: Feedback | null; source: string; model?: string | null };
const props = defineProps<{ lessonId: string; initialAnswer: string; saving?: boolean }>();
const emit = defineEmits<{ saved: [answer: string]; next: []; busy: [value: boolean] }>();
const draft = ref(props.initialAnswer || ""), saved = ref<Result|null>(null), busy = ref(false), restoring = ref(false), error = ref("");
const resultSource = computed(() => saved.value?.source);
const currentFeedback = computed(() => saved.value?.answer === draft.value.trim() ? saved.value.feedback : null);
const sections = [{key:"comprehension",label:"01 · Comprehension"},{key:"language",label:"02 · Language feedback"},{key:"naturalVersion",label:"03 · A more natural version"}] as const;
const understandingLabels = { accurate:"You understood the main idea", partial:"You understood part of the message", misunderstood:"Review the main idea", unclear:"More detail would help" };
const revealed = ref<Record<string,boolean>>({});
const endpoint = () => "/api/lessons/" + encodeURIComponent(props.lessonId) + "/listening-feedback";
watch(draft,()=>{revealed.value={};error.value=""});
onMounted(async()=>{
  restoring.value=true;
  try {
    const result=await api<Result>(endpoint());
    draft.value=result.answer;
    saved.value=result;
    emit("saved",result.answer);
  } catch { error.value = "暂时无法读取已保存的批改。你仍可以继续练习或重新提交。"; }
  finally { restoring.value=false; }
});
function advance(){ if(busy.value || restoring.value || props.saving)return; emit("saved",draft.value.trim()); emit("next"); }
async function submit(){
  if(busy.value || restoring.value || props.saving || !draft.value.trim() || currentFeedback.value)return;
  busy.value=true;emit("busy",true);error.value="";revealed.value={};
  const answer=draft.value.trim();
  emit("saved",answer);
  try { saved.value=await api<Result>(endpoint(),{method:"POST",body:JSON.stringify({answer,confirmCost:true})}); }
  catch(e){error.value=e instanceof Error?e.message:"批改暂时失败，答案仍保留。";}
  finally {busy.value=false;emit("busy",false);}
}
</script>
<style scoped>
.gist-card { max-width:880px; margin:16px auto; background:var(--paper); border:1px solid var(--line); border-radius:16px; padding:clamp(16px,3vw,28px); display:grid; gap:14px; }
.gist-card h3,.gist-card p,.gist-card h4 {margin:0}
.gist-head,.gist-actions,.gist-footer {display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.gist-head h3 {font-size:clamp(21px,3vw,29px);line-height:1.35;margin-top:6px}
.gist-label {font-size:14px;font-weight:650;color:var(--accent-text)}
.gist-card textarea {width:100%;box-sizing:border-box;font-size:16px;line-height:1.6;min-height:108px;resize:vertical}
.gist-actions .rd-pill {min-height:44px}
.gist-feedback {border-top:1px solid var(--line);padding-top:20px;display:grid;gap:14px}
.gist-section {background:var(--surface-muted);padding:16px;border-radius:12px;display:grid;gap:9px;overflow-wrap:anywhere}
.gist-section h4 {font-size:14px;color:var(--accent-text)}
.gist-section > p {font-size:17px;line-height:1.65}
.gist-evidence {color:var(--muted);font-size:14px;line-height:1.6}
.gist-evidence summary {cursor:pointer;padding:8px 0}
.gist-footer {justify-content:flex-end}
</style>
