import { describe, expect, it } from "vitest";
import {
  ACTUATOR_FULL_STROKE_SECONDS,
  ACTUATOR_RATED_SPEED_MM_PER_SECOND,
  HOME_RUN_RAISED_DWELL_MS,
  WIN_RAISED_DWELL_MS,
  actuatorMotionState,
  advanceActuatorPosition,
} from "./actuatorPhysics";

describe("actuator physics", () => {
  it("takes the rated time to traverse the 50 mm stroke", () => {
    expect(ACTUATOR_FULL_STROKE_SECONDS).toBeCloseTo(3.2808, 3);
    expect(advanceActuatorPosition(0, 50, ACTUATOR_FULL_STROKE_SECONDS)).toBeCloseTo(50, 6);
  });

  it("advances at a constant rated speed without overshooting", () => {
    expect(advanceActuatorPosition(0, 50, 1)).toBeCloseTo(ACTUATOR_RATED_SPEED_MM_PER_SECOND, 6);
    expect(advanceActuatorPosition(49, 50, 1)).toBe(50);
    expect(advanceActuatorPosition(50, 0, 1)).toBeCloseTo(50 - ACTUATOR_RATED_SPEED_MM_PER_SECOND, 6);
  });

  it("reports the direction relative to the command target", () => {
    expect(actuatorMotionState(0, 0)).toBe("HOME");
    expect(actuatorMotionState(20, 50)).toBe("RAISING");
    expect(actuatorMotionState(50, 50)).toBe("RAISED");
    expect(actuatorMotionState(20, 0)).toBe("LOWERING");
  });

  it("keeps the physical and simulated celebration holds at 30 seconds", () => {
    expect(HOME_RUN_RAISED_DWELL_MS).toBe(30_000);
    expect(WIN_RAISED_DWELL_MS).toBe(30_000);
  });
});
