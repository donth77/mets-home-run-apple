import { LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from "three";

export const APPLE_LOGO_TEXTURE_ANISOTROPY = 8;

export function prioritizeAppleLogoTexture(texture: Texture) {
  texture.anisotropy = APPLE_LOGO_TEXTURE_ANISOTROPY;
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
}
