import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MLB_PROXY_TARGET points the dev server at a recorded-game proxy instead of
// the real Stats API, so a celebration can be reproduced on demand.
const mlbProxy = {
  "/api/mlb": {
    target: process.env.MLB_PROXY_TARGET ?? "https://statsapi.mlb.com",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/mlb/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  publicDir: "../../public",
  server: { proxy: mlbProxy },
  preview: { proxy: mlbProxy },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
