import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

export default defineConfig(({ command }) => ({
  // basicSsl is local-dev only — never load it during `vite build` on Vercel.
  plugins: [react(), ...(command === "serve" ? [basicSsl()] : [])],
  server: {
    https: true,
    host: "127.0.0.1",
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3005",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
      },
    },
  },
  build: {
    target: "es2020",
  },
  esbuild: {
    target: "es2020",
    supported: { bigint: true },
  },
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
      "snarkjs",
      "circomlibjs",
    ],
    esbuildOptions: {
      target: "es2020",
      supported: { bigint: true },
    },
  },
}));
