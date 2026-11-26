import { z } from "zod";
import { AppError } from "./errors.js";

export const normalizePassage = (value: string) => value.replace(/\s*\/\s*/g," ").replace(/\s+/g," ").trim();
export type Translation = { index: number; sentence: string; translation: string };
export const translationVersion = "listening-translation-v1";
const prefix = "@sentence:v1:";
const pair = z.object({index:z.number().int().nonnegative(),sentence:z.string().min(1).max(1500),translation:z.string().trim().min(1).max(1200)}).strict();
const key = (index: number, sentence: string) => prefix + index + ":" + normalizePassage(sentence);
export function passages(chunks: string[], text: string) {
  return (chunks.some(x=>x.trim()) ? chunks : [text]).map(normalizePassage);
}
// Keep the existing JSON column backward-compatible with string-valued vocabulary glosses.
// Only the namespaced entries belong to passage translations.
export function vocabularyGloss(gloss: Record<string,string>) {
  return Object.fromEntries(Object.entries(gloss).filter(([k])=>!k.startsWith(prefix)));
}
export function savedTranslations(chunks: string[], gloss: Record<string,string>) {
  return chunks.flatMap((sentence,index)=>{
    const translation=gloss[key(index,sentence)];
    return typeof translation==="string" && translation.trim() ? [{index,sentence,translation}] : [];
  });
}
export function addTranslations(gloss: Record<string,string>, rows: Translation[]) {
  return {...gloss,...Object.fromEntries(rows.map(row=>[key(row.index,row.sentence),row.translation]))};
}
export function validateTranslations(raw: unknown, expected: {index:number;sentence:string}[]): Translation[] {
  const parsed=z.array(pair).safeParse(raw);
  if(!parsed.success || parsed.data.length!==expected.length)throw new AppError(502,"AI_RESPONSE_REJECTED","译文数量或格式不完整。");
  return expected.map(({index,sentence},i)=>{
    const row=parsed.data[i];
    if(row.index!==index || normalizePassage(row.sentence)!==normalizePassage(sentence) || !/\p{Script=Han}/u.test(row.translation))throw new AppError(502,"AI_RESPONSE_REJECTED","译文与原句未正确对应。");
    return {index,sentence:normalizePassage(sentence),translation:row.translation};
  });
}
