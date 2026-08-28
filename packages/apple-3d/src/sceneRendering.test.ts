import { describe, expect, it } from "vitest";
import {
  beginSceneStartup,
  completeSceneStartup,
  SCENE_RENDER_SETTINGS,
  SCENE_STARTUP_STORAGE_KEY,
  type SceneStartupStorage,
  sceneRenderQuality,
  sceneStartupPageId,
  shouldBypassUnstableScene,
} from "./sceneRendering";

function memoryStorage(): SceneStartupStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("scene rendering policy", () => {
  it("starts at full quality and only simplifies after a rendering failure", () => {
    expect(sceneRenderQuality(1, 0)).toBe("full");
    expect(sceneRenderQuality(1, 1)).toBe("conservative");
    expect(sceneRenderQuality(2, 0)).toBe("conservative");
  });

  it("removes high-cost framebuffer features in conservative mode", () => {
    expect(SCENE_RENDER_SETTINGS.conservative).toEqual({
      antialias: false,
      dpr: 1,
      powerPreference: "default",
      shadows: false,
    });
    expect(SCENE_RENDER_SETTINGS.full.dpr).toEqual([1, 1.75]);
    expect(SCENE_RENDER_SETTINGS.full.shadows).toBe("percentage");
  });

  it("counts quick page recreations but not Strict Mode initialization on the same page", () => {
    const storage = memoryStorage();
    expect(beginSceneStartup(storage, "page-1", 1_000)).toBe(1);
    expect(beginSceneStartup(storage, "page-1", 1_001)).toBe(1);
    expect(beginSceneStartup(storage, "page-2", 2_000)).toBe(2);
    expect(beginSceneStartup(storage, "page-3", 3_000)).toBe(3);
    expect(shouldBypassUnstableScene(3)).toBe(true);
  });

  it("keeps the same page identity across hot module reloads", () => {
    const pageScope: Record<string, unknown> = {};
    let createdIds = 0;
    const createId = () => `page-${++createdIds}`;

    expect(sceneStartupPageId(pageScope, createId)).toBe("page-1");
    expect(sceneStartupPageId(pageScope, createId)).toBe("page-1");
    expect(createdIds).toBe(1);
  });

  it("clears the recovery marker only for the page that became stable", () => {
    const storage = memoryStorage();
    beginSceneStartup(storage, "page-1", 1_000);
    completeSceneStartup(storage, "another-page");
    expect(storage.getItem(SCENE_STARTUP_STORAGE_KEY)).not.toBeNull();
    completeSceneStartup(storage, "page-1");
    expect(storage.getItem(SCENE_STARTUP_STORAGE_KEY)).toBeNull();
  });

  it("starts over after the retry window", () => {
    const storage = memoryStorage();
    beginSceneStartup(storage, "page-1", 1_000);
    expect(beginSceneStartup(storage, "page-2", 70_000)).toBe(1);
  });
});
