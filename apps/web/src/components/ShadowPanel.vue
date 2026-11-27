<template>
  <article class="card stack shadow-study">
    <h3>跟读 · 建议 5 分钟</h3>
    <p class="muted">先听一句，再自己读。这里只记录你是否跟上，不会编造发音分数。</p>
    <div class="progress-track" role="progressbar" aria-label="跟读进度" :aria-valuemin="0" :aria-valuemax="lines.length" :aria-valuenow="markedCount"><span :style="{width:(lines.length?markedCount/lines.length*100:0)+'%'}"></span></div>
    <p class="word" style="font-size: clamp(24px,4vw,36px)" lang="en">{{ plain }}</p>
    <div class="row">
      <button class="choice active" :disabled="!plain" @click="toggle">{{ speech.status.value==="播放中"?"暂停":speech.status.value==="已暂停"?"继续":"播放这一句" }}</button>
      <SpeechRateControl />
      <button class="choice" :disabled="saving || !plain" @click="mark('followed')">跟上了</button>
      <button class="choice" :disabled="saving || !plain" @click="mark('missed')">没跟上</button>
    </div>
    <p v-if="rateError" class="bad" role="status">{{ rateError }}</p>
    <p class="audio-state">{{ speech.status.value }} · {{ speech.sourceLabel.value }} {{ speech.detail.value }}</p>
    <p>第 {{ index + 1 }} / {{ lines.length }} 句</p>
    <div class="row"><button class="choice" :disabled="saving || index===0" @click="move(-1)">上一句</button><button class="choice" :disabled="saving || index>=lines.length-1" @click="move(1)">下一句</button><button class="choice active" v-if="done" :disabled="saving" @click="emit('next')">去做回忆和测验</button></div>
  </article>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import SpeechRateControl from "./SpeechRateControl.vue";
import { useStudySpeech } from "../composables/useStudySpeech";
import type { Lesson, Progress } from "../stores/app";

const props = defineProps<{ lesson: Lesson; saving?:boolean }>();
const emit = defineEmits<{ save: [progress?: Progress]; next:[] }>();
const { speech, rate, rateError } = useStudySpeech();
const lines=computed(()=>(props.lesson.listening.chunks.some(Boolean)?props.lesson.listening.chunks:[props.lesson.listening.text]).map(line=>line.replace(/\s*\/\s*/g," ")).filter(x=>x.trim()));
const index=computed(()=>Math.max(0,Math.min(lines.value.length-1,props.lesson.progress.shadow.index||0)));
const plain = computed(() => lines.value[index.value] || "");
const markedCount=computed(()=>lines.value.filter((_,i)=>["followed","missed"].includes(props.lesson.progress.shadow.marks[i]||"")).length);
const done=computed(()=>markedCount.value===lines.value.length);

watch(plain, () => speech.stop());

function toggle(){if(speech.status.value==="播放中")speech.pause();else if(speech.status.value==="已暂停")speech.resume();else void speech.play(plain.value,rate.value);}
function move(delta:number){if(props.saving)return;emit("save",{...props.lesson.progress,shadow:{...props.lesson.progress.shadow,index:Math.max(0,Math.min(lines.value.length-1,index.value+delta))}});}
function mark(value: string) {
  if(props.saving || !plain.value)return;
  const marks = [...props.lesson.progress.shadow.marks];
  marks[index.value] = value;
  const nextIndex = Math.min(lines.value.length - 1, index.value + (index.value < lines.value.length - 1 ? 1 : 0));
  emit("save", { ...props.lesson.progress, shadow: { index: nextIndex, marks } });
}
</script>

<style scoped>.shadow-study{max-width:880px;width:100%;box-sizing:border-box;margin:0 auto}.shadow-study .word{line-height:1.45;margin:12px 0}.shadow-study .progress-track{margin:0}</style>
