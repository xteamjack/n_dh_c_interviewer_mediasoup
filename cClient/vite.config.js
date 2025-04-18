import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "fs";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    https: {
      key: fs.readFileSync("../certs/key.pem"),
      cert: fs.readFileSync("../certs/cert.pem"),
    },
    port: 5173,
  },
});
