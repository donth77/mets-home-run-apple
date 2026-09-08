import type { DeviceDisplayKind, DeviceDisplayState, GamePhase } from "@apple/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEVICE_DISPLAY_HEIGHT,
  DEVICE_DISPLAY_WIDTH,
  DeviceDisplayRenderer,
  deviceUpcomingTime,
  rgb565ToRgba,
} from "./index";

const activeRenderers: DeviceDisplayRenderer[] = [];

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
  const instance = await DeviceDisplayRenderer.create();
  activeRenderers.push(instance);
  return instance;
}

function screen(
  kind: DeviceDisplayKind,
  phase: GamePhase,
  overrides: Partial<DeviceDisplayState> = {},
): DeviceDisplayState {
  return {
    schemaVersion: 1,
    kind,
    gamePk: 777686,
    gameNumber: 1,
    phase,
    status: kind.replaceAll("_", " "),
    lastEvent: "Francisco Lindor lines a single to center field",
    venue: "Citi Field",
    away: { abbreviation: "ATL", runs: 12 },
    home: { abbreviation: "NYM", runs: 10 },
    inning: 10,
    half: "BOTTOM",
    outs: 2,
    bases: { first: true, second: true, third: true },
    balls: 3,
    strikes: 2,
    batter: "M. Rodriguez",
    batterLine: "0 FOR 1",
    pitcher: "S. Strider",
    pitchCount: 104,
    ...overrides,
  };
}

