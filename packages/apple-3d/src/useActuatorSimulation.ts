import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTUATOR_SPEED_MM_PER_SECOND,
  actuatorMotionState,
  advanceActuatorPosition,
  clampActuatorPosition,
} from "./actuatorPhysics";

export interface ActuatorSimulationOptions {
  animationWindow?: Pick<Window, "cancelAnimationFrame" | "performance" | "requestAnimationFrame">;
  reducedMotion?: boolean;
  speedMmPerSecond?: number;
}

export function useActuatorSimulation(targetPositionMm: number, options: ActuatorSimulationOptions = {}) {
  const target = clampActuatorPosition(targetPositionMm);
  const targetRef = useRef(target);
  const positionRef = useRef(target);
  const [positionMm, setPositionMm] = useState(target);
  const speedMmPerSecond = options.speedMmPerSecond ?? ACTUATOR_SPEED_MM_PER_SECOND;
  const animationWindow = options.animationWindow ?? window;

  useEffect(() => {
    targetRef.current = target;
    if (options.reducedMotion) {
      positionRef.current = target;
      setPositionMm(target);
      return;
    }

    let animationFrame = 0;
    let previousTime = animationWindow.performance.now();

    function advance(time: number) {
      // Use real elapsed time. A 100 ms cap made the simulated actuator run at
      // one tenth speed when a background browser throttled animation frames,
      // which could trip the core's motion deadline in Mini Apple mode.
      const elapsedSeconds = Math.max(0, time - previousTime) / 1000;
      previousTime = time;
      const next = advanceActuatorPosition(positionRef.current, targetRef.current, elapsedSeconds, speedMmPerSecond);
      positionRef.current = next;
      setPositionMm(next);
      if (next !== targetRef.current) animationFrame = animationWindow.requestAnimationFrame(advance);
    }

    animationFrame = animationWindow.requestAnimationFrame(advance);
    return () => animationWindow.cancelAnimationFrame(animationFrame);
  }, [animationWindow, options.reducedMotion, speedMmPerSecond, target]);

  return useMemo(
    () => ({
      positionMm,
      state: actuatorMotionState(positionMm, target),
      targetPositionMm: target,
    }),
    [positionMm, target],
  );
}
