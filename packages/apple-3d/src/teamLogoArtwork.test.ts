import { describe, expect, it } from "vitest";
import { prepareTeamLogoPixels, removeEmbeddedTeamLogoTrademark } from "./teamLogoArtwork";

function blankLogo() {
  return { width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4) };
}

function paint(image: ReturnType<typeof blankLogo>, x: number, y: number, width: number, height: number, alpha = 255) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      image.data.set([255, 89, 16, alpha], (row * image.width + column) * 4);
    }
  }
}

function alphaAt(image: ReturnType<typeof blankLogo>, x: number, y: number) {
  return image.data[(y * image.width + x) * 4 + 3];
}

describe("prepareTeamLogoPixels", () => {
  it("removes both trademark letters and translucent edges from a narrow padded logo", () => {
    const image = blankLogo();
    paint(image, 80, 10, 65, 236);
    paint(image, 153, 151, 6, 12, 12);
    paint(image, 154, 152, 4, 10);
    paint(image, 163, 152, 7, 10);

    const offset = prepareTeamLogoPixels(image);

    expect(alphaAt(image, 153, 151)).toBe(0);
    expect(alphaAt(image, 154, 152)).toBe(0);
    expect(alphaAt(image, 163, 152)).toBe(0);
    expect(alphaAt(image, 80, 10)).toBe(255);
    const leftPadding = 80 + offset.x;
    const rightPadding = image.width - 1 - (144 + offset.x);
    expect(Math.abs(leftPadding - rightPadding)).toBeLessThanOrEqual(1);
    expect(offset.y).toBe(0);
  });

  it("removes a mark below the middle of the logo, away from the canvas edge", () => {
    const image = blankLogo();
    paint(image, 44, 10, 30, 236);
    paint(image, 74, 10, 138, 100);
    paint(image, 98, 236, 20, 10);

    prepareTeamLogoPixels(image);

    expect(alphaAt(image, 98, 236)).toBe(0);
    expect(alphaAt(image, 44, 245)).toBe(255);
    expect(alphaAt(image, 211, 109)).toBe(255);
  });

  it("preserves detached letters, punctuation, colors, and antialiasing", () => {
    const image = blankLogo();
    paint(image, 20, 20, 40, 200);
    paint(image, 70, 25, 3, 8);
    paint(image, 80, 90, 90, 100);
    paint(image, 79, 90, 1, 100, 12);
    const original = image.data.slice();

    prepareTeamLogoPixels(image);

    expect(image.data).toEqual(original);
  });

  it("centers visible bounds in both directions without changing scale", () => {
    const image = blankLogo();
    paint(image, 10, 30, 180, 140);
    const original = image.data.slice();

    const offset = prepareTeamLogoPixels(image);

    expect(offset).toEqual({ x: 28, y: 28 });
    expect(image.data).toEqual(original);
  });

  it("handles empty artwork and retains a lone small mark", () => {
    const image = blankLogo();
    expect(prepareTeamLogoPixels(image)).toEqual({ x: 0, y: 0 });
    paint(image, 200, 200, 4, 4);
    prepareTeamLogoPixels(image);
    expect(alphaAt(image, 200, 200)).toBe(255);
  });
});

describe("removeEmbeddedTeamLogoTrademark", () => {
  it("removes the known Cubs trademark path while preserving its background and lettering", () => {
    const disc = '<path d="M0 116.787C0 52.29 52.284 0 116.77 0" fill="#FFF"/>';
    const lettering = '<path d="M104.254 123.345V97.69h12.71" fill="#CC3433"/>';
    const trademark = '<path d="M174.54 141.79h-2.162v5.916h-1.47v-5.917" fill="#0E3386"/>';
    const source = `<svg>${disc}${lettering}<g>${trademark}</g></svg>`;

    expect(removeEmbeddedTeamLogoTrademark(source, 112)).toBe(`<svg>${disc}${lettering}<g></g></svg>`);
    expect(removeEmbeddedTeamLogoTrademark(source, 121)).toBe(source);
    expect(removeEmbeddedTeamLogoTrademark(`<svg>${disc}${lettering}</svg>`, 112)).toBe(
      `<svg>${disc}${lettering}</svg>`,
    );
  });
});
