import { ref } from "vue";
import { api } from "../api";

const status = ref("空闲");
const detail = ref("");
const sourceLabel = ref("尚未播放");
let audio: HTMLAudioElement | null = null;

export function useSpeech() {
  async function play(text: string, rate: number, useOnline = false) {
    stop();
    status.value = "准备";
    detail.value = "";
    const result = await api<{ mode: string; url?: string; warning?: string; sourceLabel?: string }>("/api/tts", {
      method: "POST",
      body: JSON.stringify({ text, rate, useOnline }),
    });
    sourceLabel.value = result.sourceLabel || (result.mode === "file" ? "在线 AI 语音" : "浏览器语音");
    if (result.warning) detail.value = result.warning;
    if (result.mode === "file" && result.url) {
      audio = new Audio(result.url);
      audio.playbackRate = rate;
      audio.onplay = () => {
        status.value = "播放中";
      };
      audio.onended = () => {
        status.value = "空闲";
      };
      audio.onerror = () => {
        status.value = "失败";
        detail.value = "音频文件无法播放。";
      };
      await audio.play();
      return;
    }
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
      status.value = "播放中";
    };
    utterance.onend = () => {
      status.value = "空闲";
    };
    utterance.onerror = () => {
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
      void audio.play();
      status.value = "播放中";
      return;
    }
    window.speechSynthesis?.resume();
    status.value = "播放中";
  }

  function stop() {
    audio?.pause();
    audio = null;
    window.speechSynthesis?.cancel();
    status.value = "空闲";
  }

  return { status, detail, sourceLabel, play, pause, resume, stop };
}
