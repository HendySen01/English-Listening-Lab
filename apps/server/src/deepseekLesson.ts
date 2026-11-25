import { draftFromAi, listeningBand } from "./content.js";
import { AppError } from "./errors.js";
import { aiOutputTokenLimit, assertRealSpendAllowed } from "./learnerQuota.js";

export function deepseekLessonStatus() {
  const configured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  return {
    configured,
    available: configured && process.env.AI_REAL_CALLS === "1" && process.env.AI_QUOTA_PAUSED !== "1",
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
  };
}

export function deepseekLessonRequest(settings: {
  dailyNewWords: number; difficulty: string; theme: string; customTheme: string;
  listeningLevel: string; wordPartsEnabled: boolean;
}, recentWords: string[], priorLessons: number, dueCount: number) {
  const status = deepseekLessonStatus();
  const theme = settings.theme === "Custom" ? settings.customTheme.trim() || "Daily Life" : settings.theme;
  const options = {
    expectedCount: settings.dailyNewWords, theme, difficulty: settings.difficulty,
    dueCount, wordParts: settings.wordPartsEnabled,
  };
  const system = [
    "You are an English learning editor. Return one JSON object, with concise fields and Simplified Chinese translations.",
    "Use a short complete English example containing the exact lemma (4–12 words). Never generate IPA or stress.",
    "Write an original English listening passage in 3–12 chunks. Each quiz needs grounded evidence and distinct options.",
    "Exactly one quiz of each kind: context, sentence, listening. answerIndex is zero-based.",
  ].join(" ");
  const user = JSON.stringify({
    count: options.expectedCount, theme, difficulty: options.difficulty, avoid: recentWords,
    listeningLevel: settings.listeningLevel === "match" ? options.difficulty : settings.listeningLevel,
    listeningLength: listeningBand(priorLessons, settings.listeningLevel, options.difficulty),
    morphology: options.wordParts ? "Up to two reliable examples; otherwise null" : "Always null",
    schema: {
      listeningTitle: "English title", listeningChunks: ["English sentence or chunk"], poolNote: "简短说明",
      words: [{ lemma: "word", pos: "part of speech", meaningZh: "中文", definitionEn: "short definition",
        collocation: "common phrase", example: "English sentence", exampleZh: "中文",
        morphology: "null or {prefix, root, suffix, meaningZh, example, confident:true}; use null for absent affixes" }],
      questions: [{ kind: "context | sentence | listening", prompt: "question", options: ["a", "b", "c"],
        answerIndex: 0, explanationEn: "English", explanationZh: "中文", simplerZh: "简短中文",
        evidence: "source phrase", whyWrong: ["", "reason", "reason"] }],
    },
  });
  const inputTokens = Buffer.byteLength(system + user) + 128;
  const outputTokens = Math.min(aiOutputTokenLimit(), 950 + 220 * options.expectedCount);
  return {
    model: status.model, inputTokens, outputTokens,
    async generate() {
      assertRealSpendAllowed();
      const key = process.env.DEEPSEEK_API_KEY?.trim();
      if (!key) throw new AppError(503, "AI_NOT_SENT", "尚未配置 DeepSeek 课程生成。");
      const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: status.model, max_tokens: outputTokens, response_format: { type: "json_object" },
          ...(status.model.startsWith("deepseek-v4") ? { thinking: { type: "disabled" } } : {}),
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      }).catch(() => { throw new AppError(502, "AI_CONNECTION", "DeepSeek 暂未响应，请先查看当前课程。"); });
      if (!response.ok) throw new AppError(502, "AI_RESPONSE_REJECTED", "DeepSeek 没有返回可用课程。");
      try {
        const data = await response.json();
        const choice = data.choices?.[0];
        if (choice?.finish_reason !== "stop") throw new Error("incomplete");
        const raw = JSON.parse(choice.message.content);
        const draft = draftFromAi(raw, options);
        if (draft.listeningText.length > 1500 || draft.questions.some(({ options }) => new Set(options.map((value) => value.trim().toLowerCase())).size !== options.length)) {
          throw new Error("invalid lesson content");
        }
        return draft;
      } catch {
        throw new AppError(502, "AI_RESPONSE_REJECTED", "课程内容未通过校验。原课程仍可学习。");
      }
    },
  };
}
