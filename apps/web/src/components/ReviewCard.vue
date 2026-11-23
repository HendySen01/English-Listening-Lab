<template>
  <div class="stack">
    <h2 class="word">{{ item.lemma }}</h2>
    <p class="muted">{{ item.pos }} {{ item.ipa }}</p>
    <button class="text-button" @click="show = !show">{{ show ? "隐藏" : "查看意思和例句" }}</button>
    <template v-if="show">
      <p>{{ item.meaningZh }}</p>
      <p>{{ item.example }}</p>
      <p class="muted">{{ item.exampleZh }}</p>
    </template>
    <label class="row"><input type="checkbox" v-model="recognizeOnly" /> 我只是认得，还不能自己用</label>
    <div class="row">
      <button class="choice" :disabled="ratingBusy" @click="rate('again')">忘记 · {{ item.intervals?.again ?? "—" }} 天</button>
      <button class="choice" :disabled="ratingBusy" @click="rate('hard')">困难 · {{ item.intervals?.hard ?? "—" }} 天</button>
      <button class="choice" :disabled="ratingBusy" @click="rate('good')">记得 · {{ item.intervals?.good ?? "—" }} 天</button>
      <button class="choice" :disabled="ratingBusy" @click="rate('easy')">非常熟悉 · {{ item.intervals?.easy ?? "—" }} 天</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import { progressStamp, withReviewRequest } from "../lib/reviewRequest";

const props = defineProps<{ item: any }>();
const emit = defineEmits<{ done: [] }>();
const show = ref(false);
const recognizeOnly = ref(false);
const ratingBusy = ref(false);

async function rate(rating: string) {
  if (ratingBusy.value) return;
  ratingBusy.value = true;
  const recallAbility = recognizeOnly.value ? "recognize" : "recall";
  try {
    await withReviewRequest(`formal:${props.item.id}`, { rating, recallAbility, progress: progressStamp(props.item) }, (body) =>
      api(`/api/review/${props.item.id}/rate`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    emit("done");
  } finally {
    ratingBusy.value = false;
  }
}
</script>
