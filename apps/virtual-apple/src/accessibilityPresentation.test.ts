import type { GameSnapshot } from "@apple/protocol";
import { describe, expect, it } from "vitest";
import { gameStatusAnnouncement } from "./accessibilityPresentation";

const snapshot: GameSnapshot = {
  schemaVersion: 1,
  gamePk: 1,
  gameNumber: 1,
  phase: "LIVE",
  label: "LIVE",
  away: { abbreviation: "ATL", name: "Braves", runs: 2 },
  home: { abbreviation: "NYM", name: "Mets", runs: 3 },
  inning: 7,
  half: "BOTTOM",
  outs: 1,
  review: "NONE",
  lastEvent: "A pitch-level description that should not be announced",
};

describe("gameStatusAnnouncement", () => {
  it("announces meaningful live state without repeating pitch descriptions", () => {
    const announcement = gameStatusAnnouncement(snapshot, { betweenGames: false, offseason: false });
    expect(announcement).toBe("ATL 2, NYM 3. BOT 7, 1 out.");
    expect(announcement).not.toContain(snapshot.lastEvent);
  });

  it("announces between-game and offseason states", () => {
    expect(
      gameStatusAnnouncement(snapshot, {
        betweenGames: true,
        offseason: false,
        nextGameDay: "Tomorrow",
        nextGameTime: "7:10 PM",
      }),
    ).toBe("Next Mets game: Tomorrow at 7:10 PM.");
    expect(gameStatusAnnouncement(snapshot, { betweenGames: false, offseason: true })).toContain("offseason");
  });

  it("announces standby without describing a stale snapshot as final or between games", () => {
    const announcement = gameStatusAnnouncement(
      { ...snapshot, phase: "FINAL", label: "FINAL", half: "END", inning: 9 },
      { betweenGames: false, offseason: false, standby: true },
    );

    expect(announcement).toBe(
      "Live updates are temporarily unavailable. Standby. ATL 2, NYM 3. Last update: INNING 9.",
    );
    expect(announcement).not.toContain("Final");
    expect(announcement).not.toContain("between games");
  });
});
