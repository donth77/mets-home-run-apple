/** @vitest-environment happy-dom */

import { useActuatorSimulation } from "@apple/apple-3d";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("actuator animation timing", () => {
  it("uses real elapsed time when animation frames are throttled", () => {
    let now = 0;
    let nextFrame: FrameRequestCallback | undefined;
    const animationWindow = {
      cancelAnimationFrame: vi.fn(),
      performance: { now: () => now },
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        nextFrame = callback;
        return 1;
      }),
    } as unknown as Pick<Window, "cancelAnimationFrame" | "performance" | "requestAnimationFrame">;

    const { result, rerender } = renderHook(({ target }) => useActuatorSimulation(target, { animationWindow }), {
      initialProps: { target: 0 },
    });
    rerender({ target: 50 });

    now = 1_000;
    act(() => nextFrame?.(now));
    expect(result.current.positionMm).toBeCloseTo(15.24, 2);

    now = 4_000;
    act(() => nextFrame?.(now));
    expect(result.current.positionMm).toBe(50);
  });
});
