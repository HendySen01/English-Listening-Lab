import { computed, onScopeDispose, watch } from "vue";
import { speechRates, useAppStore } from "../stores/app";
import { useSpeech } from "./useSpeech";

export function useStudySpeech() {
  const store = useAppStore();
  const speech = useSpeech();
  const rate = computed(() => store.speechRate);
  onScopeDispose(speech.stop);
  watch(rate, speech.changeRate, { flush: "sync" });
  return {
    speech,
    rate,
    rates: speechRates,
    rateBusy: computed(() => store.speechRateBusy),
    rateError: computed(() => store.speechRateError),
    setRate: (rate: number) => store.setSpeechRate(rate),
  };
}
