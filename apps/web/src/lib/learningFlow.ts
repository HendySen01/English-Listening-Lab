import type { Progress } from "../stores/app";
export const steps = [
  {id:"review",label:"复习",english:"Recall",description:"回忆已学词，再查看答案。"},
  {id:"vocabulary",label:"新词",english:"Vocabulary",description:"从例句理解新词，留意搭配。"},
  {id:"parts",label:"词根",english:"Word formation",description:"理解构词与词源，不强行拆解。"},
  {id:"listening",label:"听力",english:"Listen & read",description:"盲听、英文概述、对照原文、再听。"},
  {id:"shadow",label:"跟读",english:"Shadowing",description:"听一句，跟读一句，注意节奏。"},
  {id:"recall",label:"回忆",english:"Active output",description:"用自己的英语表达，并完成回忆与测验。"},
] as const;
export function completedCount(progress?:Progress) {
  return steps.filter(step=>progress?.completed?.includes(step.id)).length;
}
export function nextProgress(progress:Progress,target:string,complete=false) {
  const completed=complete && steps.some(s=>s.id===progress.step)
    ? [...new Set([...progress.completed,progress.step])] : [...progress.completed];
  return {...progress,step:target,completed};
}
