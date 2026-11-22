import { prisma } from "./prisma.js";
import { AppError } from "./errors.js";

type ChatResult = {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

function llmConfig() {
  const key = process.env.LLM_API_KEY?.trim() || "";
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  return { key, base, model };
}

export function llmStatus() {
  const { key, base, model } = llmConfig();
  return { configured: Boolean(key), model: key ? model : "", host: hostOf(base) };
}

export async function serviceStatus() {
  const llm = llmStatus();
  const tts = ttsStatus();
  const latest = await prisma.aIUsageRecord.findFirst({ orderBy: { createdAt: "desc" } });
  const latestOk = await prisma.aIUsageRecord.findFirst({ where: { success: true }, orderBy: { createdAt: "desc" } });
  const today = await prisma.aIUsageRecord.findMany({
    where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) } },
  });
  const promptTokens = today.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0);
  const completionTokens = today.reduce((sum, item) => sum + (item.completionTokens ?? 0), 0);
  let llmState = "未配置";
  if (llm.configured && latestOk) llmState = "已有成功调用";
  else if (llm.configured && latest && !latest.success) llmState = "已配置，最近一次失败";
  else if (llm.configured) llmState = "已配置，尚未验证";
  return {
    llmConfigured: llm.configured,
    llmState,
    llmModel: llm.model,
    llmHost: llm.host,
    llmProvider: providerName(llm.host),
    ttsConfigured: tts.configured,
    ttsUsable: tts.usable,
    ttsState: tts.state,
    ttsModel: tts.model,
    ttsVoice: tts.voice,
    ttsHost: tts.host,
    ttsNote: tts.note,
    aiUsedToday: today.length,
    aiDailyLimit: dailyLimit(),
    promptTokens: today.some((item) => item.promptTokens != null) ? promptTokens : null,
    completionTokens: today.some((item) => item.completionTokens != null) ? completionTokens : null,
    lastSuccessAt: latestOk?.createdAt ?? null,
    lastError: latest && !latest.success ? latest.error : null,
    speechNote: "浏览器语音和在线语音分开显示。播放器会写明这次实际用的是哪一种。",
  };
}

export function dailyLimit() {
  const value = Number(process.env.AI_DAILY_LIMIT || 12);
  return Number.isFinite(value) && value > 0 ? value : 12;
}

export async function aiUsedToday(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return prisma.aIUsageRecord.count({ where: { createdAt: { gte: start } } });
}

async function assertQuota() {
  const used = await aiUsedToday();
  if (used >= dailyLimit()) {
    throw new AppError(429, "AI_LIMIT", `今天的 AI 调用已达到上限 ${dailyLimit()} 次。已保存的课程不会受影响。`);
  }
}

export async function chatJson(kind: string, system: string, user: string): Promise<ChatResult> {
  const { key, base, model } = llmConfig();
  if (!key) throw new AppError(400, "NO_LLM_KEY", "还没有配置 LLM_API_KEY。当前可以使用离线课程。");
  await assertQuota();
  const bodyBase = {
    model,
    temperature: 0.4,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...bodyBase, response_format: { type: "json_object" } }),
    });
    if (response.status === 400) {
      response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyBase),
      });
    }
  } catch {
    await prisma.aIUsageRecord.create({
      data: { kind, model, success: false, error: "network" },
    });
    throw new AppError(502, "AI_UNREACHABLE", "连不上语言模型接口。请检查 LLM_BASE_URL、网络和密钥。今天已有的课程仍然保留。");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = sanitizeProviderMessage(payload);
    await prisma.aIUsageRecord.create({
      data: { kind, model, success: false, error: `http ${response.status}${detail ? `: ${detail}` : ""}`.slice(0, 240) },
    });
    throw new AppError(
      502,
      "AI_REJECTED",
      `语言模型接口返回 ${response.status}${detail ? `：${detail}` : ""}。没有把不完整内容存成课程。`,
    );
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    await prisma.aIUsageRecord.create({
      data: { kind, model, success: false, error: "empty" },
    });
    throw new AppError(502, "AI_EMPTY", "语言模型没有返回可用文本。");
  }
  await prisma.aIUsageRecord.create({
    data: {
      kind,
      model,
      success: true,
      promptTokens: numberOrNull(payload?.usage?.prompt_tokens),
      completionTokens: numberOrNull(payload?.usage?.completion_tokens),
    },
  });
  return {
    content,
    model,
    promptTokens: numberOrNull(payload?.usage?.prompt_tokens),
    completionTokens: numberOrNull(payload?.usage?.completion_tokens),
  };
}

export function parseModelJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1] : content;
  return JSON.parse(text);
}

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}

function sanitizeProviderMessage(payload: unknown) {
  const message = (payload as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof message !== "string") return "";
  return message.replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]").slice(0, 160);
}

export function providerName(host: string) {
  if (host.includes("deepseek")) return "DeepSeek";
  if (host.includes("openai")) return "OpenAI";
  return host || "未配置";
}

export function ttsStatus() {
  const key = process.env.TTS_API_KEY?.trim() || "";
  const base = process.env.TTS_BASE_URL?.trim() || "";
  const model = process.env.TTS_MODEL || "";
  const voice = process.env.TTS_VOICE || "";
  const host = hostOf(base);
  const deepseek = host.includes("deepseek");
  if (!key || !base) {
    return { configured: false, usable: false, state: "未配置", model: "", voice: "", host, note: "没有在线语音配置。当前播放使用浏览器语音。" };
  }
  if (deepseek) {
    const mapped = normalizeDeepseekVoice(voice);
    return {
      configured: true,
      usable: true,
      state: "尚未验证",
      model: "POST /v1/tools/tts",
      voice: mapped,
      host,
      note: `配置里的 TTS_MODEL=${model || "空"} 不是语音模型，不会拿去请求。DeepSeek 在线语音是独立的 /v1/tools/tts，音色只有 stella 和 tide，当前会使用 ${mapped}。还没有成功的在线播放记录，所以状态是尚未验证。默认播放仍是浏览器语音。`,
    };
  }
  return {
    configured: true,
    usable: true,
    state: "已配置，尚未在本页验证",
    model: model || "tts-1",
    voice: voice || "alloy",
    host,
    note: "将按 OpenAI 兼容的 /audio/speech 请求。如果接口不支持，会改用浏览器语音并说明原因。",
  };
}

export function normalizeDeepseekVoice(voice: string) {
  return voice === "tide" ? "tide" : "stella";
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
