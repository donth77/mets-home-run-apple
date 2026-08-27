import { Suspense, useCallback, useEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { PerspectiveCamera, Vector3 } from "three";
import { AppleAssembly } from "./AppleAssembly";
import { APPLE_MODEL_URL, CITI_BASE_MODEL_URL } from "./assets";
import { LabEnvironment } from "./LabEnvironment";
import { OutfieldEnvironment } from "./OutfieldEnvironment";
import type { AppleAssemblyProps, AppleStageProps } from "./types";

export { AppleAssembly } from "./AppleAssembly";
export type {
  AppleAssemblyProps,
  AppleStageProps,
  StadiumScoreboardData,
  StadiumScoreboardTeam,
} from "./types";

function CameraTarget({ mode }: { mode: AppleStageProps["mode"] }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const mobileOutfield = mode === "outfield" && size.width <= 690;
    if (mode === "outfield" && camera instanceof PerspectiveCamera) {
      const aspect = Math.max(size.width / Math.max(size.height, 1), 0.4);
      const minimumHorizontalFov = 34 * (Math.PI / 180);
      const portraitFov = 2 * Math.atan(Math.tan(minimumHorizontalFov / 2) / aspect) * (180 / Math.PI);
      camera.fov = mobileOutfield ? 38.5 : Math.min(58, Math.max(38, portraitFov));
      camera.updateProjectionMatrix();
    }
    camera.lookAt(mode === "lab" ? new Vector3(0, 1.22, 0) : new Vector3(0, mobileOutfield ? 3.85 : 2.75, -6.35));
  }, [camera, mode, size.height, size.width]);
  return null;
}

function LoadingApple({ mode }: { mode: AppleStageProps["mode"] }) {
  return (
    <div className={`apple-loading-overlay apple-loading-overlay--${mode}`} role="status" aria-live="polite">
      <span className="apple-loading-spinner" aria-hidden="true" />
      <strong>{mode === "outfield" ? "Preparing Citi Field" : "Loading assembly"}</strong>
      {mode === "lab" && <small>Calibrating the Apple and base models</small>}
    </div>
  );
}

function ReadyAppleAssembly({ onReady, ...props }: AppleAssemblyProps & { onReady: () => void }) {
  useEffect(() => onReady(), [onReady]);
  return <AppleAssembly {...props} />;
}

export function AppleStage({
  mode,
  positionMm,
  wireframe = false,
  reducedMotion = false,
  showDimensions = false,
  sceneScale = 1,
  weather = "CLEAR",
  scoreboardData,
  className = "",
  onReadyChange,
}: AppleStageProps) {
  const outfield = mode === "outfield";
  const [assetsReady, setAssetsReady] = useState(false);
  const handleAssetsReady = useCallback(() => setAssetsReady(true), []);

  useEffect(() => {
    onReadyChange?.(assetsReady);
  }, [assetsReady, onReadyChange]);

  return (
    <div className={`apple-stage apple-stage--${mode} ${className}`.trim()} aria-busy={!assetsReady}>
      {!assetsReady && <LoadingApple mode={mode} />}
      <div
        className="apple-stage__visual"
        data-weather={outfield ? weather.toLowerCase() : undefined}
        role="img"
        aria-label={
          outfield
            ? "Virtual Home Run Apple behind the center-field wall"
            : "Dimensioned Home Run Apple motion test bay"
        }
      >
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={
            outfield
              ? { position: [0, 4.85, 14.25], fov: 38, near: 0.1, far: 90 }
              : { position: [5.5, 4.1, 6.9], fov: 39, near: 0.1, far: 40 }
          }
          gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        >
          <CameraTarget mode={mode} />
          {outfield ? (
            <OutfieldEnvironment reducedMotion={reducedMotion} scoreboardData={scoreboardData} weather={weather} />
          ) : (
            <LabEnvironment />
          )}
          <Suspense fallback={null}>
            <group position={outfield ? [0, 1.82, -6.72] : [0, 0.22, 0]}>
              <ReadyAppleAssembly
                onReady={handleAssetsReady}
                positionMm={positionMm}
                wireframe={wireframe}
                showDimensions={showDimensions}
                sceneScale={outfield ? sceneScale * 0.95 : sceneScale}
              />
            </group>
          </Suspense>
          {!outfield && (
            <OrbitControls
              makeDefault
              minDistance={4.3}
              maxDistance={11}
              minPolarAngle={0.35}
              maxPolarAngle={1.48}
              target={[0, 1.25, 0]}
            />
          )}
        </Canvas>
      </div>
      <span className="apple-stage__fallback">Interactive 3D Apple preview</span>
    </div>
  );
}

useGLTF.preload(APPLE_MODEL_URL);
useGLTF.preload(CITI_BASE_MODEL_URL);
