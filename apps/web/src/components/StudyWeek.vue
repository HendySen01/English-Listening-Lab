<template>
  <article class="card">
    <h3>本周学习</h3>
    <p v-if="days.length" class="muted">{{ days[0].date }} 至 {{ days[days.length - 1].date }} · 累计 {{ total }} 分钟</p>
    <ol class="study-week">
      <li v-for="(day, index) in days" :key="day.date" :class="{ 'is-today': day.date === today }" :aria-current="day.date === today ? 'date' : undefined">
        <div class="bar-area" aria-hidden="true"><i :style="{ height: `${(day.minutes ?? 0) / maximum * 100}%` }"></i></div>
        <strong>{{ day.minutes ?? "—" }}</strong>
        <span>周{{ "一二三四五六日"[index] }}</span>
        <time :datetime="day.date">{{ day.date.slice(5).replace("-", "/") }}</time>
      </li>
    </ol>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ days: Array<{ date: string; minutes: number | null }>; today: string }>();
const total = computed(() => props.days.reduce((sum, day) => sum + (day.minutes ?? 0), 0));
const maximum = computed(() => Math.max(1, ...props.days.map((day) => day.minutes ?? 0)));
</script>

<style scoped>
.study-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: clamp(3px, 1.4vw, 12px); list-style: none; margin: 12px 0 0; padding: 0; }
.study-week li { display: grid; grid-template-rows: 72px auto auto auto; justify-items: center; min-width: 0; font-size: 12px; line-height: 1.45; }
.bar-area { width: 100%; display: flex; align-items: flex-end; border-bottom: 1px solid var(--line); }
.bar-area i { width: 100%; border-radius: 6px 6px 0 0; background: #b7c4ad; }
.study-week strong { margin-top: 2px; font-variant-numeric: tabular-nums; }
.study-week span, .study-week time { color: var(--muted); }
.study-week .is-today i { background: #285638; }
.study-week .is-today strong { color: #285638; }
:global(html.dark) .bar-area i { background: #6d806c; }
:global(html.dark) .study-week .is-today i { background: #417854; }
:global(html.dark) .study-week .is-today strong { color: #a7c5a7; }
</style>
