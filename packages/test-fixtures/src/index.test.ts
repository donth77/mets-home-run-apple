import { describe, expect, it } from "vitest";
import { fixtureScenarios, frameAt, getScenario, scenarioDuration } from "./index";

describe("offline browser fixtures", () => {
  it("records exactly one extend and retract for a confirmed Mets home run", () => {
    const scenario = getScenario("home-run");
    const commands = scenario.frames.flatMap((frame) => frame.commands);
    const events = scenario.frames.flatMap((frame) => frame.events);
    expect(events).toMatchObject([{ type: "CELEBRATION_STARTED", celebration: "HOME_RUN" }]);
    expect(commands.filter((command) => command.type === "MOTION_EXTEND")).toHaveLength(1);
    expect(commands.filter((command) => command.type === "MOTION_RETRACT")).toHaveLength(1);
  });

  it("labels a grand slam distinctly while retaining the home-run motion sequence", () => {
    const scenario = getScenario("grand-slam");
    const commands = scenario.frames.flatMap((fixtureFrame) => fixtureFrame.commands);
    expect(scenario.frames.some((fixtureFrame) => fixtureFrame.snapshot.label === "GRAND SLAM!!")).toBe(true);
    expect(scenario.frames[1].events[0].subject).toBe("Francisco Lindor");
    expect(scenario.deviceFixture.frames[1].input.plays[0].kind).toBe("GRAND_SLAM");
    expect(commands.filter((command) => command.type === "MOTION_EXTEND")).toHaveLength(1);
    expect(commands.filter((command) => command.type === "MOTION_RETRACT")).toHaveLength(1);
  });

  it("records no motion for an overturned review", () => {
    const commands = getScenario("review-overturned").frames.flatMap((frame) => frame.commands);
    expect(
      commands.filter((command) => command.type.startsWith("MOTION_") && command.type !== "MOTION_DISABLE"),
    ).toHaveLength(0);
  });

  it("advances deterministic fake time without sleeping", () => {
    const scenario = getScenario("review-confirmed");
    expect(frameAt(scenario, 1000).snapshot.review).toBe("PENDING");
    expect(frameAt(scenario, scenarioDuration(scenario)).snapshot.review).toBe("CONFIRMED");
  });

  it("keeps the offseason fixture out of an active matchup", () => {
    const snapshot = getScenario("offseason").frames[0].snapshot;
    expect(snapshot.label).toBe("OFFSEASON");
    expect(snapshot.phase).toBe("SLEEP");
    expect(snapshot.atBat).toBeUndefined();
    expect(snapshot.linescore).toBeUndefined();
  });

  it("labels the completed Mets-win state as final", () => {
    const finalFrames = getScenario("mets-win").frames.filter(
      (fixtureFrame) => fixtureFrame.snapshot.phase === "FINAL",
    );
    expect(finalFrames.length).toBeGreaterThan(0);
    expect(finalFrames.every((fixtureFrame) => fixtureFrame.snapshot.label === "FINAL")).toBe(true);
  });

  it("gives every browser scenario a versioned, normalized on-device fixture", () => {
    for (const scenario of fixtureScenarios) {
      expect(scenario.deviceFixture.schemaVersion).toBe(1);
      expect(scenario.deviceFixture.fixtureVersion).toBe(1);
      expect(scenario.deviceFixture.frames.length).toBeGreaterThan(0);
      expect(scenario.deviceFixture.frames[0].input.updateMode).toBe("BOOTSTRAP");
      expect(
        scenario.deviceFixture.frames.every(
          (fixtureFrame, index, frames) => index === 0 || fixtureFrame.atMs >= frames[index - 1].atMs,
        ),
      ).toBe(true);
    }
  });
});
