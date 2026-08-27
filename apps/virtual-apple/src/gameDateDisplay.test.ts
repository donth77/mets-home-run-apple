import { describe, expect, it } from "vitest";
import { gameDateParts, nextGameLabelParts } from "./gameDateDisplay";

describe("browser-local game date labels", () => {
  const now = new Date("2026-08-27T16:00:00Z");
  const timeZone = "America/Los_Angeles";

  it("uses Today and Tonight only for the browser's current calendar day", () => {
    expect(gameDateParts("2026-08-27T19:10:00Z", now, timeZone).day).toBe("Today");
    expect(gameDateParts("2026-08-28T02:10:00Z", now, timeZone).day).toBe("Tonight");
  });

  it("uses Tomorrow for the next browser-local calendar day", () => {
    expect(gameDateParts("2026-08-28T23:10:00Z", now, timeZone).day).toBe("Tomorrow");
  });

  it("keeps the weekday for games after tomorrow", () => {
    expect(gameDateParts("2026-08-30T20:10:00Z", now, timeZone)).toMatchObject({ day: "Sun", date: "Aug 30" });
  });
});

describe("next-game heading", () => {
  it("removes the separator and separates the start time for styling", () => {
    expect(nextGameLabelParts("NEXT GAME · FRI 7:10 PM")).toEqual({ day: "FRI", time: "7:10 PM" });
    expect(nextGameLabelParts("NEXT GAME TOMORROW 1:05 PM")).toEqual({ day: "TOMORROW", time: "1:05 PM" });
  });
});
