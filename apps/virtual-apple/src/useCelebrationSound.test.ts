import { describe, expect, it } from "vitest";
import { HOME_RUN_TRACK_URLS, selectHomeRunTrackUrl, selectWinTrackUrl, WIN_TRACK_URLS } from "./useCelebrationSound";

describe("celebration sound arrangements", () => {
  it("uses the four supplied home-run recordings", () => {
    expect(HOME_RUN_TRACK_URLS.map((url) => url.split("/").at(-1))).toEqual([
      "hr1.mp3",
      "hr2.mp3",
      "hr3.mp3",
      "hr4.mp3",
    ]);
    expect(new Set(HOME_RUN_TRACK_URLS).size).toBe(4);
  });

  it("can select any home-run recording from the random roll", () => {
    expect(selectHomeRunTrackUrl(0)).toBe(HOME_RUN_TRACK_URLS[0]);
    expect(selectHomeRunTrackUrl(0.249_999)).toBe(HOME_RUN_TRACK_URLS[0]);
    expect(selectHomeRunTrackUrl(0.25)).toBe(HOME_RUN_TRACK_URLS[1]);
    expect(selectHomeRunTrackUrl(0.5)).toBe(HOME_RUN_TRACK_URLS[2]);
    expect(selectHomeRunTrackUrl(0.75)).toBe(HOME_RUN_TRACK_URLS[3]);
    expect(selectHomeRunTrackUrl(0.999_999)).toBe(HOME_RUN_TRACK_URLS[3]);
  });

  it("uses the two supplied recordings instead of a synthesized Mets-win cue", () => {
    expect(WIN_TRACK_URLS.map((url) => url.split("/").at(-1))).toEqual(["win.mp3", "win2.mp3"]);
    expect(new Set(WIN_TRACK_URLS).size).toBe(2);
  });

  it("can select either win song from the random roll", () => {
    expect(selectWinTrackUrl(0)).toBe(WIN_TRACK_URLS[0]);
    expect(selectWinTrackUrl(0.499_999)).toBe(WIN_TRACK_URLS[0]);
    expect(selectWinTrackUrl(0.5)).toBe(WIN_TRACK_URLS[1]);
    expect(selectWinTrackUrl(0.999_999)).toBe(WIN_TRACK_URLS[1]);
  });
});
