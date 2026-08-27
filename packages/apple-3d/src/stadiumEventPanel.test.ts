import { describe, expect, it } from "vitest";
import { stadiumEventPanelText } from "./stadiumEventPanel";

describe("stadium scoreboard event panel", () => {
  it("hides the lower panel between games", () => {
    expect(
      stadiumEventPanelText({
        phase: "SLEEP",
        lastEvent: "The Apple is resting until the next Mets game.",
      }),
    ).toBeNull();
  });

  it("keeps the current activity during a live game", () => {
    expect(
      stadiumEventPanelText({
        phase: "LIVE",
        lastEvent: "Top eighth begins",
      }),
    ).toBe("Top eighth begins");
  });
});
