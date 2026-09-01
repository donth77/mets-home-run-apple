import createDeviceDisplayModule from "./generated/device-display.mjs";

export const DEVICE_DISPLAY_WIDTH = 320;
export const DEVICE_DISPLAY_HEIGHT = 240;
const PIXEL_COUNT = DEVICE_DISPLAY_WIDTH * DEVICE_DISPLAY_HEIGHT;

type Module = Awaited<ReturnType<typeof createDeviceDisplayModule>>;

export class DeviceCelebrationRenderer {
  static async create(): Promise<DeviceCelebrationRenderer> {
    const module = await createDeviceDisplayModule();
    return new DeviceCelebrationRenderer(module);
  }

  readonly #module: Module;
  #handle: number;

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
