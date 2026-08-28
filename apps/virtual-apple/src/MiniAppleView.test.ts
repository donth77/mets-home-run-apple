import { getScenario } from "@apple/test-fixtures";
import { describe, expect, it } from "vitest";
import { miniAppleStatus } from "./MiniAppleView";

const liveSnapshot = getScenario("live").frames[0].snapshot;

describe("miniAppleStatus", () => {
  it("prioritizes standby over a retained game state", () => {
    expect(
      miniAppleStatus(liveSnapshot, {
        betweenGames: false,
        nextGame: { day: "Tomorrow", time: "7:10 PM" },
        offseason: false,
        standby: true,
      }),
    ).toEqual({ detail: "Live updates paused", label: "STANDBY" });
  });

  it("uses the next matchup while the Apple rests", () => {
    expect(
      miniAppleStatus(getScenario("sleep").frames[0].snapshot, {
        betweenGames: true,
        nextGame: { day: "Tomorrow", time: "7:10 PM" },
        offseason: false,
        standby: false,
      }),
    ).toEqual({ detail: "Tomorrow · 7:10 PM", label: "NEXT GAME" });
  });

  it("keeps the event description during a celebration", () => {
    const celebration = getScenario("home-run").frames[1].snapshot;
    expect(
      miniAppleStatus(celebration, {
        betweenGames: false,
        nextGame: { day: "", time: "" },
        offseason: false,
        standby: false,
      }),
    ).toEqual({ detail: celebration.lastEvent, label: celebration.label });
  });
});
