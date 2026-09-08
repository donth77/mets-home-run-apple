import { describe, expect, it } from "vitest";
import { resolveAppleHost } from "./vite-apple-relay";

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
