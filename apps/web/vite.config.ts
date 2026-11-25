import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    target: ["chrome107", "edge107", "firefox104", "safari15.6", "ios15.6"],
    cssTarget: ["chrome107", "edge107", "firefox104", "safari15.6", "ios15.6"],
  },
  define: {
    __LAB_PROTECTED_RUNTIME__: JSON.stringify(process.env.VERCEL === "1" || process.env.VITE_PROTECTED_RUNTIME === "1"),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": process.env.LAB_API_PROXY || "http://127.0.0.1:8787" },
  },
});
