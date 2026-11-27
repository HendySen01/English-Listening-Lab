import { computed,ref,watch,type Ref } from "vue";
import type { Lesson } from "../stores/app";
import { api } from "../api";
type Translation = NonNullable<Lesson["listening"]["translations"]>[number];
const plain=(s:string)=>s.replace(/\s*\/\s*/g," ").replace(/\s+/g," ").trim();
export function useLessonTranslations(lesson:Ref<Lesson|null>){
  const busy=ref(false),error=ref("");
  const chunks=computed(()=>{
    const l=lesson.value?.listening;
    return l?(l.chunks.some(x=>x.trim())?l.chunks:[l.text]).map(plain):[];
  });
  const rows=computed(()=>chunks.value.map((sentence,index)=>{
    const saved=lesson.value?.listening.translations?.find(r=>r.index===index&&plain(r.sentence)===sentence);
    return {index,sentence,translation:saved?.translation||""};
  }).filter(row=>row.sentence));
  const missing=computed(()=>rows.value.filter(row=>!row.translation).length);
  watch(()=>lesson.value?.id,()=>{busy.value=false;error.value=""});
  async function complete(){
    const current=lesson.value;
    if(!current||busy.value||!missing.value)return;
    busy.value=true;error.value="";
    try{
      const result=await api<{translations:Translation[]}>(`/api/lessons/${encodeURIComponent(current.id)}/translations`,{method:"POST",body:JSON.stringify({confirmCost:true})});
      if(lesson.value?.id===current.id)lesson.value.listening.translations=result.translations;
    }catch(e){if(lesson.value?.id===current.id)error.value=e instanceof Error?e.message:"译文补充失败。";}
    finally{if(lesson.value?.id===current.id)busy.value=false;}
  }
  return {rows,missing,busy,error,complete};
}
