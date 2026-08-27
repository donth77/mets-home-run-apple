import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTUATOR_RATED_SPEED_MM_PER_SECOND,
  actuatorMotionState,
  advanceActuatorPosition,
  clampActuatorPosition,
} from "./actuatorPhysics";

export interface ActuatorSimulationOptions {
  reducedMotion?: boolean;
  speedMmPerSecond?: number;
}

export function useActuatorSimulation(targetPositionMm: number, options: ActuatorSimulationOptions = {}) {
  const target = clampActuatorPosition(targetPositionMm);
  const targetRef = useRef(target);
  const positionRef = useRef(target);
  const [positionMm, setPositionMm] = useState(target);
  const speedMmPerSecond = options.speedMmPerSecond ?? ACTUATOR_RATED_SPEED_MM_PER_SECOND;

  useEffect(() => {
    targetRef.current = target;
    if (options.reducedMotion) {
      positionRef.current = target;
      setPositionMm(target);
      return;
    }

    let animationFrame = 0;
    let previousTime = performance.now();

    function advance(time: number) {
      const elapsedSeconds = Math.min(0.1, Math.max(0, time - previousTime) / 1000);
      previousTime = time;
      const next = advanceActuatorPosition(positionRef.current, targetRef.current, elapsedSeconds, speedMmPerSecond);
      positionRef.current = next;
      setPositionMm(next);
      if (next !== targetRef.current) animationFrame = requestAnimationFrame(advance);
    }

    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [options.reducedMotion, speedMmPerSecond, target]);

  return useMemo(
    () => ({
      positionMm,
      state: actuatorMotionState(positionMm, target),
      targetPositionMm: target,
    }),
    [positionMm, target],
  );
}
