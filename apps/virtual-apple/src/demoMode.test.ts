import { describe, expect, it } from "vitest";
import { demoControlsEnabled } from "./demoMode";

describe("demoControlsEnabled", () => {
  it("requires an explicit flag during local development", () => {
    expect(demoControlsEnabled("", true, "localhost")).toBe(false);
  });

  it("supports demo and debug query flags", () => {
    expect(demoControlsEnabled("?demo=1", true, "localhost")).toBe(true);
    expect(demoControlsEnabled("?debug=true", true, "127.0.0.1")).toBe(true);
    expect(demoControlsEnabled("?demo", true, "::1")).toBe(true);
  });

  it("allows local demo controls to be disabled explicitly", () => {
    expect(demoControlsEnabled("?demo=0", true, "localhost")).toBe(false);
    expect(demoControlsEnabled("?debug=off", true, "localhost")).toBe(false);
  });

  it("never exposes demo controls in production or on a non-loopback host", () => {
    expect(demoControlsEnabled("?demo=1", false, "localhost")).toBe(false);
    expect(demoControlsEnabled("?debug=true", true, "virtual-apple.example.com")).toBe(false);
  });
});
