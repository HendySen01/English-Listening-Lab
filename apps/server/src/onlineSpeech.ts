import { AppError } from "./errors.js";
import { authDb } from "./runtimeClients.js";
import { normalizeDeepseekVoice } from "./ai.js";

const deepseekOrigin = "https://api.deepseek.com";
const maxAudioBytes = 3_000_000;

function speechConfig() {
  const legacyDirect = /^https:\/\/api\.deepseek\.com(?:\/(?!\/)[^?#]*)?$/i.test(process.env.LLM_BASE_URL?.trim() || "");
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim() || (legacyDirect ? process.env.LLM_API_KEY?.trim() : "");
  const openaiKey = process.env.ONLINE_TTS_API_KEY?.trim();
  const provider = process.env.ONLINE_TTS_PROVIDER?.trim().toLowerCase() || (deepseekKey ? "deepseek" : "openai");
  if (provider !== "deepseek" && provider !== "openai") return null;
  const deepseek = provider === "deepseek";
  const key = deepseek ? deepseekKey : openaiKey;
  return {
    deepseek, key,
    host: deepseek ? "DeepSeek" : "OpenAI",
    model: deepseek ? "/v1/tools/tts" : "tts-1",
    voice: deepseek ? normalizeDeepseekVoice(process.env.TTS_VOICE?.trim() || "") : "alloy",
  };
}

export function onlineSpeechStatus() {
  const config = speechConfig();
  const configured = Boolean(config?.key);
  const usable = configured && process.env.ONLINE_TTS_ENABLED === "1";
  return {
    ttsConfigured: configured, ttsUsable: usable,
    ttsState: !config ? "供应商配置无效" : usable ? "已配置，可手动使用" : configured ? "已暂停" : "未配置",
    ttsHost: configured ? config?.host : null, ttsModel: configured ? config?.model : null,
    ttsVoice: configured ? config?.voice : null,
    ttsNote: usable ? "默认使用浏览器语音。在线朗读需要手动确认，额度单独计算。" : "当前使用浏览器语音。",
  };
}

async function reserveSpeech(learnerId: string, now: number) {
  const start = BigInt(Math.floor(now / 86_400_000) * 86_400_000);
  await authDb().$transaction(async (tx) => {
    for (const [key, limit] of [["lab-tts:site", 200], [`lab-tts:user:${learnerId}`, 20]] as const) {
      await tx.rateLimit.upsert({
        where: { key },
        create: { id: key, key, count: 0, lastRequest: start },
        update: { key },
      });
      await tx.rateLimit.updateMany({ where: { key, lastRequest: { lt: start } }, data: { lastRequest: start, count: 0 } });
      const reserved = await tx.rateLimit.updateMany({ where: { key, lastRequest: start, count: { lt: limit } }, data: { count: { increment: 1 } } });
      if (!reserved.count) throw new AppError(429, "TTS_LIMIT", "今天的在线朗读次数已用完。");
    }
  });
}

export async function synthesizeOnline(learnerId: string, input: unknown) {
  const config = speechConfig();
  if (!config?.key || process.env.ONLINE_TTS_ENABLED !== "1") {
    throw new AppError(403, "ONLINE_TTS_DISABLED", "在线语音尚未启用。");
  }
  const text = typeof input === "string" ? input.trim() : "";
  if (!text || text.length > 1500) throw new AppError(400, "TTS_TEXT", "请输入 1 到 1500 个字符。");
  await reserveSpeech(learnerId, Date.now());
  const url = config.deepseek ? `${deepseekOrigin}/v1/tools/tts` : "https://api.openai.com/v1/audio/speech";
  const audioType = config.deepseek ? "audio/wav" : "audio/mpeg";
  const body = config.deepseek
    ? { text, voice_id: config.voice, format: "wav" }
    : { model: config.model, voice: config.voice, input: text, response_format: "mp3" };
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok || !response.headers.get("content-type")?.startsWith("audio/") || !response.body) {
    throw new AppError(502, "TTS_UPSTREAM", "在线朗读暂不可用，可以使用浏览器语音。");
  }
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maxAudioBytes) {
        await reader.cancel();
        throw new Error("audio exceeds response size limit");
      }
      chunks.push(chunk.value);
    }
  } catch {
    throw new AppError(502, "TTS_UPSTREAM", "在线朗读未返回完整音频，请使用浏览器语音。");
  } finally {
    reader.releaseLock();
  }
  const audio = Buffer.concat(chunks, size);
  if (!audio.length || (config.deepseek && (audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE"))) {
    throw new AppError(502, "TTS_UPSTREAM", "在线朗读返回的音频无法播放。");
  }
  return { url: `data:${audioType};base64,${audio.toString("base64")}`, sourceLabel: `当前语音：在线语音 · ${config.host}` };
}
