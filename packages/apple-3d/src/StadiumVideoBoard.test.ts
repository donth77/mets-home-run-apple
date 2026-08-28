import { describe, expect, it } from "vitest";
import { stadiumVideoBoardTextureSettings } from "./stadiumVideoBoardTexture";

describe("stadium video board texture", () => {
  it("keeps the full logical layout size in conservative rendering", () => {
    expect(stadiumVideoBoardTextureSettings("conservative")).toEqual({
      anisotropy: 2,
      height: 720,
      width: 1600,
    });
    expect(stadiumVideoBoardTextureSettings("full")).toEqual({
      anisotropy: 8,
      height: 720,
      width: 1600,
    });
  });
});
