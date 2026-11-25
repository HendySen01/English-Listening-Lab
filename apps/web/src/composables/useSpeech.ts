import { ref } from "vue";
import { api } from "../api";

const status = ref("空闲");
const detail = ref("");
const sourceLabel = ref("当前语音：尚未播放");
let audio: HTMLAudioElement | null = null;
let playback = 0;
let pending: AbortController | null = null;

export function useSpeech() {
  // Keep only the most recent clip for this player instance. Never persist private audio.
  let clip: { text: string; url: string; label: string } | null = null;

  async function play(text: string, rate: number, useOnline = false) {
    stop();
    const current = playback;
    status.value = "准备";
    detail.value = "";
    if (useOnline) {
      try {
        if (clip?.text !== text) {
          pending = new AbortController();
          const result = await api<{ mode: string; url?: string; warning?: string; sourceLabel?: string }>("/api/tts", {
            method: "POST", signal: pending.signal, body: JSON.stringify({ text, rate, useOnline }),
          });
          if (current !== playback) return;
          if (result.mode !== "file" || !result.url) throw new Error(result.warning || "在线音频不可用。");
          clip = { text, url: result.url, label: result.sourceLabel || "当前语音：在线语音" };
        }
        audio = new Audio(clip.url);
        sourceLabel.value = clip.label;
        audio.playbackRate = rate;
        audio.onplay = () => { if (current === playback) status.value = "播放中"; };
        audio.onended = () => { if (current === playback) status.value = "空闲"; };
        audio.onerror = () => {
          if (current !== playback) return;
          clip = null;
          status.value = "失败";
          detail.value = "在线音频无法播放。";
        };
        await audio.play();
      } catch (error) {
        if (current !== playback) return;
        if (audio && error instanceof DOMException && error.name === "NotAllowedError") {
          status.value = "已暂停";
          detail.value = "音频已准备好，点继续播放。";
          return;
        }
        status.value = "失败";
        detail.value = `${error instanceof Error ? error.message : "在线朗读失败。"} 点击播放可使用浏览器语音。`;
      } finally {
        if (current === playback) pending = null;
      }
      return;
    }
    sourceLabel.value = "当前语音：浏览器语音";
    if (!("speechSynthesis" in window)) {
      status.value = "失败";
      detail.value = "这个浏览器没有语音合成。请使用 Edge 或 Chrome，或在后端配置 TTS。";
      return;
    }
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = rate;
    const voices = synth.getVoices();
    const voice = voices.find((item) => /^en(-|_)?/i.test(item.lang));
    if (!voice) detail.value = "没有找到英语语音。浏览器可能仍会尝试朗读，但音色和语速不一定符合预期。";
    else utterance.voice = voice;
    utterance.onstart = () => {
      if (current !== playback) return;
      status.value = "播放中";
    };
    utterance.onend = () => {
      if (current !== playback) return;
      status.value = "空闲";
    };
    utterance.onerror = () => {
      if (current !== playback) return;
      status.value = "失败";
      detail.value = "浏览器语音播放失败。";
    };
    synth.speak(utterance);
  }

  function pause() {
    if (audio && !audio.paused) {
      audio.pause();
      status.value = "已暂停";
      return;
    }
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause();
      status.value = "已暂停";
      detail.value = "浏览器语音的暂停和继续并不稳定，Edge 和 Chrome 的表现可能不同。";
    }
  }

  function resume() {
    if (audio?.paused) {
      const current = playback;
      detail.value = "";
      void audio.play().catch(() => {
        if (current !== playback) return;
        status.value = "失败";
        detail.value = "无法继续播放在线音频。点击播放可使用浏览器语音。";
      });
      return;
    }
    window.speechSynthesis?.resume();
    status.value = "播放中";
  }

  function stop() {
    playback += 1;
    pending?.abort();
    pending = null;
    audio?.pause();
    audio = null;
    window.speechSynthesis?.cancel();
    status.value = "空闲";
  }

  function changeRate(rate: number) {
    if (!audio) return false;
    audio.playbackRate = rate;
    return true;
  }

  function hasOnlineClip(text: string) {
    return clip?.text === text;
  }

  return { status, detail, sourceLabel, play, pause, resume, stop, changeRate, hasOnlineClip };
}
