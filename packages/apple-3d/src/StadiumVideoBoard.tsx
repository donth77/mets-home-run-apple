import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { stadiumCelebrationKind } from "./stadiumCelebration";
import {
  drawCelebrationScoreboard,
  drawOffseasonScoreboard,
  drawStadiumScoreboard,
  loadTeamLogo,
} from "./stadiumVideoBoardDrawing";
import type { StadiumScoreboardData } from "./types";

export function StadiumVideoBoard({ data, reducedMotion }: { data: StadiumScoreboardData; reducedMotion: boolean }) {
  const latestData = useRef(data);
  latestData.current = data;
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 720;
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    result.anisotropy = 8;
    return result;
  }, []);

  const celebrationKind = stadiumCelebrationKind(data.label);
  const offseason = data.label.trim().toUpperCase() === "OFFSEASON";
  useEffect(() => {
    if (celebrationKind || offseason) return;
    const context = texture.image.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) return;
    let active = true;
    drawStadiumScoreboard(context, data, null, null);
    texture.needsUpdate = true;
    Promise.all([loadTeamLogo(data.away.id), loadTeamLogo(data.home.id)]).then(([awayLogo, homeLogo]) => {
      if (!active) return;
      drawStadiumScoreboard(context, data, awayLogo, homeLogo);
      texture.needsUpdate = true;
    });
    return () => {
      active = false;
    };
  }, [celebrationKind, data, offseason, texture]);

  useEffect(() => {
    if (!offseason) return;
    const context = texture.image.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) return;
    drawOffseasonScoreboard(context);
    texture.needsUpdate = true;
  }, [offseason, texture]);

  useEffect(() => {
    if (!celebrationKind) return;
    const context = texture.image.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) return;

    const startedAt = performance.now();
    let animationFrame = 0;
    let lastPaintedAt = -Infinity;
    const paint = (now: number) => {
      if (now - lastPaintedAt >= 40 || reducedMotion) {
        drawCelebrationScoreboard(context, latestData.current, now - startedAt, reducedMotion, celebrationKind);
        texture.needsUpdate = true;
        lastPaintedAt = now;
      }
      if (!reducedMotion) animationFrame = requestAnimationFrame(paint);
    };
    paint(startedAt);
    return () => cancelAnimationFrame(animationFrame);
  }, [celebrationKind, reducedMotion, texture]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group position={[0, 6.65, -8.105]}>
      <mesh position={[0, 0, -0.02]} castShadow>
        <boxGeometry args={[11.55, 5.85, 0.15]} />
        <meshStandardMaterial color="#050b10" metalness={0.5} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <planeGeometry args={[11.2, 5.04]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
