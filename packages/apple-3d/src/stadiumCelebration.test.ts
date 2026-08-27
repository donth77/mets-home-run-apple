import { describe, expect, it } from "vitest";
import { stadiumCelebrationKind } from "./stadiumCelebration";

describe("stadium scoreboard celebrations", () => {
  it("selects the home-run artwork for confirmed home-run labels", () => {
    expect(stadiumCelebrationKind("JUAN SOTO · HOME RUN")).toBe("HOME_RUN");
    expect(stadiumCelebrationKind("JUAN SOTO · HR CONFIRMED")).toBe("HOME_RUN");
  });

  it("selects distinct grand-slam artwork", () => {
    expect(stadiumCelebrationKind("GRAND SLAM!!")).toBe("GRAND_SLAM");
  });

  it("hands the Mets-win artwork back to the final line score", () => {
    expect(stadiumCelebrationKind("METS WIN!")).toBe("METS_WIN");
    expect(stadiumCelebrationKind("METS WIN! · FINAL")).toBeNull();
    expect(stadiumCelebrationKind("FINAL")).toBeNull();
  });

  it("leaves ordinary game states on the line scoreboard", () => {
    expect(stadiumCelebrationKind("LIVE")).toBeNull();
    expect(stadiumCelebrationKind("RAIN DELAY")).toBeNull();
  });
});
