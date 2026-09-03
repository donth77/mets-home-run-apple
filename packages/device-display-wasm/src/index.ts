import type { DeviceDisplayKind, DeviceDisplayState } from "@apple/protocol";
import createDeviceDisplayModule from "./generated/device-display.mjs";

export const DEVICE_DISPLAY_WIDTH = 320;
export const DEVICE_DISPLAY_HEIGHT = 240;
const PIXEL_COUNT = DEVICE_DISPLAY_WIDTH * DEVICE_DISPLAY_HEIGHT;

type Module = Awaited<ReturnType<typeof createDeviceDisplayModule>>;

const screenStateCode: Readonly<Record<DeviceDisplayKind, number>> = {
  LIVE: 1,
  UPCOMING: 2,
  OFFSEASON: 3,
  DELAY: 4,
  RAIN_DELAY: 5,
  REVIEW: 6,
  SUSPENDED: 7,
  POSTPONED: 8,
  CANCELLED: 9,
  FINAL: 10,
};

const halfCode = { TOP: 0, BOTTOM: 1, MIDDLE: 2, END: 3 } as const;
const finalResultCode = { METS_WIN: 1, METS_LOSS: 2, TIE: 3 } as const;

export interface DeviceScreenRenderOptions {
  /** Firmware defaults to Eastern Time until the owner selects another zone. */
  timeZone?: string;
  /** Injectable so the dynamic offseason footer stays deterministic in tests. */
  now?: Date;
}

export function deviceOffseasonSeasonLabel(date: Date) {
  const seasonYear = date.getFullYear() + (date.getMonth() >= 2 ? 1 : 0);
  return `${seasonYear} SEASON`;
}

export function deviceUpcomingTime(scheduledStart: string | undefined, timeZone = "America/New_York") {
  if (!scheduledStart) return { date: "DATE TBD", time: "TIME TBD", timezone: "" };
  const startsAt = new Date(scheduledStart);
  if (Number.isNaN(startsAt.getTime())) return { date: "DATE TBD", time: "TIME TBD", timezone: "" };

  const dateParts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).formatToParts(startsAt);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((candidate) => candidate.type === type)?.value ?? "";
  const date = `${part("weekday")} ${part("month")} ${part("day")}`.toUpperCase();
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })
    .format(startsAt)
    .toUpperCase();
  const timezoneParts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone }).formatToParts(startsAt);
  const timezone = timezoneParts.find((candidate) => candidate.type === "timeZoneName")?.value.toUpperCase() ?? "";
  return { date, time, timezone };
}

export class DeviceDisplayRenderer {
  static async create(): Promise<DeviceDisplayRenderer> {
    const module = await createDeviceDisplayModule();
    return new DeviceDisplayRenderer(module);
  }

  readonly #module: Module;
  #handle: number;
  #screenSignature: string | undefined;

