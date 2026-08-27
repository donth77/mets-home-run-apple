import { describe, expect, it } from "vitest";
import { stadiumHeaderText, stadiumVenueLabel } from "./stadiumHeader";

describe("stadium scoreboard header", () => {
  it("only names Citi Field when the scoreboard is at Citi Field", () => {
    expect(stadiumVenueLabel(true)).toBe("CITI FIELD");
    expect(stadiumVenueLabel(false)).toBe("");
    expect(stadiumVenueLabel(undefined)).toBe("CITI FIELD");
  });

  it("uses the next game and local date-time callout between games", () => {
    expect(
      stadiumHeaderText({
        phase: "SLEEP",
        label: "BETWEEN GAMES",
        half: "TOP",
        inning: 1,
        outs: 0,
        nextGame: { day: "Tonight", time: "7:10 PM" },
      }),
    ).toEqual({ center: "NEXT GAME · TONIGHT - 7:10 PM", right: "" });
  });

  it("does not show stale inning information while waiting for a schedule", () => {
    expect(
      stadiumHeaderText({
        phase: "SLEEP",
        label: "BETWEEN GAMES",
        half: "TOP",
        inning: 1,
        outs: 0,
      }),
    ).toEqual({ center: "NEXT GAME · SCHEDULE TBD", right: "" });
  });
});
