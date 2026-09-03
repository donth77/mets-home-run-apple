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
        nextGame: { day: "Tonight", time: "7:10 PM EDT" },
      }),
    ).toEqual({ center: "NEXT GAME · TONIGHT - 7:10 PM EDT", right: "" });
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

  it("shows the final state once instead of duplicating it on the right", () => {
    expect(
      stadiumHeaderText({
        phase: "FINAL",
        label: "FINAL",
        half: "END",
        inning: 9,
        outs: 3,
      }),
    ).toEqual({ center: "FINAL", right: "" });
  });

  it("shows standby and the retained inning instead of a stale final", () => {
    const header = stadiumHeaderText({
      phase: "FINAL",
      label: "FINAL",
      half: "END",
      inning: 9,
      outs: 3,
      standby: true,
    });

    expect(header).toEqual({ center: "STANDBY", right: "INNING 9  ·  LAST UPDATE" });
    expect(JSON.stringify(header)).not.toContain("FINAL");
    expect(JSON.stringify(header)).not.toContain("BETWEEN GAMES");
  });

  it("labels a live bottom-half changeover END rather than MID or FINAL", () => {
    const header = stadiumHeaderText({
      phase: "LIVE",
      label: "LIVE",
      half: "END",
      inning: 2,
      outs: 3,
    });

    expect(header).toEqual({ center: "LIVE", right: "END 2  ·  3 OUTS" });
    expect(JSON.stringify(header)).not.toContain("FINAL");
  });

  it("does not trust a stale final label when the game phase is live", () => {
    const header = stadiumHeaderText({
      phase: "LIVE",
      label: "FINAL",
      half: "END",
      inning: 2,
      outs: 3,
    });

    expect(header.center).toBe("LIVE");
    expect(JSON.stringify(header)).not.toContain("FINAL");
  });
});