  private constructor(module: Module) {
    this.#module = module;
    this.#handle = module._apple_display_create();
    if (this.#handle === 0) throw new Error("Unable to allocate the physical-display renderer");
  }

  dispose(): void {
    if (this.#handle === 0) return;
    this.#module._apple_display_destroy(this.#handle);
    this.#handle = 0;
  }

  beginHomeRun(batter: string, options: { grandSlam?: boolean; seed?: number } = {}): void {
    this.#assertAlive();
    this.#withStrings([batter], ([batterPointer]) => {
      const accepted = this.#module._apple_display_begin_home_run(
        this.#handle,
        options.grandSlam ? 1 : 0,
        batterPointer,
        options.seed ?? 1,
      );
      if (accepted !== 1) throw new Error("Physical-display renderer rejected the home run");
    });
  }

  beginMetsWin(
    final: { away: string; awayRuns: number; home: string; homeRuns: number; metsHome: boolean },
    seed = 1,
  ): void {
    this.#assertAlive();
    this.#withStrings([final.away, final.home], ([awayPointer, homePointer]) => {
      const accepted = this.#module._apple_display_begin_mets_win(
        this.#handle,
        awayPointer,
        final.awayRuns,
        homePointer,
        final.homeRuns,
        final.metsHome ? 1 : 0,
        seed,
      );
      if (accepted !== 1) throw new Error("Physical-display renderer rejected the Mets win");
    });
  }

  renderRgb565(elapsedMs: number): Uint16Array {
    this.#assertAlive();
    const pointer = this.#module._apple_display_render(this.#handle, Math.max(0, Math.floor(elapsedMs)));
    if (pointer === 0) throw new Error("Physical-display renderer did not return a framebuffer");
    const first = pointer >>> 1;
    return this.#module.HEAPU16.slice(first, first + PIXEL_COUNT);
  }

  renderKey(elapsedMs: number): number {
    this.#assertAlive();
    return this.#module._apple_display_render_key(this.#handle, Math.max(0, Math.floor(elapsedMs)));
  }

  loopMs(): number {
    this.#assertAlive();
    return this.#module._apple_display_loop_ms(this.#handle);
  }

  renderScreenRgb565(state: DeviceDisplayState, elapsedMs = 0, options: DeviceScreenRenderOptions = {}): Uint16Array {
    this.#assertAlive();
    const local = deviceUpcomingTime(state.scheduledStart, options.timeZone);
    const season = deviceOffseasonSeasonLabel(options.now ?? new Date());
    const values = [
      state.away.abbreviation,
      state.home.abbreviation,
      state.batter ?? "-",
      state.batterLine ?? "-",
      state.pitcher ?? "-",
      state.lastEvent,
      state.venue ?? "",
      local.date,
      local.time,
      local.timezone,
      season,
    ] as const;
    const signature = JSON.stringify([
      screenStateCode[state.kind],
      state.gameNumber,
      state.away.runs,
      state.home.runs,
      state.finalResult,
      state.inning,
      state.half,
      state.outs,
      state.bases,
      state.balls,
      state.strikes,
      state.pitchCount,
      ...values,
    ]);

    if (signature !== this.#screenSignature) {
      this.#withStrings(values, (pointers) => {
        const [
          awayPointer,
          homePointer,
          batterPointer,
          batterLinePointer,
          pitcherPointer,
          eventPointer,
          venuePointer,
          datePointer,
          timePointer,
          timezonePointer,
          seasonPointer,
        ] = pointers;
        const occupiedBases =
          (state.bases.first ? 0x01 : 0) | (state.bases.second ? 0x02 : 0) | (state.bases.third ? 0x04 : 0);
        const accepted = this.#module._apple_display_set_screen(
          this.#handle,
          screenStateCode[state.kind],
          state.gameNumber,
          awayPointer,
          state.away.runs,
          homePointer,
          state.home.runs,
          state.finalResult ? finalResultCode[state.finalResult] : 0,
          state.inning,
          halfCode[state.half],
          state.outs,
          occupiedBases,
          state.balls ?? 0,
          state.strikes ?? 0,
          batterPointer,
          batterLinePointer,
          pitcherPointer,
          state.pitchCount ?? 0,
          eventPointer,
          venuePointer,
          datePointer,
          timePointer,
          timezonePointer,
          seasonPointer,
        );
        if (accepted !== 1) throw new Error(`Physical-display renderer rejected ${state.kind}`);
      });
      this.#screenSignature = signature;
    }

    const rainFrame = state.kind === "RAIN_DELAY" ? Math.floor(Math.max(0, elapsedMs) / 150) % 6 : 0;
    const pointer = this.#module._apple_display_render_screen(this.#handle, rainFrame);
    if (pointer === 0) throw new Error("Physical-display renderer did not return a screen framebuffer");
    const first = pointer >>> 1;
    return this.#module.HEAPU16.slice(first, first + PIXEL_COUNT);
  }

  #assertAlive(): void {
    if (this.#handle === 0) throw new Error("Physical-display renderer has been disposed");
  }

  #withStrings<T>(values: readonly string[], callback: (pointers: readonly number[]) => T): T {
    const pointers = values.map((value) => {
      const bytes = this.#module.lengthBytesUTF8(value) + 1;
      const pointer = this.#module._malloc(bytes);
      if (pointer === 0) throw new Error("Unable to allocate a physical-display string");
      this.#module.stringToUTF8(value, pointer, bytes);
      return pointer;
    });
    try {
      return callback(pointers);
    } finally {
      for (const pointer of pointers) this.#module._free(pointer);
    }
  }
}

/** @deprecated The renderer now covers every firmware screen, not only celebrations. */
export const DeviceCelebrationRenderer = DeviceDisplayRenderer;
/** @deprecated Use DeviceDisplayRenderer. */
export type DeviceCelebrationRenderer = DeviceDisplayRenderer;

export function rgb565ToRgba(frame: Uint16Array, target?: Uint8ClampedArray): Uint8ClampedArray {
  if (frame.length !== PIXEL_COUNT) {
    throw new Error(`Expected ${PIXEL_COUNT} RGB565 pixels, received ${frame.length}`);
  }
  const rgba = target ?? new Uint8ClampedArray(PIXEL_COUNT * 4);
  if (rgba.length !== PIXEL_COUNT * 4) {
    throw new Error(`Expected ${PIXEL_COUNT * 4} RGBA bytes, received ${rgba.length}`);
  }
  for (let index = 0; index < frame.length; index += 1) {
    const color = frame[index];
    const output = index * 4;
    const red = (color >>> 11) & 0x1f;
    const green = (color >>> 5) & 0x3f;
    const blue = color & 0x1f;
    rgba[output] = (red << 3) | (red >>> 2);
    rgba[output + 1] = (green << 2) | (green >>> 4);
    rgba[output + 2] = (blue << 3) | (blue >>> 2);
    rgba[output + 3] = 255;
  }
  return rgba;
}
