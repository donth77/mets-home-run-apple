import type { SceneRenderQuality } from "./sceneRendering";

export const STADIUM_VIDEO_BOARD_WIDTH = 1600;
export const STADIUM_VIDEO_BOARD_HEIGHT = 720;

export function stadiumVideoBoardTextureSettings(quality: SceneRenderQuality) {
  return {
    anisotropy: quality === "conservative" ? 2 : 8,
    height: STADIUM_VIDEO_BOARD_HEIGHT,
    width: STADIUM_VIDEO_BOARD_WIDTH,
  };
}
