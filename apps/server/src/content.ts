import { z } from "zod";
import {
  BANK,
  CURATED_IPA_NOTE,
  DEMO_LEMMAS,
  LEVELS,
  type BankWord,
  type Level,
  type Morphology,
} from "./bank.js";

export const THEME_ZH: Record<string, string> = {
  "Daily Life": "日常生活",
  Health: "健康",
  Technology: "科技",
  Education: "学习",
  Travel: "旅行",
  Transportation: "交通",
  Workplace: "工作",
  Food: "饮食",
  "Social Life": "社交",
  Custom: "自定义",
};

export type ListeningBand = "short" | "medium" | "long";

export type LessonWord = {
  lemma: string;
  pos: string;
  ipa: string | null;
  ipaNote: string;
  stress: string | null;
  meaningZh: string;
  definitionEn: string;
  collocation: string;
  example: string;
  exampleZh: string;
  easierExample: string | null;
  easierExampleZh: string | null;
  morphology: Morphology | null;
  difficulty: string;
  theme: string;
};

export type LessonQuestion = {
  kind: "context" | "sentence" | "listening";
  prompt: string;
  options: string[];
  answerIndex: number;
  explanationEn: string;
  explanationZh: string;
  simplerZh: string;
  evidence: string;
  whyWrong: string[];
};

export type LessonDraft = {
  source: "demo" | "offline-bank" | "ai";
  theme: string;
  difficulty: string;
  poolNote: string;
  estimatedMinutes: number;
  listeningTitle: string;
  listeningText: string;
  listeningChunks: string[];
  listeningGloss: Record<string, string>;
  words: LessonWord[];
  questions: LessonQuestion[];
};

const morphologySchema = z
  .object({
    prefix: z.string().nullable(),
    root: z.string().min(1),
    suffix: z.string().nullable(),
    meaningZh: z.string().min(1),
    example: z.string().min(1),
  })
  .nullable();

export const lessonDraftSchema = z.object({
  theme: z.string().min(1),
  difficulty: z.string().min(1),
  poolNote: z.string(),
  listeningTitle: z.string().min(1),
  listeningText: z.string().min(40),
  listeningChunks: z.array(z.string().min(1)).min(2),
  words: z
    .array(
      z.object({
        lemma: z.string().min(1),
        pos: z.string().min(1),
        ipa: z.string().nullable(),
        ipaNote: z.string(),
        stress: z.string().nullable(),
        meaningZh: z.string().min(1),
        definitionEn: z.string().min(1),
        collocation: z.string().min(1),
        example: z.string().min(1),
        exampleZh: z.string().min(1),
        easierExample: z.string().nullable(),
        easierExampleZh: z.string().nullable(),
        morphology: morphologySchema,
        difficulty: z.string().min(1),
        theme: z.string().min(1),
      }),
    )
    .min(3)
    .max(20),
  questions: z
    .array(
      z.object({
        kind: z.enum(["context", "sentence", "listening"]),
        prompt: z.string().min(1),
        options: z.array(z.string().min(1)).min(2).max(6),
        answerIndex: z.number().int().nonnegative(),
        explanationEn: z.string().min(1),
        explanationZh: z.string().min(1),
        simplerZh: z.string().min(1),
        evidence: z.string().min(1),
        whyWrong: z.array(z.string()),
      }),
    )
    .length(3),
});

export function localISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

export function estimateMinutes(newWords: number, dueCount: number, wordParts: boolean) {
  const review = Math.min(25, Math.round(10 + Math.max(0, dueCount - 5) * 0.5));
  const vocab = Math.round((15 * newWords) / 6);
  return review + vocab + (wordParts ? 5 : 0) + 20 + 5 + 5;
}

export function listeningBand(priorLessons: number, listeningLevel: string, difficulty: string): ListeningBand {
  const level = listeningLevel === "match" ? difficulty : listeningLevel;
  if (level === "A1" || level === "A2") return "short";
  if (["CET-4", "B1+", "B2", "C1", "C2"].includes(level)) {
    if (priorLessons >= 21) return "long";
    if (priorLessons >= 7) return "medium";
    return "short";
  }
  if (priorLessons < 7) return "short";
  if (priorLessons < 14) return "medium";
  return "long";
}

