import { describe, expect, it } from "vitest";
import { buildCustomScenario, CUSTOM_SCENARIO_ID, defaultCustomScenario, normalizeCustomScenario } from "./customScenario";

describe("custom scenario", () => {
  it("renders the owner's game state on both sides of the plate", () => {
    const home = buildCustomScenario({ ...defaultCustomScenario, celebration: "NONE" });
    expect(home.id).toBe(CUSTOM_SCENARIO_ID);
    expect(home.frames[0].snapshot.home).toMatchObject({ abbreviation: "NYM", runs: 3 });
    expect(home.frames[0].snapshot.away).toMatchObject({ abbreviation: "ATL", name: "Atlanta", runs: 2 });
    expect(home.frames[0].snapshot.atBat).toMatchObject({ batter: "Francisco Lindor", pitcher: "Strider", pitchCount: 74 });
    expect(home.frames.every((frame) => frame.positionMm === 0)).toBe(true);
    expect(home.deviceFixture.expectedMotionSequences).toBe(0);

    const away = buildCustomScenario({ ...defaultCustomScenario, metsSide: "AWAY", celebration: "NONE" });
    expect(away.frames[0].snapshot.away.abbreviation).toBe("NYM");
    expect(away.frames[0].snapshot.home.abbreviation).toBe("ATL");
  });

  it("follows the built-in lift profile for a home run and names the batter", () => {
    const scenario = buildCustomScenario({ ...defaultCustomScenario, celebration: "HOME_RUN", subject: "" });
    const started = scenario.frames.find((frame) => frame.events.some((event) => event.type === "CELEBRATION_STARTED"));
    expect(started?.atMs).toBe(900);
    expect(started?.events[0]).toMatchObject({ celebration: "HOME_RUN", subject: "Francisco Lindor" });
    expect(started?.snapshot.label).toBe("FRANCISCO LINDOR · HOME RUN");
    expect(scenario.frames.map((frame) => [frame.atMs, frame.positionMm])).toEqual([
      [0, 0],
      [900, 0],
      [2900, 50],
      [8000, 50],
      [38000, 0],
      [43100, 0],
    ]);
    expect(scenario.frames.at(-1)?.snapshot.phase).toBe("LIVE");
    expect(scenario.deviceFixture.frames).toEqual([]);
  });

  it("ends a Mets win on the final card and keeps the headline", () => {
    const scenario = buildCustomScenario({ ...defaultCustomScenario, celebration: "METS_WIN", subject: "Put it in the books" });
    const started = scenario.frames.find((frame) => frame.events.length > 0);
    expect(started?.events[0]).toMatchObject({ celebration: "METS_WIN", subject: "Put it in the books" });
    expect(started?.snapshot.label).toBe("METS WIN!");
    expect(scenario.frames.at(-1)?.snapshot.phase).toBe("FINAL");
  });

  it("keeps typed values inside what the display can show", () => {
    const form = normalizeCustomScenario({
      ...defaultCustomScenario,
      opponentAbbreviation: "philadelphia",
      opponentName: "",
      metsRuns: 150,
      inning: 0,
      outs: 7,
      balls: -1,
      strikes: 9,
      batter: `${"A".repeat(40)}  `,
    });
    expect(form.opponentAbbreviation).toBe("PHI");
    expect(form.opponentName).toBe("Opponent");
    expect(form.metsRuns).toBe(99);
    expect(form.inning).toBe(1);
    expect(form.outs).toBe(2);
    expect(form.balls).toBe(0);
    expect(form.strikes).toBe(2);
    expect(form.batter).toHaveLength(32);
  });
});
