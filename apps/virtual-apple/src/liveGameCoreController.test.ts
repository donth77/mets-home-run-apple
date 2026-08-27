import { afterEach, describe, expect, it } from "vitest";
import type { NormalizedGameInput } from "@apple/protocol";
import { LiveGameCoreController } from "./liveGameCoreController";

const activeControllers: LiveGameCoreController[] = [];

afterEach(() => {
  activeControllers.splice(0).forEach((controller) => {
    controller.dispose();
  });
});

function input(cursor: string, updateMode: "BOOTSTRAP" | "INCREMENTAL"): NormalizedGameInput {
  return {
    schemaVersion: 1,
    updateMode,
    gamePk: 824560,
    gameNumber: 1,
    cursor,
    phase: "LIVE",
    half: "BOTTOM",
    inning: 6,
    outs: 1,
    awayTeamId: 144,
    homeTeamId: 121,
    awayRuns: 2,
    homeRuns: updateMode === "BOOTSTRAP" ? 2 : 3,
    plays:
      updateMode === "BOOTSTRAP"
        ? []
        : [
            {
              eventKey: "824560:play-42",
              atBatIndex: 42,
              battingTeamId: 121,
              batterName: "Francisco Lindor",
              kind: "HOME_RUN",
              complete: true,
              review: "NONE",
            },
          ],
  };
}

describe("Virtual Apple live core controller", () => {
  it("maps a normalized live home run through the canonical lead-in, raise, hold, and retract sequence", async () => {
    const controller = await LiveGameCoreController.create();
    activeControllers.push(controller);

    const bootstrap = controller.ingest(input("20260827_190000", "BOOTSTRAP"), 0);
    expect(bootstrap.celebration).toBeUndefined();
    expect(bootstrap.targetPositionMm).toBe(0);

    const detected = controller.ingest(input("20260827_190010", "INCREMENTAL"), 100);
    expect(detected.celebration).toEqual({
      eventKey: "824560:play-42",
      kind: "HOME_RUN",
      subject: "Francisco Lindor",
    });
    expect(detected.targetPositionMm).toBe(0);

    expect(controller.tick(2_099).targetPositionMm).toBe(0);
    expect(controller.tick(2_100).targetPositionMm).toBe(50);
    expect(controller.reportPosition(49, 4_000)).toBeUndefined();
    expect(controller.reportPosition(50, 4_000)?.targetPositionMm).toBe(50);
    expect(controller.tick(33_999).targetPositionMm).toBe(50);
    expect(controller.tick(34_000).targetPositionMm).toBe(0);
    expect(controller.reportPosition(0, 35_000)?.celebration).toBeUndefined();
  });
});
