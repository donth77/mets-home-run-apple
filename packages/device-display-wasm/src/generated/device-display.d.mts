interface DeviceDisplayEmscriptenModule {
  HEAPU16: Uint16Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  stringToUTF8(value: string, pointer: number, maximumBytes: number): void;
  lengthBytesUTF8(value: string): number;
  _apple_display_create(): number;
  _apple_display_destroy(handle: number): void;
  _apple_display_begin_home_run(handle: number, grandSlam: number, batterPointer: number, seed: number): number;
  _apple_display_begin_mets_win(handle: number, awayPointer: number, awayRuns: number, homePointer: number, homeRuns: number, metsHome: number, seed: number): number;
  _apple_display_render(handle: number, elapsedMs: number): number;
  _apple_display_render_key(handle: number, elapsedMs: number): number;
  _apple_display_loop_ms(handle: number): number;
  _apple_display_framebuffer(handle: number): number;
}

export default function createDeviceDisplayModule(): Promise<DeviceDisplayEmscriptenModule>;
