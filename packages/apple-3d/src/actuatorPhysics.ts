import { MAX_STROKE_MM } from "@apple/protocol";

export const ACTUATOR_STROKE_MM = MAX_STROKE_MM;
/** Datasheet figure for the 12 V actuator at full supply voltage with no driver drop. */
export const ACTUATOR_RATED_SPEED_MM_PER_SECOND = 15.24;
/** Bench measurement on 2026-09-01: 50 mm in about 5.1 s through the L298N from an 11 V pack. */
export const ACTUATOR_MEASURED_FULL_STROKE_SECONDS = 5.1;
export const ACTUATOR_MEASURED_SPEED_MM_PER_SECOND = ACTUATOR_STROKE_MM / ACTUATOR_MEASURED_FULL_STROKE_SECONDS;
/** Speed the twin animates at: the measured value, so simulated timing matches the real Apple. */
export const ACTUATOR_SPEED_MM_PER_SECOND = ACTUATOR_MEASURED_SPEED_MM_PER_SECOND;
export const ACTUATOR_FULL_STROKE_SECONDS = ACTUATOR_STROKE_MM / ACTUATOR_SPEED_MM_PER_SECOND;
export const ACTUATOR_DIRECTION_TIMEOUT_MS = 10_000;
export const HOME_RUN_DISPLAY_LEAD_IN_MS = 2_000;
export const HOME_RUN_RAISED_DWELL_MS = 30_000;
export const WIN_RAISED_DWELL_MS = 30_000;

export type ActuatorMotionState = "HOME" | "RAISING" | "RAISED" | "LOWERING";

export function clampActuatorPosition(positionMm: number) {
  return Math.min(ACTUATOR_STROKE_MM, Math.max(0, positionMm));
}

export function advanceActuatorPosition(
  currentMm: number,
  targetMm: number,
  elapsedSeconds: number,
  speedMmPerSecond = ACTUATOR_SPEED_MM_PER_SECOND,
) {
  const current = clampActuatorPosition(currentMm);
  const target = clampActuatorPosition(targetMm);
  const maximumStep = Math.max(0, elapsedSeconds) * Math.max(0, speedMmPerSecond);
  const difference = target - current;

  if (Math.abs(difference) <= maximumStep) return target;
  return current + Math.sign(difference) * maximumStep;
}

export function actuatorMotionState(currentMm: number, targetMm: number): ActuatorMotionState {
  const current = clampActuatorPosition(currentMm);
  const target = clampActuatorPosition(targetMm);
  if (target > current) return "RAISING";
  if (target < current) return "LOWERING";
  return current === 0 ? "HOME" : "RAISED";
}
