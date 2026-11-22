import { createPinia } from "pinia";
import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import App from "./App.vue";
import { router } from "./router";
import { applyTheme } from "./stores/app";
import "./styles.css";

applyTheme(localStorage.getItem("ell-color-mode") || "system");

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  window.speechSynthesis.getVoices();
}

createApp(App).use(createPinia()).use(router).use(ElementPlus, { locale: zhCn }).mount("#app");