function rank(level: string) {
  if (level === "C1") return LEVELS.length;
  if (level === "C2") return LEVELS.length + 1;
  const index = LEVELS.indexOf(level as Level);
  return index === -1 ? 2 : index;
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function includesLemma(example: string, lemma: string) {
  return example.toLowerCase().includes(lemma.toLowerCase());
}

function hash(text: string) {
  let h = 0;
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h;
}

function withAnswer(correct: string, distractors: string[], salt: string) {
  const unique = [correct];
  for (const item of distractors) {
    if (!unique.includes(item)) unique.push(item);
    if (unique.length === 4) break;
  }
  while (unique.length < 3) unique.push(`其他意思 ${unique.length}`);
  const others = unique.filter((item) => item !== correct);
  const index = hash(salt) % (others.length + 1);
  const options = [...others];
  options.splice(index, 0, correct);
  const whyWrong = options.map((option) =>
    option === correct ? "" : `「${option}」不符合这句话的意思。`,
  );
  return { options, answerIndex: options.indexOf(correct), whyWrong };
}

function toLessonWord(word: BankWord, theme: string, keepMorphology: boolean): LessonWord {
  return {
    lemma: word.lemma,
    pos: word.pos,
    ipa: word.ipa,
    ipaNote: CURATED_IPA_NOTE,
    stress: word.stress,
    meaningZh: word.meaningZh,
    definitionEn: word.definitionEn,
    collocation: word.collocation,
    example: word.example,
    exampleZh: word.exampleZh,
    easierExample: word.easierExample,
    easierExampleZh: word.easierExampleZh,
    morphology: keepMorphology ? word.morphology : null,
    difficulty: word.level,
    theme,
  };
}

export function pickOfflineWords(input: {
  count: number;
  difficulty: string;
  theme: string;
  avoid: Set<string>;
  firstLesson: boolean;
}) {
  const notes: string[] = [];
  const useDemo =
    input.firstLesson &&
    input.count === 6 &&
    input.difficulty === "A2+" &&
    input.theme === "Daily Life" &&
    input.avoid.size === 0;

  if (useDemo) {
    const words = DEMO_LEMMAS.map((lemma) => BANK.find((item) => item.lemma === lemma)).filter(
      (item): item is BankWord => Boolean(item),
    );
    return { words, source: "demo" as const, note: "这是准备好的离线示范课，没有调用 AI。" };
  }

  let pool = BANK.filter((word) => !input.avoid.has(word.lemma.toLowerCase()));
  if (input.difficulty === "CET-4") {
    const cet = pool.filter((word) => word.cet4);
    if (cet.length >= input.count) pool = cet;
    else notes.push("四级标记词不够，已补充少量其他常用词。四级模式不是 CEFR 等级。");
  }

  const target = input.difficulty === "CET-4" ? "B1" : input.difficulty;
  const scored = [...pool].sort((a, b) => {
    const score = (word: BankWord) => {
      const themeScore = word.themes.includes(input.theme) ? 10 : 0;
      const levelScore = 6 - Math.abs(rank(word.level) - rank(target));
      const cetScore = input.difficulty === "CET-4" && word.cet4 ? 3 : 0;
      return themeScore + levelScore + cetScore;
    };
    return score(b) - score(a) || a.lemma.localeCompare(b.lemma);
  });

  if (input.theme === "Custom") {
    notes.push("离线词库没有你的自定义主题，这次先用日常高频词。配置 AI 后会按自定义主题生成。");
  } else if (!scored.some((word) => word.themes.includes(input.theme))) {
    notes.push("这个主题的未学词不多，已用相近的常用词补足。");
  }

  const selected: BankWord[] = [];
  const exact = scored.filter((word) =>
    input.difficulty === "CET-4" ? word.cet4 : word.level === input.difficulty,
  );
  for (const word of exact) {
    if (selected.length >= input.count) break;
    selected.push(word);
  }
  if (selected.length < input.count) {
    for (const word of scored) {
      if (selected.some((item) => item.lemma === word.lemma)) continue;
      selected.push(word);
      if (selected.length >= input.count) break;
    }
    if (input.difficulty !== "CET-4" && exact.length < input.count) {
      notes.push("这一档未学词不够，已加入邻近难度的词。");
    }
  }
  if (selected.length < input.count) {
    notes.push(`词库里还没学过的词只有 ${selected.length} 个。`);
  }
  return {
    words: selected,
    source: "offline-bank" as const,
    note: notes.join(""),
  };
}

function plain(line: string) {
  return line.replace(/\s*\/\s*/g, " ").replace(/\s+/g, " ").trim();
}

export function composeOfflineLesson(input: {
  count: number;
  difficulty: string;
  theme: string;
  avoid: Set<string>;
  firstLesson: boolean;
  priorLessons: number;
  listeningLevel: string;
  wordParts: boolean;
  dueCount: number;
}): LessonDraft {
  const picked = pickOfflineWords(input);
  const band = listeningBand(input.priorLessons, input.listeningLevel, input.difficulty);
  const limit = picked.source === "demo" ? picked.words.length : band === "short" ? 4 : band === "medium" ? 6 : 8;
  const spoken = picked.words.slice(0, Math.min(limit, picked.words.length));
  let morphBudget = input.wordParts ? 2 : 0;
  const words = picked.words.map((word) => {
    const keep = morphBudget > 0 && word.morphology !== null;
    if (keep) morphBudget -= 1;
    return toLessonWord(word, input.theme, keep);
  });

  const chunks = [
    band === "long" ? "Here is a short note about today." : "Here is a short note.",
    ...spoken.map((word) => word.passageLine),
  ];
  const listeningText = chunks.map(plain).join(" ");
  const gloss: Record<string, string> = {};
  for (const word of words) gloss[word.lemma.toLowerCase()] = word.meaningZh;

  const themeLabel = THEME_ZH[input.theme] || input.theme;
  const meaningPool = words.map((word) => word.meaningZh);
  const questions: LessonQuestion[] = [];
  const first = words[0];
  const second = words[Math.min(1, words.length - 1)];
  const context = withAnswer(first.meaningZh, meaningPool, first.lemma + "context");
  questions.push({
    kind: "context",
    prompt: `在句子 “${first.example}” 里，${first.lemma} 最接近哪个意思？`,
    options: context.options,
    answerIndex: context.answerIndex,
    explanationEn: `${first.lemma} means “${first.definitionEn}.”`,
    explanationZh: `这句话里的 ${first.lemma} 是「${first.meaningZh}」。`,
    simplerZh: `只看 ${first.lemma}。它在这里的意思是「${first.meaningZh}」。`,
    evidence: first.example,
    whyWrong: context.whyWrong,
  });
  const sentence = withAnswer(second.exampleZh, words.map((word) => word.exampleZh), second.lemma + "sentence");
  questions.push({
    kind: "sentence",
    prompt: `句子 “${second.example}” 主要在说什么？`,
    options: sentence.options,
    answerIndex: sentence.answerIndex,
    explanationEn: "Choose the option that matches the whole sentence, not a single unrelated word.",
    explanationZh: `整句的意思是：${second.exampleZh}`,
    simplerZh: `这句话不长。它的意思是：${second.exampleZh}`,
    evidence: second.example,
    whyWrong: sentence.whyWrong,
  });
  const listeningChoices = withAnswer(
    `几件和${themeLabel}有关的小事`,
    ["一份很难的考试说明", "一段和今天内容无关的新闻", "一个只谈语法术语的定义"],
    themeLabel + "listening",
  );
  questions.push({
    kind: "listening",
    prompt: "这段听力主要在说什么？",
    options: listeningChoices.options,
    answerIndex: listeningChoices.answerIndex,
    explanationEn: "The passage is a short note. It does not ask you to memorize every word.",
    explanationZh: "这段话是几句日常说明，抓住主要情景就可以。",
    simplerZh: "它不是新闻，也不是考试指令。就是几件日常小事。",
    evidence: listeningText,
    whyWrong: listeningChoices.whyWrong,
  });

  const draft: LessonDraft = {
    source: picked.source,
    theme: input.theme,
    difficulty: input.difficulty,
    poolNote: [
      picked.note,
      spoken.length < words.length ? "听力只自然带入了部分新词，没有把所有词塞进同一段。" : "",
      picked.source !== "demo" && band === "long"
        ? "离线长文仍然是慢速短篇，不是四级真题。"
        : "",
    ]
      .filter(Boolean)
      .join(""),
    estimatedMinutes: estimateMinutes(words.length, input.dueCount, input.wordParts),
    listeningTitle: picked.source === "demo" ? "一个短暂的早晨" : `关于${themeLabel}的短注`,
    listeningText,
    listeningChunks: chunks,
    listeningGloss: gloss,
    words,
    questions,
  };
  assertLessonDraft(draft, input.count);
  for (const word of draft.words) {
    if (wordCount(word.example) > 14) throw new Error(`例句过长：${word.lemma}`);
  }
  return draft;
}

export function assertLessonDraft(draft: LessonDraft, expectedCount: number) {
  const parsed = lessonDraftSchema.parse(draft);
  if (parsed.words.length !== expectedCount && parsed.words.length !== draft.words.length) {
    throw new Error("课程词数和校验结果不一致");
  }
  if (draft.words.length !== expectedCount) {
    throw new Error(`需要 ${expectedCount} 个词，实际 ${draft.words.length} 个`);
  }
  const lemmas = new Set<string>();
  let morphologyCount = 0;
  for (const word of draft.words) {
    const key = word.lemma.toLowerCase();
    if (lemmas.has(key)) throw new Error(`单词重复：${word.lemma}`);
    lemmas.add(key);
    if (!includesLemma(word.example, word.lemma)) throw new Error(`例句没有目标词：${word.lemma}`);
    if (word.easierExample && !includesLemma(word.easierExample, word.lemma)) {
      throw new Error(`更简单的例句没有目标词：${word.lemma}`);
    }
    if (word.morphology) {
      morphologyCount += 1;
      if (!word.lemma.toLowerCase().includes(word.morphology.root.toLowerCase())) {
        throw new Error(`词根不在单词里：${word.lemma}`);
      }
    }
  }
  if (morphologyCount > 2) throw new Error("词根拆解超过 2 个");
  const kinds = new Set(draft.questions.map((item) => item.kind));
  if (kinds.size !== 3) throw new Error("测验需要三种题");
  for (const question of draft.questions) {
    if (question.answerIndex >= question.options.length) throw new Error("正确答案超出选项");
    if (question.whyWrong.length !== question.options.length) throw new Error("错项解释数量不对");
  }
  if (plain(draft.listeningChunks.join(" ")) !== draft.listeningText && draft.listeningText.length < 40) {
    throw new Error("听力文本不完整");
  }
}

export function aiResponseSchema(expectedCount: number) {
  return z.object({
    listeningTitle: z.string().min(1),
    listeningChunks: z.array(z.string().min(1)).min(3).max(12),
    poolNote: z.string().default(""),
    words: z
      .array(
        z.object({
          lemma: z.string().min(1),
          pos: z.string().min(1),
          stress: z.string().nullable().optional(),
          meaningZh: z.string().min(1),
          definitionEn: z.string().min(1),
          collocation: z.string().min(1),
          example: z.string().min(1),
          exampleZh: z.string().min(1),
          morphology: z
            .object({
              prefix: z.string().nullable(),
              root: z.string().min(1),
              suffix: z.string().nullable(),
              meaningZh: z.string().min(1),
              example: z.string().min(1),
              confident: z.literal(true),
            })
            .nullable()
            .optional(),
        }),
      )
      .length(expectedCount),
    questions: z
      .array(
        z.object({
          kind: z.enum(["context", "sentence", "listening"]),
          prompt: z.string().min(1),
          options: z.array(z.string().min(1)).min(3).max(4),
          answerIndex: z.number().int().nonnegative(),
          explanationEn: z.string().min(1),
          explanationZh: z.string().min(1),
          simplerZh: z.string().min(1),
          evidence: z.string().min(1),
          whyWrong: z.array(z.string()).min(3),
        }),
      )
      .length(3),
  });
}

export function draftFromAi(raw: unknown, input: {
  expectedCount: number;
  theme: string;
  difficulty: string;
  dueCount: number;
  wordParts: boolean;
}): LessonDraft {
  const parsed = aiResponseSchema(input.expectedCount).parse(raw);
  let morphBudget = input.wordParts ? 2 : 0;
  const words: LessonWord[] = parsed.words.map((word) => {
    const morph = word.morphology;
    const usable =
      morphBudget > 0 &&
      morph &&
      morph.confident === true &&
      word.lemma.toLowerCase().includes(morph.root.toLowerCase());
    if (usable) morphBudget -= 1;
    return {
      lemma: word.lemma.trim(),
      pos: word.pos,
      ipa: null,
      ipaNote: "",
      stress: word.stress ?? null,
      meaningZh: word.meaningZh,
      definitionEn: word.definitionEn,
      collocation: word.collocation,
      example: word.example.trim(),
      exampleZh: word.exampleZh,
      easierExample: null,
      easierExampleZh: null,
      morphology: usable
        ? {
            prefix: morph.prefix,
            root: morph.root,
            suffix: morph.suffix,
            meaningZh: morph.meaningZh,
            example: morph.example,
          }
        : null,
      difficulty: input.difficulty,
      theme: input.theme,
    };
  });
  for (const word of words) {
    if (!includesLemma(word.example, word.lemma)) throw new Error(`例句没有目标词：${word.lemma}`);
    if (wordCount(word.example) > 16) throw new Error(`例句太长：${word.lemma}`);
  }
  const chunks = parsed.listeningChunks.map((line) => line.trim());
  const draft: LessonDraft = {
    source: "ai",
    theme: input.theme,
    difficulty: input.difficulty,
    poolNote: parsed.poolNote || "由 AI 生成。音标未核对，所以不显示。",
    estimatedMinutes: estimateMinutes(words.length, input.dueCount, input.wordParts),
    listeningTitle: parsed.listeningTitle,
    listeningText: chunks.map(plain).join(" "),
    listeningChunks: chunks,
    listeningGloss: Object.fromEntries(words.map((word) => [word.lemma.toLowerCase(), word.meaningZh])),
    words,
    questions: parsed.questions.map((question) => ({
      ...question,
      whyWrong: question.options.map((_, index) => question.whyWrong[index] || ""),
    })),
  };
  assertLessonDraft(draft, input.expectedCount);
  return draft;
}
