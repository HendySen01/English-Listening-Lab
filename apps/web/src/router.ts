import { createRouter, createWebHistory } from "vue-router";
import Dashboard from "./views/Dashboard.vue";
import Lesson from "./views/Lesson.vue";
import Library from "./views/Library.vue";
import Listening from "./views/Listening.vue";
import Review from "./views/Review.vue";
import Stats from "./views/Stats.vue";
import Settings from "./views/Settings.vue";
import History from "./views/History.vue";
import PreviewShell from "./preview/PreviewShell.vue";
import PreviewHome from "./preview/PreviewHome.vue";
import PreviewWords from "./preview/PreviewWords.vue";
import PreviewListening from "./preview/PreviewListening.vue";
import PreviewContext from "./preview/PreviewContext.vue";
import PreviewWordsCard from "./preview/PreviewWordsCard.vue";
import PreviewListeningCard from "./preview/PreviewListeningCard.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Dashboard },
    { path: "/lesson/:id?", component: Lesson },
    { path: "/library", component: Library },
    { path: "/listening", component: Listening },
    { path: "/review", component: Review },
    { path: "/stats", component: Stats },
    { path: "/settings", component: Settings },
    { path: "/history", component: History },
    {
      path: "/preview",
      component: PreviewShell,
      children: [
        { path: "", redirect: "/preview/home" },
        { path: "home", component: PreviewHome },
        { path: "context", component: PreviewContext },
        { path: "words", component: PreviewWords },
        { path: "listening", component: PreviewListening },
        { path: "words-card", component: PreviewWordsCard },
        { path: "listening-card", component: PreviewListeningCard },
      ],
    },
  ],
});
