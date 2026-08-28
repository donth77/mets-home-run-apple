import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { AppleAssembly } from "./AppleAssembly";
import { LabEnvironment } from "./LabEnvironment";
import { OutfieldEnvironment } from "./OutfieldEnvironment";
import {
  beginSceneStartup,
  completeSceneStartup,
  SCENE_RENDER_SETTINGS,
  SCENE_STABLE_AFTER_MS,
  SCENE_STARTUP_TIMEOUT_MS,
  type SceneRenderQuality,
  sceneRenderQuality,
  sceneStartupPageId,
  shouldBypassUnstableScene,
} from "./sceneRendering";
import type { AppleStageProps } from "./types";

const PAGE_SCENE_STARTUP_ID = sceneStartupPageId(
  typeof window === "undefined" ? undefined : (window as unknown as Record<string, unknown>),
);

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

function browserStorage() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function SceneReadySignal({ onReady }: { onReady: () => void }) {
  const signaled = useRef(false);
  useFrame(() => {
    if (signaled.current) return;
    signaled.current = true;
    onReady();
  });
  return null;
}

function RendererLifecycle({ onFailure }: { onFailure: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    return () => canvas.removeEventListener("webglcontextlost", handleContextLost);
  }, [gl, onFailure]);
  return null;
}

class SceneCanvasErrorBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
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
  const [startupAttempt] = useState(() => (outfield ? beginSceneStartup(browserStorage(), PAGE_SCENE_STARTUP_ID) : 1));
  const [assetsReady, setAssetsReady] = useState(false);
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const [rendererUnavailable, setRendererUnavailable] = useState(
    () => outfield && shouldBypassUnstableScene(startupAttempt),
  );
  const failedRendererAttempt = useRef<number | undefined>(undefined);
  const renderQuality: SceneRenderQuality = sceneRenderQuality(startupAttempt, rendererAttempt);
  const renderSettings = SCENE_RENDER_SETTINGS[renderQuality];
  const stageSettled = assetsReady || rendererUnavailable;
  const handleAssetsReady = useCallback(() => {
    if (!rendererUnavailable) setAssetsReady(true);
  }, [rendererUnavailable]);
  const handleRendererFailure = useCallback(() => {
    if (rendererUnavailable || failedRendererAttempt.current === rendererAttempt) return;
    failedRendererAttempt.current = rendererAttempt;
    setAssetsReady(false);
    if (rendererAttempt === 0) {
      setRendererAttempt(1);
    } else {
      setRendererUnavailable(true);
    }
  }, [rendererAttempt, rendererUnavailable]);
  const retryRenderer = useCallback(() => {
    completeSceneStartup(browserStorage(), PAGE_SCENE_STARTUP_ID);
    beginSceneStartup(browserStorage(), PAGE_SCENE_STARTUP_ID);
    failedRendererAttempt.current = undefined;
    setAssetsReady(false);
    setRendererUnavailable(false);
    setRendererAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    onReadyChange?.(stageSettled);
  }, [onReadyChange, stageSettled]);

  useEffect(() => {
    if (!outfield || typeof window === "undefined") return;
    const handlePageHide = () => completeSceneStartup(browserStorage(), PAGE_SCENE_STARTUP_ID);
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [outfield]);

  useEffect(() => {
    if (assetsReady || rendererUnavailable || typeof window === "undefined") return;
    const startupTimer = window.setTimeout(handleRendererFailure, SCENE_STARTUP_TIMEOUT_MS);
    return () => window.clearTimeout(startupTimer);
  }, [assetsReady, handleRendererFailure, rendererUnavailable]);

  useEffect(() => {
    if (!outfield || !assetsReady || rendererUnavailable || typeof window === "undefined") return;
    const stableTimer = window.setTimeout(
      () => completeSceneStartup(browserStorage(), PAGE_SCENE_STARTUP_ID),
      SCENE_STABLE_AFTER_MS,
    );
    return () => window.clearTimeout(stableTimer);
  }, [assetsReady, outfield, rendererUnavailable]);

  return (
    <div
      className={`apple-stage apple-stage--${mode} ${className}`.trim()}
      aria-busy={!stageSettled}
      data-render-quality={renderQuality}
      data-renderer-status={rendererUnavailable ? "unavailable" : assetsReady ? "ready" : "loading"}
    >
      {!stageSettled && <LoadingApple mode={mode} />}
      <div
        className="apple-stage__visual"
        data-weather={outfield ? weather.toLowerCase() : undefined}
        role="img"
        aria-label={
          outfield
            ? "Virtual Home Run Apple behind the center-field wall"
            : "Dimensioned Home Run Apple motion test bay"
        }
        aria-hidden={rendererUnavailable || undefined}
      >
        {!rendererUnavailable && (
          <SceneCanvasErrorBoundary key={rendererAttempt} onFailure={handleRendererFailure}>
            <Canvas
              key={rendererAttempt}
              shadows={renderSettings.shadows}
              dpr={renderSettings.dpr}
              resize={renderQuality === "conservative" ? { debounce: { resize: 120, scroll: 80 } } : undefined}
              camera={
                outfield
                  ? { position: [0, 4.85, 14.25], fov: 38, near: 0.1, far: 90 }
                  : { position: [5.5, 4.1, 6.9], fov: 39, near: 0.1, far: 40 }
              }
              gl={{
                antialias: renderSettings.antialias,
                alpha: false,
                powerPreference: renderSettings.powerPreference,
                stencil: false,
              }}
            >
              <RendererLifecycle onFailure={handleRendererFailure} />
              <CameraTarget mode={mode} />
              {outfield ? (
                <OutfieldEnvironment
                  quality={renderQuality}
                  reducedMotion={reducedMotion}
                  scoreboardData={scoreboardData}
                  weather={weather}
                />
              ) : (
                <LabEnvironment />
              )}
              <Suspense fallback={null}>
                <group position={outfield ? [0, 1.82, -6.72] : [0, 0.22, 0]}>
                  <AppleAssembly
                    positionMm={positionMm}
                    wireframe={wireframe}
                    showDimensions={showDimensions}
                    sceneScale={outfield ? sceneScale * 0.95 : sceneScale}
                  />
                </group>
                <SceneReadySignal onReady={handleAssetsReady} />
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
          </SceneCanvasErrorBoundary>
        )}
      </div>
      {rendererUnavailable && (
        <section className="apple-stage__unavailable" aria-label="Virtual Apple scene fallback">
          <strong>3D scene unavailable</strong>
          <span>Live game information is still available.</span>
          <button type="button" onClick={retryRenderer}>
            Retry 3D
          </button>
        </section>
      )}
      <span className="apple-stage__fallback">Interactive 3D Apple preview</span>
    </div>
  );
}
