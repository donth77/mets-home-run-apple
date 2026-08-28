import type { GameSnapshot } from "@apple/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Scoreboard } from "./Scoreboard";
import { teamScorebugColors } from "./teamColors";

const awayMetsSnapshot: GameSnapshot = {
  schemaVersion: 1,
  gamePk: 1,
  gameNumber: 1,
  phase: "LIVE",
  label: "LIVE",
  away: { id: 121, abbreviation: "NYM", name: "Mets", runs: 3 },
  home: { id: 147, abbreviation: "NYY", name: "Yankees", runs: 2 },
  inning: 6,
  half: "TOP",
  outs: 1,
  review: "NONE",
  lastEvent: "Mets at bat",
};

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

describe("Scoreboard", () => {
  it("marks the Mets row by identity when the Mets are the away team", () => {
    const html = renderToStaticMarkup(<Scoreboard snapshot={awayMetsSnapshot} variant="lab" announceUpdates={false} />);

    expect(html).toContain(
      'class="apple-scoreboard__team apple-scoreboard__team--mets"><span class="apple-scoreboard__abbr">NYM',
    );
    expect(html).toContain('class="apple-scoreboard__team"><span class="apple-scoreboard__abbr">NYY');
  });

  it.each(["BAL", "LAA", "MIA", "SFG", "WSH", "UNKNOWN"])(
    "keeps white score text at WCAG AA contrast for %s",
    (team) => {
      const { primary } = teamScorebugColors(team);
      const contrast = 1.05 / (relativeLuminance(primary) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("leaves the inning slot empty instead of showing final when standby has no current inning", () => {
    const html = renderToStaticMarkup(
      <Scoreboard
        snapshot={{ ...awayMetsSnapshot, phase: "FINAL", label: "FINAL", half: "END", inning: 9 }}
        announceUpdates={false}
        standby
      />,
    );

    expect(html).toContain("STANDBY");
    expect(html).toContain('class="apple-scorebug__standby"></div>');
    expect(html).not.toContain("INN 9");
    expect(html).not.toContain("FINAL");
    expect(html).not.toContain("BETWEEN GAMES");
  });

  it("never labels an end-of-inning live game as final", () => {
    const html = renderToStaticMarkup(
      <Scoreboard
        snapshot={{ ...awayMetsSnapshot, phase: "LIVE", label: "LIVE", half: "END", inning: 2, outs: 3 }}
        announceUpdates={false}
      />,
    );

    expect(html).toContain("LIVE");
    expect(html).not.toContain("FINAL");
  });

  it("does not trust a stale final label when the game phase is live", () => {
    const html = renderToStaticMarkup(
      <Scoreboard
        snapshot={{ ...awayMetsSnapshot, phase: "LIVE", label: "FINAL", half: "END", inning: 2, outs: 3 }}
        announceUpdates={false}
      />,
    );

    expect(html).toContain("LIVE");
    expect(html).not.toContain("FINAL");
  });
});