function framebufferHash(frame: Uint16Array) {
  let hash = 0x811c9dc5;
  for (const pixel of frame) {
    hash ^= pixel >>> 8;
    hash = Math.imul(hash, 0x01000193);
    hash ^= pixel & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
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

  it("keeps the exclamation point in the Mets-win closing call", async () => {
    const instance = await renderer();
    instance.beginMetsWin({ away: "NYM", awayRuns: 6, home: "ATL", homeRuns: 3, metsHome: false }, 5);
    const card = instance.renderRgb565(11_000);

    // The public fallback font paints the trailing ! through this doubled
    // logical pixel. It used to be trimmed when one-pixel tracking made the
    // full line one pixel wider than the safe area.
    expect(card[208 * DEVICE_DISPLAY_WIDTH + 292]).toBe(0xfeab);
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

describe("physical display screen WASM", () => {
  it("formats the same compact Eastern date, time, and zone used by firmware", () => {
    expect(deviceUpcomingTime("2026-08-26T23:10:00Z")).toEqual({
      date: "WED AUG 26",
      time: "7:10 PM",
      timezone: "EDT",
    });
    expect(deviceUpcomingTime(undefined)).toEqual({ date: "DATE TBD", time: "TIME TBD", timezone: "" });
  });

  it("renders deterministic live, doubleheader, and final cards through ScreenPainter", async () => {
    const instance = await renderer();
    const live = screen("LIVE", "LIVE");
    const gameTwo = screen("UPCOMING", "PREGAME", {
      gameNumber: 2,
      scheduledStart: "2026-08-26T23:10:00Z",
      away: { abbreviation: "SF", runs: 0 },
      home: { abbreviation: "NYM", runs: 0 },
    });
    const final = screen("FINAL", "FINAL", {
      away: { abbreviation: "ATL", runs: 3 },
      home: { abbreviation: "NYM", runs: 5 },
      finalResult: "METS_WIN",
      half: "END",
      outs: 3,
    });

    expect.soft(framebufferHash(instance.renderScreenRgb565(live)), "live").toBe(0x4b50f913);
    expect.soft(framebufferHash(instance.renderScreenRgb565(gameTwo)), "upcoming").toBe(0x32ff1805);
    expect.soft(framebufferHash(instance.renderScreenRgb565(final)), "final").toBe(0xb64c8b68);
  });

  it("centers the final score and omits a Mets-loss caption", async () => {
    const instance = await renderer();
    const win = instance.renderScreenRgb565(
      screen("FINAL", "FINAL", {
        away: { abbreviation: "NYM", runs: 5 },
        home: { abbreviation: "ATL", runs: 3 },
        finalResult: "METS_WIN",
        half: "END",
        outs: 3,
      }),
    );
    const loss = instance.renderScreenRgb565(
      screen("FINAL", "FINAL", {
        away: { abbreviation: "NYM", runs: 2 },
        home: { abbreviation: "ATL", runs: 4 },
        finalResult: "METS_LOSS",
        half: "END",
        outs: 3,
      }),
    );

    expect(win.slice(190 * DEVICE_DISPLAY_WIDTH, 206 * DEVICE_DISPLAY_WIDTH)).toContain(0xfac2);
    expect(new Set(loss.slice(184 * DEVICE_DISPLAY_WIDTH, 216 * DEVICE_DISPLAY_WIDTH))).toEqual(new Set([0x0043]));
  });

  it("covers every interruption layout and animates rain", async () => {
    const instance = await renderer();
    const cases: readonly [DeviceDisplayKind, GamePhase, number][] = [
      ["DELAY", "DELAYED", 0x7dc8017d],
      ["RAIN_DELAY", "DELAYED", 0x411d57dd],
      ["REVIEW", "REVIEW", 0x447ff685],
      ["SUSPENDED", "DELAYED", 0x72324871],
      ["POSTPONED", "DELAYED", 0xfcd14045],
      ["CANCELLED", "DELAYED", 0xa8a8a0f6],
    ];

    for (const [kind, phase, expected] of cases) {
      expect
        .soft(framebufferHash(instance.renderScreenRgb565(screen(kind, phase), kind === "RAIN_DELAY" ? 450 : 0)), kind)
        .toBe(expected);
    }
    expect(framebufferHash(instance.renderScreenRgb565(screen("RAIN_DELAY", "DELAYED"), 600))).toBe(0x34fe549d);
  });

  it("uses the approved interruption-screen palette after RGB565 conversion", async () => {
    const instance = await renderer();
    const delay = rgb565ToRgba(instance.renderScreenRgb565(screen("DELAY", "DELAYED")));
    const postponed = rgb565ToRgba(instance.renderScreenRgb565(screen("POSTPONED", "DELAYED")));
    const pixel = (rgba: Uint8ClampedArray, x: number, y: number) =>
      [...rgba.slice((y * DEVICE_DISPLAY_WIDTH + x) * 4, (y * DEVICE_DISPLAY_WIDTH + x) * 4 + 4)];

    // RGB565 is the nearest display-safe representation of the 24-bit Aseprite palette.
    expect(pixel(delay, 0, 100)).toEqual([0, 8, 24, 255]); // #00081F deep navy
    expect(pixel(delay, 20, 100)).toEqual([8, 28, 57, 255]); // #0B1C3D panel blue
    expect(pixel(delay, 20, 20)).toEqual([0, 44, 115, 255]); // #002D72 Mets blue
    expect(pixel(postponed, 0, 40)).toEqual([214, 69, 66, 255]); // #D64545 interruption red
  });

  it("centers the visible question-mark pixels inside the review diamond", async () => {
    const instance = await renderer();
    const review = instance.renderScreenRgb565(screen("REVIEW", "REVIEW"));
    const points: { x: number; y: number }[] = [];
    for (let y = 92; y <= 114; y += 1) {
      for (let x = 152; x <= 168; x += 1) {
        if (review[y * DEVICE_DISPLAY_WIDTH + x] === 0xf628) points.push({ x, y });
      }
    }
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([153, 167]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([93, 113]);
  });

  it("renders the approved offseason art exactly after RGB565 conversion", async () => {
    const instance = await renderer();
    const frame = instance.renderScreenRgb565(screen("OFFSEASON", "SLEEP"), 0, {
      now: new Date(2026, 8, 2),
    });
    expect(framebufferHash(frame)).toBe(0x1857fcf8);
  });
});

describe("physical display card WASM", () => {
  it("paints the Apple's card screens from status.screen and tells them apart", async () => {
    const instance = await renderer();
    const prompt = instance.renderCardRgb565({
      kind: "WAITING",
      title: "APPLE LAB TEST",
      status: "TAP BUTTON TO APPROVE",
      note: "APPLE WILL MOVE|CANCELS IN 27 S",
      accent: 0xfac2,
      statusColor: 0xffff,
      icon: "ALERT",
    });
    expect(prompt).toHaveLength(320 * 240);
    // The orange accent rule is painted; white status text is present.
    expect(prompt.includes(0xfac2)).toBe(true);
    expect(prompt.includes(0xffff)).toBe(true);
    const approved = instance.renderCardRgb565({
      kind: "WAITING",
      title: "APPLE LAB TEST",
      status: "APPROVED",
      note: "STARTING - STAND CLEAR",
      accent: 0xfac2,
      statusColor: 0xffff,
      icon: "ALERT",
    });
    expect(framebufferHash(approved)).not.toBe(framebufferHash(prompt));
    // A card and a game screen never collide in the renderer's signature cache.
    const live = instance.renderScreenRgb565(screen("LIVE", "LIVE"));
    expect(framebufferHash(live)).not.toBe(framebufferHash(approved));
    expect(framebufferHash(instance.renderCardRgb565({ kind: "INFO", title: "OPEN IN BROWSER", status: "home-run-apple.local", note: "OR 192.168.1.139|PASSWORD 00000000", accent: 0xfac2, statusColor: 0xfac2, icon: "NONE" }))).not.toBe(framebufferHash(approved));
  });
});
