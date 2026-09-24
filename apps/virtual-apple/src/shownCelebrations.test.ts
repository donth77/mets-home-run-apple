/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetExpiredCelebrations,
  readShownCelebrations,
  rememberShownCelebration,
  SHOWN_CELEBRATION_MEMORY_MS,
} from "./shownCelebrations";

const STORAGE_KEY = "virtual-apple:shown-celebrations";
const shownAt = Date.parse("2026-08-28T23:05:00.000Z");

function storedKeys() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === null ? undefined : Object.keys(JSON.parse(stored));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shown celebrations", () => {
  it("remembers a shown celebration for the next page load", () => {
    rememberShownCelebration("823583:soto-home-run", shownAt);
    rememberShownCelebration("823583:final", shownAt + 60_000);

    expect(readShownCelebrations(shownAt + 90_000)).toEqual(new Set(["823583:soto-home-run", "823583:final"]));
  });

  it("ignores an aged-out celebration when reading, without writing", () => {
    rememberShownCelebration("823583:soto-home-run", shownAt);

    expect(readShownCelebrations(shownAt + SHOWN_CELEBRATION_MEMORY_MS).has("823583:soto-home-run")).toBe(true);
    expect(readShownCelebrations(shownAt + SHOWN_CELEBRATION_MEMORY_MS + 1).size).toBe(0);
    expect(storedKeys()).toEqual(["823583:soto-home-run"]);
  });

  it("deletes aged-out celebrations, and the whole record once none are left", () => {
    rememberShownCelebration("823583:soto-home-run", shownAt);
    rememberShownCelebration("823584:lindor-home-run", shownAt + 60 * 60_000);

    forgetExpiredCelebrations(shownAt + SHOWN_CELEBRATION_MEMORY_MS + 1);
    expect(storedKeys()).toEqual(["823584:lindor-home-run"]);

    forgetExpiredCelebrations(shownAt + 60 * 60_000 + SHOWN_CELEBRATION_MEMORY_MS + 1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("deletes aged-out celebrations whenever a new one is remembered", () => {
    rememberShownCelebration("823583:soto-home-run", shownAt);
    rememberShownCelebration("823584:lindor-home-run", shownAt + SHOWN_CELEBRATION_MEMORY_MS + 1);

    expect(storedKeys()).toEqual(["823584:lindor-home-run"]);
  });

  it("deletes an entry written under a clock set far ahead", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "823583:soto-home-run": shownAt + SHOWN_CELEBRATION_MEMORY_MS + 1 }),
    );

    forgetExpiredCelebrations(shownAt);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("deletes an unreadable record and starts over", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    expect(readShownCelebrations(shownAt).size).toBe(0);

    forgetExpiredCelebrations(shownAt);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    rememberShownCelebration("823583:soto-home-run", shownAt);
    expect(readShownCelebrations(shownAt)).toEqual(new Set(["823583:soto-home-run"]));
  });

  it("carries on when the browser blocks storage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    expect(() => rememberShownCelebration("823583:soto-home-run", shownAt)).not.toThrow();
    expect(() => forgetExpiredCelebrations(shownAt)).not.toThrow();
    expect(readShownCelebrations(shownAt).size).toBe(0);
  });
});
