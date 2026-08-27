import { describe, expect, it } from "vitest";
import { HOME_RUN_TRACK_URLS, selectHomeRunTrackUrl, selectWinTrackUrl, WIN_TRACK_URLS } from "./useCelebrationSound";

describe("celebration sound arrangements", () => {
  it("uses the four supplied home-run recordings", () => {
    expect(HOME_RUN_TRACK_URLS).toEqual(["/audio/hr1.mp3", "/audio/hr2.mp3", "/audio/hr3.mp3", "/audio/hr4.mp3"]);
    expect(new Set(HOME_RUN_TRACK_URLS).size).toBe(4);
  });

  it("can select any home-run recording from the random roll", () => {
    expect(selectHomeRunTrackUrl(0)).toBe("/audio/hr1.mp3");
    expect(selectHomeRunTrackUrl(0.249_999)).toBe("/audio/hr1.mp3");
    expect(selectHomeRunTrackUrl(0.25)).toBe("/audio/hr2.mp3");
    expect(selectHomeRunTrackUrl(0.5)).toBe("/audio/hr3.mp3");
    expect(selectHomeRunTrackUrl(0.75)).toBe("/audio/hr4.mp3");
    expect(selectHomeRunTrackUrl(0.999_999)).toBe("/audio/hr4.mp3");
  });

  it("uses the two supplied recordings instead of a synthesized Mets-win cue", () => {
    expect(WIN_TRACK_URLS).toEqual(["/audio/win.mp3", "/audio/win2.mp3"]);
    expect(new Set(WIN_TRACK_URLS).size).toBe(2);
  });

  it("can select either win song from the random roll", () => {
    expect(selectWinTrackUrl(0)).toBe("/audio/win.mp3");
    expect(selectWinTrackUrl(0.499_999)).toBe("/audio/win.mp3");
    expect(selectWinTrackUrl(0.5)).toBe("/audio/win2.mp3");
    expect(selectWinTrackUrl(0.999_999)).toBe("/audio/win2.mp3");
  });
});
