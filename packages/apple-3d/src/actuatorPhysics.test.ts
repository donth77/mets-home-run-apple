import { describe, expect, it } from "vitest";
import {
  ACTUATOR_FULL_STROKE_SECONDS,
  ACTUATOR_MEASURED_FULL_STROKE_SECONDS,
  ACTUATOR_RATED_SPEED_MM_PER_SECOND,
  ACTUATOR_SPEED_MM_PER_SECOND,
  HOME_RUN_RAISED_DWELL_MS,
  WIN_RAISED_DWELL_MS,
  actuatorMotionState,
  advanceActuatorPosition,
} from "./actuatorPhysics";

describe("actuator physics", () => {
  it("takes the measured bench time to traverse the 50 mm stroke", () => {
    expect(ACTUATOR_FULL_STROKE_SECONDS).toBe(ACTUATOR_MEASURED_FULL_STROKE_SECONDS);
    expect(ACTUATOR_FULL_STROKE_SECONDS).toBeCloseTo(5.1, 3);
    expect(ACTUATOR_SPEED_MM_PER_SECOND).toBeLessThan(ACTUATOR_RATED_SPEED_MM_PER_SECOND);
    expect(advanceActuatorPosition(0, 50, ACTUATOR_FULL_STROKE_SECONDS)).toBeCloseTo(50, 6);
  });

  it("advances at the measured speed without overshooting", () => {
    expect(advanceActuatorPosition(0, 50, 1)).toBeCloseTo(ACTUATOR_SPEED_MM_PER_SECOND, 6);
    expect(advanceActuatorPosition(49, 50, 1)).toBe(50);
    expect(advanceActuatorPosition(50, 0, 1)).toBeCloseTo(50 - ACTUATOR_SPEED_MM_PER_SECOND, 6);
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
