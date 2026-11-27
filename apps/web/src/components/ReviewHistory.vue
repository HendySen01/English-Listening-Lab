<template>
  <details class="review-history" @toggle="toggle">
    <summary>复习历史 <span class="rd-note">最近 20 次正式复习</span></summary>
    <p v-if="loading" class="rd-note" role="status">正在读取复习记录…</p>
    <div v-else-if="error" role="alert"><p class="bad">{{ error }}</p><button class="rd-pill" @click="load">重试</button></div>
    <p v-else-if="events && !events.length" class="rd-note">还没有正式复习记录。</p>
    <ol v-else-if="events" class="history-events">
      <li v-for="event in events" :key="event.id">
        <div><strong>{{ label(event.rating) }}</strong><span class="rd-note">{{ formatWhen(event.createdAt) }}</span></div>
        <div><strong>{{ formatIntervalMinutes(Math.max(0,(new Date(event.dueAfter).getTime()-new Date(event.createdAt).getTime())/60000)) }}</strong><span class="rd-note">至 {{ formatWhen(event.dueAfter) }}</span></div>
      </li>
    </ol>
    <p v-if="events?.length" class="rd-note">间隔根据实际保存的评分时间与下次时间计算，不包含提前练习。</p>
  </details>
</template>
<script setup lang="ts">
import { ref,onBeforeUnmount } from "vue";
import { api } from "../api";
import { formatWhen } from "../lib/due";
import { formatIntervalMinutes,grades } from "../lib/reviewPresentation";
type ReviewEvent={id:string;rating:string;createdAt:string;dueAfter:string};
const props=defineProps<{wordId:string}>();
const events=ref<ReviewEvent[]|null>(null),loading=ref(false),error=ref("");
let alive=true;
onBeforeUnmount(()=>{alive=false});
function label(value:string){return grades.find(g=>g.id===value)?.label||"已评分";}
function toggle(event:Event){if((event.target as HTMLDetailsElement).open && !events.value&&!loading.value)void load();}
async function load(){
  if(loading.value)return;
  loading.value=true;error.value="";
  try{const result=await api<{events:ReviewEvent[]}>(`/api/review/${encodeURIComponent(props.wordId)}/history`);if(alive)events.value=result.events;}
  catch(e){if(alive)error.value=e instanceof Error?e.message:"暂时无法读取复习历史。";}
  finally{if(alive)loading.value=false;}
}
</script>
<style scoped>
.review-history{border-top:1px solid var(--line);padding-top:14px;margin-top:18px}
.review-history summary{cursor:pointer;font-weight:650;color:var(--accent-text);padding:8px 0;min-height:32px}
.review-history summary .rd-note{font-weight:400;margin-left:8px}
.history-events{list-style:none;padding:0;margin:8px 0}
.history-events li{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line)}
.history-events li div{display:grid;gap:3px}.history-events li div:last-child{text-align:right}
</style>
