/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSharedAppleStageHost, moveSharedAppleStage, STAGE_SETTLE_TIMEOUT_MS } from "./SharedAppleStage";

const SETTLING = "shared-apple-stage-host--settling";

function stageWithCanvas() {
  const host = createSharedAppleStageHost(document);
  const stage = document.createElement("div");
  stage.className = "apple-stage";
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 900;
  stage.append(canvas);
  host.append(stage);
  return { host, canvas };
}

function slot() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

/** Runs the animation frames the reveal waits for. */
async function frames(count: number) {
  for (let i = 0; i < count; i += 1) {
    await vi.advanceTimersByTimeAsync(16);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  let frame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame += 1;
    setTimeout(() => callback(performance.now()), 16);
    return frame;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("moving the shared stage between windows", () => {
  it("veils the stage on arrival and reveals it two frames after the canvas takes its new size", async () => {
    const { host, canvas } = stageWithCanvas();
    const target = slot();

    moveSharedAppleStage(host, target);

    expect(host.parentElement).toBe(target);
    expect(host.classList.contains(SETTLING)).toBe(true);

    canvas.width = 420;
    await vi.advanceTimersByTimeAsync(0); // the mutation observer reports
    expect(host.classList.contains(SETTLING)).toBe(true);
    await frames(1);
    expect(host.classList.contains(SETTLING)).toBe(true);
    await frames(1);
    expect(host.classList.contains(SETTLING)).toBe(false);
  });

  it("reveals the stage anyway if its size never changes", async () => {
    const { host } = stageWithCanvas();
    moveSharedAppleStage(host, slot());
    expect(host.classList.contains(SETTLING)).toBe(true);

    await vi.advanceTimersByTimeAsync(STAGE_SETTLE_TIMEOUT_MS);
    await frames(2);

    expect(host.classList.contains(SETTLING)).toBe(false);
  });

  it("leaves a stage alone when it is already where it belongs", () => {
    const { host } = stageWithCanvas();
    const target = slot();
    target.append(host);

    moveSharedAppleStage(host, target);

    expect(host.classList.contains(SETTLING)).toBe(false);
  });

  it("does not veil a stage that has no canvas yet", () => {
    const host = createSharedAppleStageHost(document);
    moveSharedAppleStage(host, slot());
    expect(host.classList.contains(SETTLING)).toBe(false);
  });
});
