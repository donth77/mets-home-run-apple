import { MAX_STROKE_MM } from "@apple/protocol";

export const ACTUATOR_STROKE_MM = MAX_STROKE_MM;
export const ACTUATOR_RATED_SPEED_MM_PER_SECOND = 15.24;
export const ACTUATOR_FULL_STROKE_SECONDS = ACTUATOR_STROKE_MM / ACTUATOR_RATED_SPEED_MM_PER_SECOND;
export const ACTUATOR_DIRECTION_TIMEOUT_MS = 5_000;
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
  speedMmPerSecond = ACTUATOR_RATED_SPEED_MM_PER_SECOND,
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
