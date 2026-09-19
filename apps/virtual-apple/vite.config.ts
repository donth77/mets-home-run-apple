import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// MLB_PROXY_TARGET points the dev server at a recorded-game proxy instead of
// the real Stats API, so a celebration can be reproduced on demand.
const mlbProxy: Record<string, ProxyOptions> = {
  "/api/mlb": {
    target: process.env.MLB_PROXY_TARGET ?? "https://statsapi.mlb.com",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/mlb/, ""),
  },
};

// The notification API is a Pages Function, so `vite` alone has none. Set
// NOTIFICATIONS_PROXY_TARGET (normally https://www.metsapple.com) to borrow
// the deployed one: the bell and the alerts card then work for real from
// localhost, and this browser receives real pushes until it turns them off.
// The API only answers its own origin, so the proxy presents itself as it.
const notificationsTarget = process.env.NOTIFICATIONS_PROXY_TARGET;
if (notificationsTarget) {
  mlbProxy["/api/notifications"] = {
    target: notificationsTarget,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", notificationsTarget));
    },
  };
}

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
