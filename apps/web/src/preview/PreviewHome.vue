<template>
  <section>
    <article class="pv-card pv-hero">
      <div>
        <div class="pv-kicker">
          <span class="pv-badge">{{ lesson.source }}</span>
          <span>今日学习 · 示例</span>
        </div>
        <h2 class="pv-en" translate="no">{{ lesson.title }}</h2>
        <p class="pv-meta">{{ lesson.theme }} · {{ lesson.level }} · 6 个新词 · 约 {{ lesson.minutes }} 分钟</p>
        <div class="pv-progress" role="progressbar" aria-valuemin="0" aria-valuemax="6" aria-valuenow="2" aria-label="课程进度">
          <span style="width: 33%"></span>
        </div>
        <p class="pv-muted">进度 2/6，当前在新词。到期复习 5 个。下一次：appointment 已逾期 43 分钟。</p>
      </div>
      <router-link class="pv-btn primary" to="/preview/words">继续学习</router-link>
    </article>

    <div class="pv-split">
      <article class="pv-card">
        <h3 class="pv-section-title">今日步骤</h3>
        <p class="pv-muted">同一节示例课，按这个顺序走。</p>
        <ol class="pv-steps">
          <li data-state="done"><span>1 复习</span><span>已完成</span></li>
          <li data-state="current"><span>2 新词</span><span>进行中</span></li>
          <li><span>3 词根</span><span>未开始</span></li>
          <li><span>4 听力</span><span>未开始</span></li>
          <li><span>5 跟读</span><span>未开始</span></li>
          <li><span>6 回忆</span><span>未开始</span></li>
        </ol>
      </article>
      <article class="pv-card">
        <h3 class="pv-section-title">到期复习</h3>
        <p class="pv-muted">5 个词到了正式复习时间。数字来自示例，不是当前数据库。</p>
        <ul class="pv-review-list">
          <li v-for="item in reviewSamples" :key="item.lemma">
            <span><b translate="no">{{ item.lemma }}</b> {{ item.meaning }}</span>
            <span>{{ item.due }}</span>
          </li>
        </ul>
        <div class="pv-row">
          <button class="pv-btn primary" type="button" @click="reviewNote = '立即复习会在正式版接入现有 FSRS。预览不改到期时间。'">立即复习</button>
          <button class="pv-btn" type="button" @click="reviewNote = '提前复习只做练习，不改变正式排程。这一步还没有写入记录。'">提前复习</button>
        </div>
        <p v-if="reviewNote" class="pv-toast" role="status">{{ reviewNote }}</p>
      </article>
    </div>

    <div class="pv-lower">
      <article class="pv-card">
        <h3 class="pv-section-title">最近七天</h3>
        <p class="pv-muted">柱高旁边有分钟数，不只靠颜色。</p>
        <div class="pv-bars">
          <div v-for="day in week" :key="day.label">
            <i :style="{ height: day.minutes + '%' }"></i>
            <span>{{ day.label }} {{ day.minutes }}</span>
          </div>
        </div>
      </article>
      <article class="pv-card">
        <h3 class="pv-section-title">词汇回忆</h3>
        <p>最近记住 4 个，需要再看 2 个。</p>
        <p class="pv-muted">appointment、grocery 仍在复习队列里。</p>
      </article>
      <article class="pv-card">
        <h3 class="pv-section-title">听力理解</h3>
        <p>上一篇短文第一次听懂了大意，没有逐字复述。</p>
        <router-link class="pv-btn" to="/preview/listening">打开今日听力</router-link>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { previewLesson, reviewSamples, week } from "./sample";

const lesson = previewLesson;
const reviewNote = ref("");
</script>
