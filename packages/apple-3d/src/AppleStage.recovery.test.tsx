/** @vitest-environment happy-dom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppleStage } from "./AppleStage";
import { SCENE_STARTUP_STORAGE_KEY, SCENE_STARTUP_TIMEOUT_MS } from "./sceneRendering";

const rendererState = vi.hoisted(() => ({
  canvas: undefined as HTMLCanvasElement | undefined,
  renderFrame: true,
}));

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  const { PerspectiveCamera } = await import("three");
  const camera = new PerspectiveCamera();
  return {
    Canvas: ({
      children,
      dpr,
      shadows,
    }: {
      children: React.ReactNode;
      dpr: number | [number, number];
      shadows: boolean | string;
    }) => (
      <div data-testid="renderer" data-dpr={JSON.stringify(dpr)} data-shadows={String(shadows)}>
        {children}
      </div>
    ),
    useFrame: (callback: () => void) => {
      React.useEffect(() => {
        if (rendererState.renderFrame) callback();
      }, [callback]);
    },
    useThree: () => ({
      camera,
      gl: { domElement: rendererState.canvas ?? document.createElement("canvas") },
      size: { height: 915, width: 412 },
    }),
  };
});

vi.mock("@react-three/drei", () => {
  const useGLTF = Object.assign(vi.fn(), { preload: vi.fn() });
  return { OrbitControls: () => null, useGLTF };
});

vi.mock("./AppleAssembly", () => ({ AppleAssembly: () => <div data-testid="apple-assembly" /> }));
vi.mock("./LabEnvironment", () => ({ LabEnvironment: () => null }));
vi.mock("./OutfieldEnvironment", () => ({ OutfieldEnvironment: () => <div data-testid="outfield" /> }));

let container: HTMLDivElement;
let root: Root;
let originalInnerWidth: number;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  originalInnerWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 412 });
  window.sessionStorage.clear();
  rendererState.canvas = document.createElement("canvas");
  rendererState.renderFrame = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  window.sessionStorage.clear();
  rendererState.canvas = undefined;
  rendererState.renderFrame = true;
  vi.useRealTimers();
});

describe("AppleStage mobile renderer recovery", () => {
  it("does not count a clean page reload as a renderer crash", async () => {
    await act(async () => {
      root.render(<AppleStage mode="outfield" positionMm={0} />);
    });

    expect(window.sessionStorage.getItem(SCENE_STARTUP_STORAGE_KEY)).not.toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(window.sessionStorage.getItem(SCENE_STARTUP_STORAGE_KEY)).toBeNull();
  });

  it("starts standard on a phone and automatically retries simplified after context loss", async () => {
    const onReadyChange = vi.fn();
    await act(async () => {
      root.render(<AppleStage mode="outfield" positionMm={0} onReadyChange={onReadyChange} />);
    });

    const stage = container.querySelector(".apple-stage");
    expect(stage?.getAttribute("data-render-quality")).toBe("full");
    expect(stage?.getAttribute("data-renderer-status")).toBe("ready");
    expect(container.querySelector('[data-testid="renderer"]')?.getAttribute("data-dpr")).toBe("[1,1.75]");
    expect(container.querySelector(".apple-loading-overlay")).toBeNull();

    await act(async () => {
      rendererState.canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(stage?.getAttribute("data-render-quality")).toBe("conservative");
    expect(stage?.getAttribute("data-renderer-status")).toBe("ready");
    expect(container.querySelector('[data-testid="renderer"]')?.getAttribute("data-dpr")).toBe("1");
    expect(container.querySelector(".apple-stage__unavailable")).toBeNull();

    await act(async () => {
      rendererState.canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(stage?.getAttribute("data-renderer-status")).toBe("unavailable");
    expect(container.querySelector(".apple-loading-overlay")).toBeNull();
    expect(container.querySelector(".apple-stage__unavailable")?.textContent).toContain("Live game information");
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
  });

  it("settles into the fallback when the renderer never produces a frame", async () => {
    vi.useFakeTimers();
    rendererState.renderFrame = false;
    const onReadyChange = vi.fn();
    await act(async () => {
      root.render(<AppleStage mode="outfield" positionMm={0} onReadyChange={onReadyChange} />);
    });

    expect(container.querySelector(".apple-loading-overlay")).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(SCENE_STARTUP_TIMEOUT_MS);
    });
    expect(container.querySelector(".apple-stage")?.getAttribute("data-render-quality")).toBe("conservative");
    expect(container.querySelector(".apple-loading-overlay")).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(SCENE_STARTUP_TIMEOUT_MS);
    });
    expect(container.querySelector(".apple-loading-overlay")).toBeNull();
    expect(container.querySelector(".apple-stage")?.getAttribute("data-renderer-status")).toBe("unavailable");
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
  });
});
