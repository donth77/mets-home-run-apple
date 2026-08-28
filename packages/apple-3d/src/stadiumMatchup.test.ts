import { describe, expect, it } from "vitest";
import { stadiumMatchupFooter } from "./stadiumMatchup";

const matchup = {
  away: { id: 144, abbreviation: "ATL" },
  home: { id: 121, abbreviation: "NYM" },
  batter: "Juan Soto",
  batterLine: "1–2",
  pitcher: "Spencer Strider",
  pitchCount: 20,
} as const;

describe("stadium matchup footer", () => {
  it("complements a Mets batter with the opposing pitcher", () => {
    expect(stadiumMatchupFooter({ ...matchup, half: "BOTTOM" })).toEqual({
      leftLabel: "OPPOSING PITCHER",
      leftValue: "SPENCER STRIDER",
      rightLabel: "PITCH COUNT",
      rightValue: "20 PITCHES",
    });
  });

  it("complements a Mets pitcher with the opposing batter", () => {
    expect(
      stadiumMatchupFooter({
        ...matchup,
        half: "TOP",
        batter: "Ronald Acuña Jr.",
        batterLine: "0–3",
        pitcher: "Kodai Senga",
        pitchCount: 87,
      }),
    ).toEqual({
      leftLabel: "OPPOSING BATTER",
      leftValue: "RONALD ACUÑA JR.",
      rightLabel: "BATTER LINE",
      rightValue: "0–3",
    });
  });

  it("hides matchup details between innings and after the game", () => {
    expect(stadiumMatchupFooter({ ...matchup, half: "MIDDLE" })).toBeNull();
    expect(stadiumMatchupFooter({ ...matchup, half: "END" })).toBeNull();
  });

  it("hides matchup boxes when there is no active matchup to show", () => {
    expect(stadiumMatchupFooter({ ...matchup, phase: "SLEEP", half: "TOP" })).toBeNull();
    expect(stadiumMatchupFooter({ ...matchup, phase: "PREGAME", half: "TOP" })).toBeNull();
    expect(stadiumMatchupFooter({ ...matchup, phase: "CELEBRATION", half: "BOTTOM" })).toBeNull();
    expect(stadiumMatchupFooter({ ...matchup, phase: "FINAL", half: "BOTTOM" })).toBeNull();
    expect(stadiumMatchupFooter({ ...matchup, phase: "LIVE", half: "BOTTOM", standby: true })).toBeNull();
  });
});
