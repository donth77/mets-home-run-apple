import { describe, expect, it } from "vitest";
import { HOME_RUN_NOTIFICATION_TEMPLATES, selectHomeRunNotificationTitle } from "./homeRunCopy";

describe("home-run notification copy", () => {
  it("provides a varied pool of unique titles", () => {
    expect(HOME_RUN_NOTIFICATION_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(HOME_RUN_NOTIFICATION_TEMPLATES).size).toBe(HOME_RUN_NOTIFICATION_TEMPLATES.length);
    expect(HOME_RUN_NOTIFICATION_TEMPLATES.every((template) => template.includes("{player}"))).toBe(true);
  });

  it("selects across the full pool and inserts the player", () => {
    expect(selectHomeRunNotificationTitle("Francisco Lindor", 0)).toBe("Francisco Lindor hit a home run!");
    expect(selectHomeRunNotificationTitle("Bo Bichette", 0.999_999)).toBe("It's outta here! Bo Bichette goes deep!");
  });

  it("bounds invalid rolls and falls back when the player is unavailable", () => {
    expect(selectHomeRunNotificationTitle("", Number.NaN)).toBe("A Met hit a home run!");
    expect(selectHomeRunNotificationTitle("Juan Soto", 10)).toBe("It's outta here! Juan Soto goes deep!");
  });
});
