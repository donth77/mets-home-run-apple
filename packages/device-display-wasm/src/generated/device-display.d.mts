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
  _apple_display_set_screen(
    handle: number,
    screenState: number,
    gameNumber: number,
    awayPointer: number,
    awayRuns: number,
    homePointer: number,
    homeRuns: number,
    finalResult: number,
    inning: number,
    half: number,
    outs: number,
    occupiedBases: number,
    balls: number,
    strikes: number,
    batterPointer: number,
    batterLinePointer: number,
    pitcherPointer: number,
    pitchCount: number,
    eventPointer: number,
    venuePointer: number,
    datePointer: number,
    timePointer: number,
    timezonePointer: number,
    seasonPointer: number,
  ): number;
  _apple_display_set_card(
    handle: number,
    screenState: number,
    titlePointer: number,
    statusPointer: number,
    notePointer: number,
    accent: number,
    statusColor: number,
    icon: number,
  ): number;
  _apple_display_render_screen(handle: number, rainFrame: number): number;
}

export default function createDeviceDisplayModule(): Promise<DeviceDisplayEmscriptenModule>;
