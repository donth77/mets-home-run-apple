import dns from "node:dns";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// Relays /device/* from the Lab's own origin to the physical Apple's Manager.
// The browser never talks to the Apple directly, so no CORS or mixed-content
// rule applies and the Apple's firmware needs no changes. Which Apple is
// chosen per request from the X-Apple-Host header; the code rides through as
// X-Apple-Code, exactly as the Manager page sends it.

const HOST_PATTERN = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "content-length",
  "x-apple-code",
  "x-apple-maintenance",
] as const;
const RELAY_TIMEOUT_MS = 8000;
const LOOKUP_TTL_MS = 60_000;

// Resolving home-run-apple.local goes through mDNS, and macOS waits out an
// IPv6 query that the Apple never answers before returning the IPv4 address —
// several seconds per request right after the Apple comes back on the network,
// which reads in the Lab as a connection stuck on "Connecting". Ask for IPv4
// only and remember the answer for a minute; a failed connection forgets it so
// an Apple that moved to a new address is found again.
const lookupCache = new Map<string, { address: string; at: number }>();
const cachedLookup: typeof dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const done = (typeof options === "function" ? options : callback) as (
    error: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void;
  const hit = lookupCache.get(hostname);
  if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) {
    done(null, hit.address, 4);
    return;
  }
  dns.lookup(hostname, { family: 4 }, (error, address) => {
    if (!error && address) lookupCache.set(hostname, { address, at: Date.now() });
    done(error, address, 4);
  });
}) as typeof dns.lookup;

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
      {
        hostname,
        port: port ? Number(port) : 80,
        path: req.url ?? "/",
        method: req.method,
        headers,
        timeout: RELAY_TIMEOUT_MS,
        family: 4,
        lookup: cachedLookup,
      },
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
    upstream.on("error", (error) => {
      lookupCache.delete(hostname);
      fail(error.message);
    });
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
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
