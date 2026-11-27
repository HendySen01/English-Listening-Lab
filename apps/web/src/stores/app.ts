import { defineStore } from "pinia";
import { api } from "../api";

import { normalizeSpeechRate, speechRates as allowedRates } from "../lib/speechRates";

export const speechRates: readonly number[] = allowedRates;

export type Lesson = {
  id: string;
  lessonDate: string;
  theme: string;
  themeLabel: string;
  difficulty: string;
  learningDirection?: string | null;
  newWordCount: number;
  estimatedMinutes: number;
  source: string;
  sourceLabel: string;
  poolNote: string;
  progress: Progress;
  listening: { title: string; text: string; chunks: string[]; gloss: Record<string, string>; translations?: Array<{index:number;sentence:string;translation:string}> };
  words: Word[];
  questions: Question[];
};

export type Word = {
  id: string;
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
  morphology: { prefix: string | null; root: string; suffix: string | null; meaningZh: string; example: string } | null;
  knownAlready: boolean;
  familiarity: string;
  reps: number;
  due: string | null;
  lastReview: string | null;
  lapses: number;
  state: number;
  correctCount: number;
  incorrectCount: number;
  intervals: { again: number; hard: number; good: number; easy: number } | null;
  intervalMinutes?: { again: number; hard: number; good: number; easy: number } | null;
};

export type Question = {
  id: string;
  kind: string;
  prompt: string;
  options: string[];
  answered: boolean;
  selected: number | null;
  correct: boolean | null;
  answerIndex: number | null;
  explanationEn: string | null;
  explanationZh: string | null;
  evidence: string | null;
  whyWrong: string[] | null;
};

export type Progress = {
  step: string;
  completed: string[];
  wordIndex: number;
  listening: { round: number; firstGist: string; thirdGist: string; recall: string; recallNote: string; recallMode: string };
  shadow: { index: number; marks: Array<string | null> };
};

export const useAppStore = defineStore("app", {
  state: () => ({
    dashboard: null as any,
    system: null as any,
    loading: false,
    speechRate: 1,
    speechRateBusy: false,
    speechRateError: "",
    speechRateVersion: 0,
    error: "",
  }),
  actions: {
    async setSpeechRate(rate: number) {
      if (this.speechRateBusy || rate === this.speechRate || !speechRates.includes(rate)) return;
      const previous = this.speechRate;
      const version = ++this.speechRateVersion;
      this.speechRate = rate;
      this.speechRateBusy = true;
      this.speechRateError = "";
      try {
        const settings = await api<{ speechRate: number }>("/api/settings", {
          method: "PUT", body: JSON.stringify({ speechRate: rate }),
        });
        if (version === this.speechRateVersion) this.speechRate = normalizeSpeechRate(settings.speechRate);
      } catch (error) {
        if (version !== this.speechRateVersion) return;
        this.speechRate = previous;
        this.speechRateError = error instanceof Error ? error.message : "语速保存失败";
      } finally {
        if (version === this.speechRateVersion) this.speechRateBusy = false;
      }
    },
    resetSession() {
      this.speechRateVersion += 1;
      this.speechRate = 1;
      this.speechRateBusy = false;
      this.speechRateError = "";
      this.dashboard = null;
    },
    async load() {
      const rateVersion = this.speechRateVersion;
      this.loading = true;
      this.error = "";
      try {
        const [dashboard, system] = await Promise.all([api<any>("/api/dashboard"), api<any>("/api/system")]);
        this.dashboard = dashboard;
        if (this.speechRateVersion === rateVersion && !this.speechRateBusy) {
          this.speechRate = normalizeSpeechRate(dashboard.settings.speechRate);
        }
        this.system = system;
        applyTheme(dashboard.settings.colorMode);
      } catch (error) {
        this.error = error instanceof Error ? error.message : "加载失败";
      } finally {
        this.loading = false;
      }
    },
  },
});

export function applyTheme(mode: string) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = mode === "dark" || (mode === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  localStorage.setItem("ell-color-mode", mode);
}

export function watchSystemTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if ((localStorage.getItem("ell-color-mode") || "system") === "system") applyTheme("system");
  });
}
