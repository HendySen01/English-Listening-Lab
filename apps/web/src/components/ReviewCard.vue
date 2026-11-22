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
      <button class="choice" @click="rate('again')">忘记 · {{ item.intervals?.again ?? "—" }} 天</button>
      <button class="choice" @click="rate('hard')">困难 · {{ item.intervals?.hard ?? "—" }} 天</button>
      <button class="choice" @click="rate('good')">记得 · {{ item.intervals?.good ?? "—" }} 天</button>
      <button class="choice" @click="rate('easy')">非常熟悉 · {{ item.intervals?.easy ?? "—" }} 天</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";

const props = defineProps<{ item: any }>();
const emit = defineEmits<{ done: [] }>();
const show = ref(false);
const recognizeOnly = ref(false);

async function rate(rating: string) {
  await api(`/api/review/${props.item.id}/rate`, {
    method: "POST",
    body: JSON.stringify({ rating, recallAbility: recognizeOnly.value ? "recognize" : "recall" }),
  });
  emit("done");
}
</script>
