import { describe, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { appleRelay, resolveAppleHost } from "./vite-apple-relay";

describe("resolveAppleHost", () => {
  it("falls back to the default Apple", () => {
    expect(resolveAppleHost(undefined, "home-run-apple.local")).toBe("home-run-apple.local");
    expect(resolveAppleHost("   ", "home-run-apple.local")).toBe("home-run-apple.local");
  });

  it("accepts hostnames, addresses and ports, and strips scheme or path", () => {
    expect(resolveAppleHost("192.168.1.139", "x")).toBe("192.168.1.139");
    expect(resolveAppleHost("http://home-run-apple.local/", "x")).toBe("home-run-apple.local");
    expect(resolveAppleHost("apple.local:8080/api", "x")).toBe("apple.local:8080");
    expect(resolveAppleHost(["first.local", "second.local"], "x")).toBe("first.local");
  });

  it("refuses anything that is not a host", () => {
    expect(resolveAppleHost("apple.local; rm -rf /", "x")).toBeNull();
    expect(resolveAppleHost("user@apple.local", "x")).toBeNull();
    expect(resolveAppleHost("[::1]", "x")).toBeNull();
  });
});

it("forwards authenticated fixture requests through the actual local relay", async () => {
  let received: { headers: IncomingHttpHeaders; method?: string; url?: string } | undefined;
  const device = createServer((req, res) => {
    received = { headers: req.headers, method: req.method, url: req.url };
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  let handler!: RequestListener;
  const setup = appleRelay().configureServer;
  if (typeof setup !== "function") throw new Error("Relay setup unavailable");
  setup({
    middlewares: {
      use: (_path: string, callback: RequestListener) => {
        handler = callback;
      },
    },
  } as unknown as ViteDevServer);
  const relay = createServer((req, res) => handler(req, res));
  const listen = (server: Server) =>
    new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    });
  const close = (server: Server) =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  try {
    const port = await listen(device);
    const relayPort = await listen(relay);
    const response = await fetch(`http://127.0.0.1:${relayPort}/api/fixture?scenario=review-overturned`, {
      method: "POST",
      headers: {
        "X-Apple-Host": `127.0.0.1:${port}`,
        "X-Apple-Code": "fixture-code",
        "X-Apple-Maintenance": "fixture-session",
      },
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(received?.method).toBe("POST");
    expect(received?.url).toBe("/api/fixture?scenario=review-overturned");
    expect(received?.headers["x-apple-code"]).toBe("fixture-code");
    expect(received?.headers["x-apple-maintenance"]).toBe("fixture-session");
  } finally {
    await close(relay);
    await close(device);
  }
});
