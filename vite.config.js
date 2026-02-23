import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      util: path.resolve(__dirname, "src/polyfills/util.js"),
      crypto: "crypto-browserify",
      stream: "stream-browserify",
      buffer: "buffer/",
      process: "process/browser",
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: [
      "@circle-fin/w3s-pw-web-sdk",
      "crypto-browserify",
      "stream-browserify",
      "buffer",
      "process",
    ],
  },
});
