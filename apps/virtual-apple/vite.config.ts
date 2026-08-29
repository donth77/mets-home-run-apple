import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const mlbProxy = {
  "/api/mlb": {
    target: "https://statsapi.mlb.com",
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
