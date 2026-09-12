import type { NormalizedGameInput } from "@apple/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { coreSequenceNeedsTicking, LiveGameCoreController, VIRTUAL_ACTUATOR_STROKE_MS } from "./liveGameCoreController";

const activeControllers: LiveGameCoreController[] = [];

afterEach(() => {
  activeControllers.splice(0).forEach((controller) => {
    controller.dispose();
  });
});

function input(
  cursor: string,
  updateMode: "BOOTSTRAP" | "INCREMENTAL",
  kind: "HOME_RUN" | "GRAND_SLAM" = "HOME_RUN",
): NormalizedGameInput {
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
              kind,
              complete: true,
              review: "NONE",
            },
          ],
  };
}

describe("Virtual Apple live core controller", () => {
  it("only runs the local timer while a sequence can advance with time", () => {
    expect(coreSequenceNeedsTicking("IDLE")).toBe(false);
    expect(coreSequenceNeedsTicking("REVIEW_HOLD")).toBe(false);
    expect(coreSequenceNeedsTicking("FAULT")).toBe(false);
    expect(coreSequenceNeedsTicking("LEAD_IN")).toBe(true);
    expect(coreSequenceNeedsTicking("EXTENDING")).toBe(true);
    expect(coreSequenceNeedsTicking("RAISED")).toBe(true);
    expect(coreSequenceNeedsTicking("RETRACTING")).toBe(true);
  });

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

  it("retains the grand-slam presentation kind from the core", async () => {
    const controller = await LiveGameCoreController.create();
    activeControllers.push(controller);

    controller.ingest(input("20260827_190000", "BOOTSTRAP"), 0);
    expect(controller.ingest(input("20260827_190010", "INCREMENTAL", "GRAND_SLAM"), 100).celebration).toEqual({
      eventKey: "824560:play-42",
      kind: "GRAND_SLAM",
      subject: "Francisco Lindor",
    });
  });

  it("arrives by drive time when a paused animation never reports a position", async () => {
    const controller = await LiveGameCoreController.create();
    activeControllers.push(controller);

    controller.ingest(input("20260912_195135", "BOOTSTRAP"), 0);
    controller.ingest(input("20260912_195154", "INCREMENTAL", "GRAND_SLAM"), 100);
    expect(controller.tick(2_100).decision?.sequenceState).toBe("EXTENDING");

    const extendDueAt = 2_100 + VIRTUAL_ACTUATOR_STROKE_MS;
    expect(controller.tick(extendDueAt - 100).decision?.sequenceState).toBe("EXTENDING");
    const raised = controller.tick(extendDueAt);
    expect(raised.decision?.sequenceState).toBe("RAISED");
    expect(raised.celebration?.kind).toBe("GRAND_SLAM");
    expect(raised.targetPositionMm).toBe(50);

    // The core's 10 s motion deadline passes without a fault; a hidden tab used to end the celebration here.
    const pastDeadline = controller.tick(2_100 + 10_000 + 100);
    expect(pastDeadline.decision?.faultLatched).toBe(false);
    expect(pastDeadline.decision?.sequenceState).toBe("RAISED");
    expect(pastDeadline.celebration?.kind).toBe("GRAND_SLAM");

    const retractIssuedAt = extendDueAt + 30_000;
    const retracting = controller.tick(retractIssuedAt);
    expect(retracting.decision?.sequenceState).toBe("RETRACTING");
    expect(retracting.targetPositionMm).toBe(0);
    expect(retracting.celebration?.kind).toBe("GRAND_SLAM");

    const retractDueAt = retractIssuedAt + VIRTUAL_ACTUATOR_STROKE_MS;
    expect(controller.tick(retractDueAt - 100).celebration?.kind).toBe("GRAND_SLAM");
    const home = controller.tick(retractDueAt);
    expect(home.decision?.sequenceState).toBe("IDLE");
    expect(home.decision?.faultLatched).toBe(false);
    expect(home.celebration).toBeUndefined();
  });

  it("finishes the sequence when the page clock jumps far ahead, without tripping the motion deadline", async () => {
    const controller = await LiveGameCoreController.create();
    activeControllers.push(controller);

    controller.ingest(input("20260912_195135", "BOOTSTRAP"), 0);
    controller.ingest(input("20260912_195154", "INCREMENTAL"), 100);
    expect(controller.tick(2_100).decision?.sequenceState).toBe("EXTENDING");

    // A frozen page resumes a minute later: the drive finished on time, so the dwell has also elapsed.
    const resumed = controller.tick(60_000);
    expect(resumed.decision?.faultLatched).toBe(false);
    expect(resumed.decision?.sequenceState).toBe("RETRACTING");
    expect(resumed.targetPositionMm).toBe(0);
    expect(resumed.celebration?.eventKey).toBe("824560:play-42");
    expect(resumed.decision?.traces.map((trace) => trace.code)).toEqual(["MOTION_RETRACT_ISSUED"]);

    const home = controller.tick(60_000 + VIRTUAL_ACTUATOR_STROKE_MS);
    expect(home.decision?.sequenceState).toBe("IDLE");
    expect(home.celebration).toBeUndefined();
  });

  it("lets an animation frame report arrival early without a duplicate report later", async () => {
    const controller = await LiveGameCoreController.create();
    activeControllers.push(controller);

    controller.ingest(input("20260912_195135", "BOOTSTRAP"), 0);
    controller.ingest(input("20260912_195154", "INCREMENTAL"), 100);
    controller.tick(2_100);
    expect(controller.reportPosition(50, 4_000)?.decision?.sequenceState).toBe("RAISED");
    const afterDriveTime = controller.tick(2_100 + VIRTUAL_ACTUATOR_STROKE_MS);
    expect(afterDriveTime.decision?.sequenceState).toBe("RAISED");
    expect(afterDriveTime.decision?.traces).toEqual([]);
    expect(controller.reportPosition(50, 8_000)).toBeUndefined();
  });
});
