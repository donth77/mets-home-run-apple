import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEVICE_DISPLAY_HEIGHT, DEVICE_DISPLAY_WIDTH, DeviceCelebrationRenderer, rgb565ToRgba } from "./index";

const activeRenderers: DeviceCelebrationRenderer[] = [];

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
});

afterEach(() => {
  for (const renderer of activeRenderers.splice(0)) renderer.dispose();
});

async function renderer() {
  const instance = await DeviceCelebrationRenderer.create();
  activeRenderers.push(instance);
  return instance;
}

describe("physical display celebration WASM", () => {
  it("renders a complete 320 by 240 home-run frame", async () => {
    const instance = await renderer();
    instance.beginHomeRun("Juan Soto", { seed: 7 });
    const frame = instance.renderRgb565(400);
    expect(frame).toHaveLength(DEVICE_DISPLAY_WIDTH * DEVICE_DISPLAY_HEIGHT);
    expect(new Set(frame).size).toBeGreaterThan(2);
    expect(instance.loopMs()).toBeGreaterThan(10_000);
  });

  it("renders the separate Mets-win loop", async () => {
    const instance = await renderer();
    instance.beginMetsWin({ away: "NYM", awayRuns: 6, home: "ATL", homeRuns: 3, metsHome: false }, 5);
    const logo = instance.renderRgb565(2_000);
    const card = instance.renderRgb565(11_000);
    expect(logo).toHaveLength(DEVICE_DISPLAY_WIDTH * DEVICE_DISPLAY_HEIGHT);
    expect(card).toHaveLength(DEVICE_DISPLAY_WIDTH * DEVICE_DISPLAY_HEIGHT);
    expect(logo).not.toEqual(card);
    expect(instance.loopMs()).toBeGreaterThan(13_000);
  });

  it("expands RGB565 without changing pixel count", () => {
    const frame = new Uint16Array(DEVICE_DISPLAY_WIDTH * DEVICE_DISPLAY_HEIGHT);
    frame[0] = 0xf800;
    frame[1] = 0x07e0;
    frame[2] = 0x001f;
    const rgba = rgb565ToRgba(frame);
    expect([...rgba.slice(0, 12)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });
});
