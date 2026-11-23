import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  define: {
    __LAB_PROTECTED_RUNTIME__: JSON.stringify(process.env.VERCEL === "1" || process.env.VITE_PROTECTED_RUNTIME === "1"),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
