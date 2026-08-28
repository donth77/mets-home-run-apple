import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import type { SceneRenderQuality } from "./sceneRendering";

function seededNoise(seed: number) {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

export function canvasTexture(
  width: number,
  height: number,
  repeat: [number, number],
  paint: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  anisotropy = 8,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  paint(context, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = anisotropy;
  return texture;
}

export function createOutfieldTextures(quality: SceneRenderQuality = "full") {
  const conservative = quality === "conservative";
  const anisotropy = conservative ? 2 : 8;
  const textureSize = conservative ? 512 : 1024;
  const grassMarks = conservative ? 3200 : 10500;
  const trackGrains = conservative ? 3200 : 9400;
  const concreteFlecks = conservative ? 700 : 1800;
  const grass = canvasTexture(
    textureSize,
    textureSize,
    [5, 4],
    (context, width, height) => {
      const turfGradient = context.createLinearGradient(0, 0, width, height);
      turfGradient.addColorStop(0, "#2b7546");
      turfGradient.addColorStop(0.5, "#3b8750");
      turfGradient.addColorStop(1, "#286d41");
      context.fillStyle = turfGradient;
      context.fillRect(0, 0, width, height);
      for (let stripe = -8; stripe < 16; stripe += 1) {
        context.save();
        context.translate((stripe * width) / 8, 0);
        context.rotate(-0.12);
        context.fillStyle = stripe % 2 === 0 ? "rgba(157, 198, 119, .09)" : "rgba(16, 73, 43, .06)";
        context.fillRect(0, -height * 0.2, width / 8, height * 1.4);
        context.restore();
      }
      for (let mark = 0; mark < grassMarks; mark += 1) {
        const x = seededNoise(mark + 10) * width;
        const y = seededNoise(mark + 1600) * height;
        const light = seededNoise(mark + 3200) > 0.5;
        context.strokeStyle = light ? "rgba(184, 211, 139, .13)" : "rgba(18, 83, 48, .11)";
        context.lineWidth = 0.7 + seededNoise(mark + 5100) * 0.8;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + (seededNoise(mark + 7300) - 0.5) * 2, y - 3 - seededNoise(mark + 5000) * 7);
        context.stroke();
      }
    },
    anisotropy,
  );

  const track = canvasTexture(
    textureSize,
    textureSize,
    [7, 2],
    (context, width, height) => {
      const clayGradient = context.createLinearGradient(0, 0, 0, height);
      clayGradient.addColorStop(0, "#a86648");
      clayGradient.addColorStop(0.55, "#8c4e38");
      clayGradient.addColorStop(1, "#a45f43");
      context.fillStyle = clayGradient;
      context.fillRect(0, 0, width, height);
      for (let grain = 0; grain < trackGrains; grain += 1) {
        const shade = Math.round(74 + seededNoise(grain + 90) * 118);
        context.fillStyle = `rgba(${shade}, ${Math.round(shade * 0.62)}, ${Math.round(shade * 0.44)}, ${0.18 + seededNoise(grain + 1700) * 0.2})`;
        const size = 0.8 + seededNoise(grain + 900) * 3.4;
        context.fillRect(seededNoise(grain) * width, seededNoise(grain + 400) * height, size, size);
      }
      context.strokeStyle = "rgba(84, 42, 30, .16)";
      context.lineWidth = 2;
      for (let rake = 0; rake < 44; rake += 1) {
        const y = (rake / 44) * height + seededNoise(rake + 50) * 7;
        context.beginPath();
        context.moveTo(0, y);
        context.bezierCurveTo(width * 0.3, y - 7, width * 0.7, y + 8, width, y - 2);
        context.stroke();
      }
      for (let divot = 0; divot < 90; divot += 1) {
        const x = seededNoise(divot + 3600) * width;
        const y = seededNoise(divot + 4700) * height;
        context.fillStyle = "rgba(60, 30, 23, .12)";
        context.beginPath();
        context.ellipse(
          x,
          y,
          4 + seededNoise(divot) * 9,
          1.5 + seededNoise(divot + 700) * 4,
          seededNoise(divot + 900) * Math.PI,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    },
    anisotropy,
  );

  const wall = canvasTexture(
    conservative ? 1024 : 2048,
    conservative ? 128 : 256,
    [1, 1],
    (context, width, height) => {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#193968");
      gradient.addColorStop(0.72, "#12305c");
      gradient.addColorStop(1, "#0b2549");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      const panelWidth = width / 17;
      for (let panel = 0; panel < 17; panel += 1) {
        const x = panel * panelWidth;
        if (panel % 2 === 0) {
          context.fillStyle = "rgba(255, 255, 255, .012)";
          context.fillRect(x, 0, panelWidth, height);
        }
        if (panel > 0) {
          context.fillStyle = "rgba(2, 14, 34, .28)";
          context.fillRect(x - 1, 0, 2, height);
          context.fillStyle = "rgba(129, 157, 207, .045)";
          context.fillRect(x + 1, 0, 1, height);
        }
      }
      context.fillStyle = "rgba(4, 18, 31, .34)";
      context.fillRect(0, height - 7, width, 7);
      for (let scuff = 0; scuff < 72; scuff += 1) {
        context.fillStyle = `rgba(196, 214, 227, ${0.01 + seededNoise(scuff) * 0.022})`;
        context.fillRect(
          seededNoise(scuff + 200) * width,
          height * (0.58 + seededNoise(scuff + 500) * 0.37),
          16 + seededNoise(scuff + 800) * 70,
          1.5,
        );
      }
    },
    anisotropy,
  );

  const concrete = canvasTexture(
    conservative ? 256 : 512,
    conservative ? 256 : 512,
    [4, 3],
    (context, width, height) => {
      context.fillStyle = "#4a504f";
      context.fillRect(0, 0, width, height);
      for (let fleck = 0; fleck < concreteFlecks; fleck += 1) {
        const value = 64 + seededNoise(fleck) * 62;
        context.fillStyle = `rgba(${value}, ${value + 4}, ${value + 3}, .1)`;
        context.fillRect(seededNoise(fleck + 40) * width, seededNoise(fleck + 800) * height, 1.5, 1.5);
      }
    },
    anisotropy,
  );

  const louvers = canvasTexture(
    conservative ? 512 : 1024,
    conservative ? 256 : 512,
    [1, 1],
    (context, width, height) => {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#343a3a");
      gradient.addColorStop(1, "#242a2b");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      for (let x = 0; x < width; x += 19) {
        context.fillStyle = "rgba(7, 12, 13, .62)";
        context.fillRect(x, 0, 5, height);
        context.fillStyle = "rgba(133, 144, 141, .14)";
        context.fillRect(x + 5, 0, 2, height);
      }
      context.fillStyle = "rgba(5, 10, 11, .4)";
      context.fillRect(0, 0, width, 7);
      context.fillRect(0, height - 8, width, 8);
    },
    anisotropy,
  );

  return { concrete, grass, louvers, track, wall };
}
