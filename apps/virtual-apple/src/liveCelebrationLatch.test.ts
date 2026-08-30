import type { GameSnapshot, NormalizedGameInput } from "@apple/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { LiveCelebrationLatch } from "./liveCelebrationLatch";
import { LiveGameCoreController } from "./liveGameCoreController";

const activeControllers: LiveGameCoreController[] = [];

afterEach(() => {
  activeControllers.splice(0).forEach((controller) => {
    controller.dispose();
  });
});

function snapshot(lastEvent: string, homeRuns: number, batter: string): GameSnapshot {
  return {
    schemaVersion: 1,
    gamePk: 823580,
    gameNumber: 1,
    phase: "LIVE",
    label: "LIVE",
    away: { id: 117, abbreviation: "HOU", name: "Astros", runs: 1 },
    home: { id: 121, abbreviation: "NYM", name: "Mets", runs: homeRuns },
    inning: 1,
    half: "BOTTOM",
    outs: 0,
    review: "NONE",
    lastEvent,
    atBat: {
      balls: 0,
      strikes: 0,
      bases: { first: false, second: false, third: false },
      batter,
      pitcher: "Hunter Brown",
    },
  };
}

function input(
  cursor: string,
  homeRuns: number,
  plays: NormalizedGameInput["plays"],
  updateMode: NormalizedGameInput["updateMode"] = "INCREMENTAL",
): NormalizedGameInput {
  return {
    schemaVersion: 1,
    updateMode,
    gamePk: 823580,
    gameNumber: 1,
    cursor,
    phase: "LIVE",
    half: "BOTTOM",
    inning: 1,
    outs: 0,
    awayTeamId: 117,
    homeTeamId: 121,
    awayRuns: 1,
    homeRuns,
    plays,
  };
}

function homeRun(eventKey: string, atBatIndex: number, batterName: string) {
  return {
    eventKey,
    atBatIndex,
    battingTeamId: 121,
    batterName,
    kind: "HOME_RUN" as const,
    complete: true,
    review: "NONE" as const,
  };
}

describe("live celebration presentation latch", () => {
  it("holds live updates and presents every queued home run in a back-to-back-to-back sequence", async () => {
    const controller = await LiveGameCoreController.create();
    activeControllers.push(controller);
    const latch = new LiveCelebrationLatch();

    const bootstrapSnapshot = snapshot("Francisco Lindor batting", 0, "Francisco Lindor");
    const bootstrapInput = input("20260830_192123", 0, [], "BOOTSTRAP");
    latch.recordCapture({ coreInput: bootstrapInput, gameSnapshot: bootstrapSnapshot });
    expect(latch.accept(controller.ingest(bootstrapInput, 0), bootstrapSnapshot).snapshot).toBe(bootstrapSnapshot);

    const lindorKey = "823580:lindor-home-run";
    const lindorSnapshot = snapshot(
      "Francisco Lindor homers (14) on a fly ball to right field.",
      1,
      "Francisco Lindor",
    );
    const lindorInput = input("20260830_192134", 1, [homeRun(lindorKey, 5, "Francisco Lindor")]);
    latch.recordCapture({ coreInput: lindorInput, gameSnapshot: lindorSnapshot });
    const lindorPresentation = latch.accept(controller.ingest(lindorInput, 100), lindorSnapshot);
    expect(lindorPresentation.celebration?.subject).toBe("Francisco Lindor");
    expect(lindorPresentation.snapshot).toBe(lindorSnapshot);

    const nextBatterSnapshot = snapshot("Ball", 1, "Juan Soto");
    const nextBatterInput = input("20260830_192148", 1, []);
    latch.recordCapture({ coreInput: nextBatterInput, gameSnapshot: nextBatterSnapshot });
    expect(latch.accept(controller.ingest(nextBatterInput, 200), nextBatterSnapshot).snapshot).toBe(lindorSnapshot);

    const sotoKey = "823580:soto-home-run";
    const sotoSnapshot = snapshot("Juan Soto homers (22) on a fly ball to center field.", 2, "Juan Soto");
    const sotoInput = input("20260830_192231", 2, [homeRun(sotoKey, 6, "Juan Soto")]);
    latch.recordCapture({ coreInput: sotoInput, gameSnapshot: sotoSnapshot });
    const queued = latch.accept(controller.ingest(sotoInput, 300), sotoSnapshot);
    expect(queued.celebration?.eventKey).toBe(lindorKey);
    expect(queued.snapshot).toBe(lindorSnapshot);

    const thirdKey = "823580:third-home-run";
    const thirdSnapshot = snapshot("A third Mets hitter homers on a fly ball to right field.", 3, "Mets hitter");
    const thirdInput = input("20260830_192240", 3, [homeRun(thirdKey, 7, "Mets hitter")]);
    latch.recordCapture({ coreInput: thirdInput, gameSnapshot: thirdSnapshot });
    const thirdQueued = latch.accept(controller.ingest(thirdInput, 400), thirdSnapshot);
    expect(thirdQueued.celebration?.eventKey).toBe(lindorKey);
    expect(thirdQueued.snapshot).toBe(lindorSnapshot);

    const laterSnapshot = snapshot("Called Strike", 3, "Bo Bichette");
    const laterInput = input("20260830_192255", 3, []);
    latch.recordCapture({ coreInput: laterInput, gameSnapshot: laterSnapshot });
    expect(latch.accept(controller.ingest(laterInput, 500), laterSnapshot).snapshot).toBe(lindorSnapshot);

    latch.accept(controller.tick(2_100));
    const lindorRaised = controller.reportPosition(50, 5_400);
    if (!lindorRaised) throw new Error("Expected Lindor's sequence to reach the raised state.");
    latch.accept(lindorRaised);
    latch.accept(controller.tick(35_400));
    const lindorHome = controller.reportPosition(0, 38_700);
    if (!lindorHome) throw new Error("Expected Lindor's sequence to return home.");
    const sotoPresentation = latch.accept(lindorHome);
    expect(sotoPresentation.celebration).toMatchObject({ eventKey: sotoKey, subject: "Juan Soto" });
    expect(sotoPresentation.snapshot).toBe(sotoSnapshot);

    latch.accept(controller.tick(40_700));
    const sotoRaised = controller.reportPosition(50, 44_000);
    if (!sotoRaised) throw new Error("Expected Soto's sequence to reach the raised state.");
    latch.accept(sotoRaised);
    latch.accept(controller.tick(74_000));
    const sotoHome = controller.reportPosition(0, 77_300);
    if (!sotoHome) throw new Error("Expected Soto's sequence to return home.");
    const thirdPresentation = latch.accept(sotoHome);
    expect(thirdPresentation.celebration).toMatchObject({ eventKey: thirdKey, subject: "Mets hitter" });
    expect(thirdPresentation.snapshot).toBe(thirdSnapshot);

    latch.accept(controller.tick(79_300));
    const thirdRaised = controller.reportPosition(50, 82_600);
    if (!thirdRaised) throw new Error("Expected the third sequence to reach the raised state.");
    latch.accept(thirdRaised);
    latch.accept(controller.tick(112_600));
    const thirdHome = controller.reportPosition(0, 115_900);
    if (!thirdHome) throw new Error("Expected the third sequence to return home.");
    const resumed = latch.accept(thirdHome);
    expect(resumed.celebration).toBeUndefined();
    expect(resumed.snapshot).toBe(laterSnapshot);
  });
});
