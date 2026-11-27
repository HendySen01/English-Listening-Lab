import assert from "node:assert/strict";
import { useSpeech } from "./useSpeech";

let requests = 0;
let spoken = 0;
let blockedOnce = true;
let rate = 0;
let providerError = false;
let browserRate = 0;
let browserText = "";
let synthesisPaused = false;
class FakeAudio {
  paused = true;
  onplay?: () => void;
  set playbackRate(value: number) { rate = value; }
  pause() { this.paused = true; }
  async play() {
    if (blockedOnce) {
      blockedOnce = false;
      throw new DOMException("Tap before playing", "NotAllowedError");
    }
    this.paused = false;
    this.onplay?.();
  }
}

const restore = {
  fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch"),
  window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  Audio: Object.getOwnPropertyDescriptor(globalThis, "Audio"),
  SpeechSynthesisUtterance: Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance"),
};
try {
  Object.defineProperties(globalThis, {
    fetch: { configurable: true, value: async () => {
      requests += 1;
      if (providerError) return Response.json({ error: "语音服务不可用" }, { status: 502 });
      return Response.json({ mode: "file", url: "data:audio/mpeg;base64,AQID" });
    } },
    window: { configurable: true, value: { speechSynthesis: {
      cancel() {},
      speaking: true,
      pause() { synthesisPaused = true; },
      resume() { synthesisPaused = false; },
      getVoices: () => [{ lang: "en-US" }],
      speak: (utterance: { text: string; rate: number; onstart: () => void }) => {
        spoken += 1; browserRate = utterance.rate; browserText = utterance.text; synthesisPaused = false; utterance.onstart();
      },
    } } },
    Audio: { configurable: true, value: FakeAudio },
    SpeechSynthesisUtterance: { configurable: true, value: class {
      constructor(public text: string) {}
    } },
  });
  const player = useSpeech();
  await player.play("Hello", 1, true);
  assert.equal(player.status.value, "已暂停");
  player.resume();
  assert.equal(player.status.value, "播放中");
  await player.play("Hello", 1.3, true);
  assert.equal(requests, 1);
  assert.equal(rate, 1.3);
  player.changeRate(0.7);
  assert.equal(rate, 0.7);
  player.pause();
  assert.equal(player.status.value, "已暂停");
  player.changeRate(1);
  assert.equal(rate, 1);
  player.resume();
  await player.replay("Hello", 1.3);
  assert.equal(rate, 1.3);
  assert.equal(requests, 1);
  assert.equal(useSpeech().hasOnlineClip("Hello"), false);
  providerError = true;
  await player.play("New text", 1, true);
  assert.match(player.detail.value, /浏览器语音/);
  await player.play("New text", 1);
  assert.equal(spoken, 1);
  assert.equal(browserRate, 1);
  player.changeRate(0.7);
  assert.equal(browserRate, 0.7);
  assert.equal(browserText, "New text");
  player.pause();
  assert.equal(synthesisPaused, true);
  player.changeRate(1.3);
  player.resume();
  assert.equal(synthesisPaused, false);
  assert.equal(browserRate, 1.3);
  assert.equal(requests, 2);
  player.stop();
} finally {
  for (const [key, descriptor] of Object.entries(restore)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
console.log("speech playback selftest ok");
