import { describe, expect, it } from "vitest";
import { isLoopbackHostname, localDebugEnabled } from "./index";

describe("localDebugEnabled", () => {
  it("requires an explicit demo or debug query parameter", () => {
    expect(localDebugEnabled("", true, "localhost")).toBe(false);
    expect(localDebugEnabled("?demo=1", true, "localhost")).toBe(true);
    expect(localDebugEnabled("?debug=true", true, "127.0.0.1")).toBe(true);
    expect(localDebugEnabled("?demo", true, "::1")).toBe(true);
  });

  it("rejects disabled flags, production builds, and non-loopback hosts", () => {
    expect(localDebugEnabled("?demo=0", true, "localhost")).toBe(false);
    expect(localDebugEnabled("?debug=off", true, "localhost")).toBe(false);
    expect(localDebugEnabled("?debug=1", false, "localhost")).toBe(false);
    expect(localDebugEnabled("?debug=1", true, "apple.example.com")).toBe(false);
    expect(localDebugEnabled("?debug=1", true, "192.168.1.20")).toBe(false);
  });
});

describe("isLoopbackHostname", () => {
  it("accepts only browser loopback names", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("apple.localhost")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
  });
});
