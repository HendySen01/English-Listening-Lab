import { createRouter, createWebHistory } from "vue-router";
import Dashboard from "./views/Dashboard.vue";
import Lesson from "./views/Lesson.vue";
import Library from "./views/Library.vue";
import Listening from "./views/Listening.vue";
import Review from "./views/Review.vue";
import Stats from "./views/Stats.vue";
import Settings from "./views/Settings.vue";
import History from "./views/History.vue";

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
  ],
});
