import { z } from "zod";

const english = z.string().trim().min(1).max(240)
  .refine(value => /[a-z]/i.test(value) && !/\p{Script=Han}|[\r\n]/u.test(value));
const formationSchema = z.object({
  parts: z.array(z.object({
    kind: z.enum(["prefix", "base", "suffix"]),
    text: z.string().trim().regex(/^[a-z]+(?:-[a-z]+)*$/i).max(40),
    explanationEn: english,
  }).strict()).max(8),
  definitionEn: english,
}).strict();

export const formationVersion = "word-formation-v1";
export const formationPrompt = [
  '另输出 wordFormation: {"parts":[{"kind":"base","text":"brief","explanationEn":"Short in time or length."},{"kind":"suffix","text":"ly","explanationEn":"Forms an adverb that describes how something is done."}],"definitionEn":"In a short or concise way."}。',
  "wordFormation 只分析现代英语中确实存在的构词。parts 按实际顺序列出 prefix、base 或 suffix，复合词可以有多个 base，也可以有多个词缀。text 不含词缀标记；所有成分拼接后必须匹配目标拼写（忽略复合词的连字符）。",
  "至少有两个可靠成分才拆分。不可合理拆分、拼写无法对应、或目标是短语时，parts 用 []，仍提供整个目标的 definitionEn。每条解释用一句简单自然的英语。不要在 etymology 中重复现代拆分；只填写有依据的历史构词成分，其余使用空字符串。",
].join("\n");

export function validateWordFormation(raw: unknown, target: string) {
  const result = formationSchema.safeParse(raw);
  if (!result.success) return null;
  const { parts } = result.data;
  if (parts.length === 0) return result.data;
  const rank = { prefix: 0, base: 1, suffix: 2 };
  const spelling = (text: string) => text.toLowerCase().replaceAll("-", "");
  if (parts.length < 2 || !parts.some(part => part.kind === "base")
      || parts.some((part, index) => index > 0 && rank[part.kind] < rank[parts[index - 1].kind])
      || spelling(parts.map(part => part.text).join("")) !== spelling(target)) return null;
  return result.data;
}
