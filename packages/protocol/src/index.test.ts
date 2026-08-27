import { describe, expect, it } from "vitest";
import { clampPositionMm, mlbTeamNickname } from "./index";

describe("clampPositionMm", () => {
  it("keeps recording motion inside the 50 mm envelope", () => {
    expect(clampPositionMm(-12)).toBe(0);
    expect(clampPositionMm(25.4)).toBe(25);
    expect(clampPositionMm(78)).toBe(50);
    expect(clampPositionMm(Number.NaN)).toBe(0);
  });
});

describe("mlbTeamNickname", () => {
  it("uses nickname-only labels for MLB scoreboards", () => {
    expect(mlbTeamNickname({ abbreviation: "MIL", name: "Milwaukee Brewers" })).toBe("Brewers");
    expect(mlbTeamNickname({ abbreviation: "BOS", name: "Boston Red Sox" })).toBe("Red Sox");
    expect(mlbTeamNickname({ abbreviation: "ATL", name: "Atlanta" })).toBe("Braves");
  });

  it("preserves the supplied name for an unknown team", () => {
    expect(mlbTeamNickname({ abbreviation: "TBD", name: "Next opponent" })).toBe("Next opponent");
  });
});
