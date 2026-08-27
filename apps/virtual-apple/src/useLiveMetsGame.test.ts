import { describe, expect, it } from "vitest";
import { selectTrackableMetsGame } from "./useLiveMetsGame";

function game(gamePk: number, abstractState: string, detailedState: string) {
  return {
    gamePk,
    gameNumber: 1 as const,
    gameDate: "2026-08-27T23:10:00Z",
    abstractState,
    detailedState,
    away: { id: 146, abbreviation: "MIA", name: "Miami Marlins" },
    home: { id: 121, abbreviation: "NYM", name: "New York Mets" },
  };
}

describe("live Mets game selection", () => {
  it("selects an active game without treating a later doubleheader game as live", () => {
    const active = game(2, "Live", "In Progress");
    expect(selectTrackableMetsGame([game(1, "Final", "Final"), active, game(3, "Preview", "Scheduled")])).toBe(active);
  });

  it("keeps delayed and review states connected to their game feed", () => {
    expect(selectTrackableMetsGame([game(1, "Live", "Rain Delay")])?.gamePk).toBe(1);
    expect(selectTrackableMetsGame([game(2, "Live", "Umpire Review")])?.gamePk).toBe(2);
  });

  it("returns no game between games", () => {
    expect(selectTrackableMetsGame([game(1, "Final", "Final"), game(2, "Preview", "Scheduled")])).toBeUndefined();
  });
});
