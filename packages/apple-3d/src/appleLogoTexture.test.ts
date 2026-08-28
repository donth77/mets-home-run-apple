import { LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, Texture } from "three";
import { describe, expect, it } from "vitest";
import { APPLE_LOGO_TEXTURE_ANISOTROPY, prioritizeAppleLogoTexture } from "./appleLogoTexture";

describe("apple logo texture", () => {
  it("keeps high-quality filtering in the simplified scene", () => {
    const texture = new Texture();
    const initialVersion = texture.version;
    prioritizeAppleLogoTexture(texture);

    expect(texture.anisotropy).toBe(APPLE_LOGO_TEXTURE_ANISOTROPY);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.magFilter).toBe(LinearFilter);
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
    expect(texture.version).toBeGreaterThan(initialVersion);
  });
});
