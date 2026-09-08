import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { appleRelay } from "./vite-apple-relay.ts";

export default defineConfig({
  plugins: [react(), appleRelay()],
  publicDir: "../../public",
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
