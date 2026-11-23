import { createRouter, createWebHistory } from "vue-router";
import Dashboard from "./views/Dashboard.vue";
import Lesson from "./views/Lesson.vue";
import Library from "./views/Library.vue";
import Listening from "./views/Listening.vue";
import Review from "./views/Review.vue";
import Stats from "./views/Stats.vue";
import Settings from "./views/Settings.vue";
import History from "./views/History.vue";
import ContextStudy from "./views/ContextStudy.vue";
import PreviewShell from "./preview/PreviewShell.vue";
import PreviewHome from "./preview/PreviewHome.vue";
import PreviewWords from "./preview/PreviewWords.vue";
import PreviewListening from "./preview/PreviewListening.vue";
import PreviewContext from "./preview/PreviewContext.vue";
import PreviewWordsCard from "./preview/PreviewWordsCard.vue";
import PreviewListeningCard from "./preview/PreviewListeningCard.vue";
import AuthLab from "./views/AuthLab.vue";
import Login from "./views/Login.vue";
import { authClient } from "./lib/authClient";
import { multiUserRuntime } from "./lib/runtimeMode";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Dashboard },
    { path: "/lesson/:id?", component: Lesson },
    { path: "/context", component: ContextStudy },
    { path: "/library", component: Library },
    { path: "/listening", component: Listening },
    { path: "/review", component: Review },
    { path: "/stats", component: Stats },
    { path: "/settings", component: Settings },
    { path: "/auth-lab", component: AuthLab },
    { path: "/login", component: Login },
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

router.beforeEach(async (to) => {
  if (!(await multiUserRuntime())) return true;
  if (to.path.startsWith("/preview") || to.path === "/auth-lab") return true;
  const session = await authClient.getSession();
  const signedIn = Boolean(session.data?.user);
  if (to.path === "/login") return signedIn ? "/" : true;
  if (!signedIn) return "/login";
  return true;
});
