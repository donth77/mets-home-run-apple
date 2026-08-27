import { describe, expect, it } from "vitest";
import { frameAt, getScenario, scenarioDuration } from "./index";

describe("offline browser fixtures", () => {
  it("records exactly one extend and retract for a confirmed Mets home run", () => {
    const commands = getScenario("home-run").frames.flatMap((frame) => frame.commands);
    expect(commands.filter((command) => command.type === "MOTION_EXTEND")).toHaveLength(1);
    expect(commands.filter((command) => command.type === "MOTION_RETRACT")).toHaveLength(1);
  });

  it("records no motion for an overturned review", () => {
    const commands = getScenario("review-overturned").frames.flatMap((frame) => frame.commands);
    expect(commands.filter((command) => command.type.startsWith("MOTION_") && command.type !== "MOTION_DISABLE")).toHaveLength(0);
  });

  it("advances deterministic fake time without sleeping", () => {
    const scenario = getScenario("review-confirmed");
    expect(frameAt(scenario, 1000).snapshot.review).toBe("PENDING");
    expect(frameAt(scenario, scenarioDuration(scenario)).snapshot.review).toBe("CONFIRMED");
  });
});
