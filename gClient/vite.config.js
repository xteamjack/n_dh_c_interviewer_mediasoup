import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 8080,
  },
  optimizeDeps: {
    exclude: ["mediasoup-client"],
  },
});
