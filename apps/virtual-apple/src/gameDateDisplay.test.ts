import { describe, expect, it } from "vitest";
import { gameDateParts, nextGameLabelParts, timeZoneAbbreviation } from "./gameDateDisplay";

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

  it("shows MLB's own date and no time while the start time is not set", () => {
    // The 2027 opener at Clover Park, listed at 3:33 AM Eastern until MLB sets
    // a time: that is the evening before in Los Angeles.
    const listed = { officialDate: "2027-02-19", startTimeTbd: true };
    const beforeOpener = new Date("2027-02-16T18:00:00Z");
    expect(gameDateParts("2027-02-19T08:33:00Z", beforeOpener, timeZone, listed)).toEqual({
      day: "Fri",
      date: "Feb 19",
      time: "TBD",
      timeSet: false,
    });
    expect(gameDateParts("2027-02-19T08:33:00Z", new Date("2027-02-18T18:00:00Z"), timeZone, listed).day).toBe(
      "Tomorrow",
    );
    expect(gameDateParts("2027-02-19T08:33:00Z", beforeOpener, timeZone)).toMatchObject({
      day: "Fri",
      time: "12:33 AM",
      timeSet: true,
    });
  });

  it("uses the browser time zone's current abbreviation", () => {
    expect(timeZoneAbbreviation(new Date("2026-08-27T16:00:00Z"), "America/Los_Angeles")).toBe("PDT");
    expect(timeZoneAbbreviation(new Date("2026-12-27T16:00:00Z"), "America/Los_Angeles")).toBe("PST");
  });
});

describe("next-game heading", () => {
  it("removes the separator and separates the start time for styling", () => {
    expect(nextGameLabelParts("NEXT GAME · FRI 7:10 PM")).toEqual({ day: "FRI", time: "7:10 PM" });
    expect(nextGameLabelParts("NEXT GAME TOMORROW 1:05 PM")).toEqual({ day: "TOMORROW", time: "1:05 PM" });
  });
});
