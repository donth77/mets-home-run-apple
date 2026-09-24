import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { SceneRenderQuality } from "./sceneRendering";
import { type StadiumCelebrationKind, stadiumCelebrationKind } from "./stadiumCelebration";
import {
  drawCelebrationScoreboard,
  drawOffseasonScoreboard,
  drawStadiumScoreboard,
  loadTeamLogo,
} from "./stadiumVideoBoardDrawing";
import { stadiumVideoBoardTextureSettings } from "./stadiumVideoBoardTexture";
import type { StadiumScoreboardData } from "./types";

interface CelebrationPaint {
  context: CanvasRenderingContext2D;
  kind: StadiumCelebrationKind;
  startedAt: number;
  lastPaintedAt: number;
}

export function StadiumVideoBoard({
  data,
  quality,
  reducedMotion,
}: {
  data: StadiumScoreboardData;
  quality: SceneRenderQuality;
  reducedMotion: boolean;
}) {
  const desktopHeaderRightInset = useThree((state) => (state.size.width > 690 ? 300 : 44));
  const latestData = useRef(data);
  latestData.current = data;
  const texture = useMemo(() => {
    const settings = stadiumVideoBoardTextureSettings(quality);
    const canvas = document.createElement("canvas");
    canvas.width = settings.width;
    canvas.height = settings.height;
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    result.anisotropy = settings.anisotropy;
    return result;
  }, [quality]);

  const celebrationKind = stadiumCelebrationKind(data.label);
  const offseason = data.label.trim().toUpperCase() === "OFFSEASON";
  useEffect(() => {
    if (celebrationKind || offseason) return;
    const context = texture.image.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) return;
    let active = true;
    drawStadiumScoreboard(context, data, null, null, desktopHeaderRightInset);
    texture.needsUpdate = true;
    Promise.all([loadTeamLogo(data.away.id), loadTeamLogo(data.home.id)]).then(([awayLogo, homeLogo]) => {
      if (!active) return;
      drawStadiumScoreboard(context, data, awayLogo, homeLogo, desktopHeaderRightInset);
      texture.needsUpdate = true;
    });
    return () => {
      active = false;
    };
  }, [celebrationKind, data, desktopHeaderRightInset, offseason, texture]);

  useEffect(() => {
    if (!offseason) return;
    const context = texture.image.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) return;
    drawOffseasonScoreboard(context);
    texture.needsUpdate = true;
  }, [offseason, texture]);

  // The celebration animates on the scene's own frames, so it keeps moving
  // wherever the scene is drawn, the Mini Apple window included.
  const celebrationPaint = useRef<CelebrationPaint | undefined>(undefined);
  useEffect(() => {
    if (!celebrationKind) return;
    const context = texture.image.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) return;

    const startedAt = performance.now();
    drawCelebrationScoreboard(context, latestData.current, 0, reducedMotion, celebrationKind);
    texture.needsUpdate = true;
    if (reducedMotion) return;
    celebrationPaint.current = { context, kind: celebrationKind, startedAt, lastPaintedAt: startedAt };
    return () => {
      celebrationPaint.current = undefined;
    };
  }, [celebrationKind, reducedMotion, texture]);

  useFrame(() => {
    const paint = celebrationPaint.current;
    const now = performance.now();
    if (!paint || now - paint.lastPaintedAt < 40) return;
    drawCelebrationScoreboard(paint.context, latestData.current, now - paint.startedAt, false, paint.kind);
    texture.needsUpdate = true;
    paint.lastPaintedAt = now;
  });

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
