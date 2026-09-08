import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// Relays /device/* from the Lab's own origin to the physical Apple's Manager.
// The browser never talks to the Apple directly, so no CORS or mixed-content
// rule applies and the Apple's firmware needs no changes. Which Apple is
// chosen per request from the X-Apple-Host header; the code rides through as
// X-Apple-Code, exactly as the Manager page sends it.

const HOST_PATTERN = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "content-length", "x-apple-code"] as const;
const RELAY_TIMEOUT_MS = 8000;

export function resolveAppleHost(header: string | string[] | undefined, fallback: string): string | null {
  const raw = (Array.isArray(header) ? header[0] : header) ?? "";
  const host = (raw.trim() || fallback)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
  return HOST_PATTERN.test(host) ? host : null;
}

function relay(defaultHost: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const host = resolveAppleHost(req.headers["x-apple-host"], defaultHost);
    if (host === null) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "BAD_HOST" }));
      return;
    }
    const [hostname, port] = host.split(":");
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const upstream = http.request(
      { hostname, port: port ? Number(port) : 80, path: req.url ?? "/", method: req.method, headers, timeout: RELAY_TIMEOUT_MS },
      (reply) => {
        res.statusCode = reply.statusCode ?? 502;
        for (const [name, value] of Object.entries(reply.headers)) {
          if (value !== undefined && name !== "connection") res.setHeader(name, value);
        }
        // A reply that breaks mid-body cannot be turned into a JSON error once
        // its headers are out; abort so the browser sees a failed fetch
        // instead of a truncated success.
        reply.on("error", () => res.destroy());
        reply.pipe(res);
      },
    );
    const fail = (detail: string) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "RELAY", detail, host }));
    };
    upstream.on("timeout", () => upstream.destroy(new Error("timed out")));
    upstream.on("error", (error) => fail(error.message));
    req.pipe(upstream);
  };
}

export function appleRelay(defaultHost = process.env.APPLE_HOST ?? "home-run-apple.local"): Plugin {
  return {
    name: "apple-relay",
    configureServer(server) {
      server.middlewares.use("/device", relay(defaultHost));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/device", relay(defaultHost));
    },
  };
}
