import { describe, expect, it } from "vitest";
import { finalResultLabel, offseasonSeasonLabel } from "./physicalDisplayCanvas";

describe("physical display canvas", () => {
  it("matches the approved year-first offseason footer", () => {
    expect(offseasonSeasonLabel(new Date(2026, 8, 2))).toBe("2027 SEASON");
    expect(offseasonSeasonLabel(new Date(2027, 1, 2))).toBe("2027 SEASON");
  });

  it("uses the final card's lower line for the outcome", () => {
    expect(finalResultLabel({ away: { abbreviation: "NYM", runs: 5 }, home: { abbreviation: "ATL", runs: 3 } })).toBe(
      "METS WIN",
    );
    expect(finalResultLabel({ away: { abbreviation: "NYM", runs: 2 }, home: { abbreviation: "ATL", runs: 4 } })).toBe(
      undefined,
    );
    expect(finalResultLabel({ away: { abbreviation: "NYM", runs: 2 }, home: { abbreviation: "ATL", runs: 2 } })).toBe(
      "TIE GAME",
    );
  });
});
