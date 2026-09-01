import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEVICE_DISPLAY_HEIGHT,
  DEVICE_DISPLAY_WIDTH,
  DeviceCelebrationRenderer,
  rgb565ToRgba,
} from "@apple/device-display-wasm";
import {
  toDeviceDisplayState,
  type AppleCoreEvent,
  type GameSnapshot,
  type PresentationSnapshot,
} from "@apple/protocol";
import {
  describeDeviceDisplay,
  drawDeviceDisplayFrame,
  PHYSICAL_DISPLAY_HEIGHT,
  PHYSICAL_DISPLAY_WIDTH,
} from "./physicalDisplayCanvas";

interface PhysicalOutputPreviewProps {
  snapshot: PresentationSnapshot;
  celebration?: AppleCoreEvent;
  celebrationElapsedMs: number;
  elapsedMs: number;
  motionState: string;
}

function underlyingSnapshot(snapshot: PresentationSnapshot, celebration?: AppleCoreEvent): GameSnapshot {
  return {
    ...snapshot,
    phase:
      celebration?.celebration === "METS_WIN" ? "FINAL" : snapshot.phase === "CELEBRATION" ? "LIVE" : snapshot.phase,
  };
}

export function PhysicalOutputPreview({
  snapshot,
  celebration,
  celebrationElapsedMs,
  elapsedMs,
  motionState,
}: PhysicalOutputPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DeviceCelebrationRenderer | undefined>(undefined);
  const activeCelebrationKey = useRef<string | undefined>(undefined);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererError, setRendererError] = useState<string>();
  const displayState = useMemo(
    () => toDeviceDisplayState(underlyingSnapshot(snapshot, celebration)),
    [celebration, snapshot],
  );

  useEffect(() => {
    let cancelled = false;
    void DeviceCelebrationRenderer.create()
      .then((renderer) => {
        if (cancelled) {
          renderer.dispose();
          return;
        }
        rendererRef.current = renderer;
        setRendererReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setRendererError(error instanceof Error ? error.message : "Display renderer failed to load");
      });
    return () => {
      cancelled = true;
      rendererRef.current?.dispose();
      rendererRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!rendererReady) return;
    const renderer = rendererRef.current;
    if (!renderer || !celebration || activeCelebrationKey.current === celebration.eventKey) return;
    if (celebration.celebration === "METS_WIN") {
      renderer.beginMetsWin(
        {
          away: snapshot.away.abbreviation,
          awayRuns: snapshot.away.runs,
          home: snapshot.home.abbreviation,
          homeRuns: snapshot.home.runs,
          metsHome: snapshot.home.id === 121 || snapshot.home.abbreviation === "NYM",
        },
        7,
      );
    } else {
      renderer.beginHomeRun(celebration.subject, {
        grandSlam: celebration.celebration === "GRAND_SLAM",
        seed: 7,
      });
    }
    activeCelebrationKey.current = celebration.eventKey;
  }, [celebration, rendererReady, snapshot.away, snapshot.home]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.imageSmoothingEnabled = false;
    if (!rendererReady) {
      drawDeviceDisplayFrame(context, displayState, elapsedMs);
      return;
    }
    const renderer = rendererRef.current;
    if (celebration && renderer && activeCelebrationKey.current === celebration.eventKey) {
      const rgba = rgb565ToRgba(renderer.renderRgb565(celebrationElapsedMs));
      context.putImageData(
        new ImageData(new Uint8ClampedArray(rgba), DEVICE_DISPLAY_WIDTH, DEVICE_DISPLAY_HEIGHT),
        0,
        0,
      );
      return;
    }
    drawDeviceDisplayFrame(context, displayState, elapsedMs);
  }, [celebration, celebrationElapsedMs, displayState, elapsedMs, rendererReady]);

  const audioLabel = !celebration
    ? "Silent"
    : celebration.celebration === "METS_WIN"
      ? "Victory track slot"
      : "Random home-run track slot";
  const lightLabel = celebration ? "Celebration pattern" : "Off";
  const displayLabel = celebration
    ? `${celebration.celebration.replaceAll("_", " ")} animation · C++ renderer`
    : `${displayState.kind.replaceAll("_", " ")} screen`;

  return (
    <section className="physical-output-preview" aria-labelledby="physical-output-title">
      <div className="physical-output-heading">
        <div>
          <span>Physical outputs</span>
          <strong id="physical-output-title">Nano display, sound, lights, and motion</strong>
        </div>
        <small>
          {rendererError
            ? "Animation renderer unavailable"
            : rendererReady
              ? "C++ animation renderer ready"
              : "Loading C++ renderer…"}
        </small>
      </div>
      <div className="physical-output-body">
        <div className="physical-screen-shell">
          <canvas
            ref={canvasRef}
            width={PHYSICAL_DISPLAY_WIDTH}
            height={PHYSICAL_DISPLAY_HEIGHT}
            role="img"
            aria-label={
              celebration
                ? `${celebration.celebration} display animation for ${celebration.subject}`
                : describeDeviceDisplay(displayState)
            }
          />
          <span>320 × 240 · Waveshare 2-inch IPS</span>
        </div>
        <dl className="physical-output-signals">
          <div>
            <dt>Display</dt>
            <dd>{displayLabel}</dd>
          </div>
          <div>
            <dt>Speaker</dt>
            <dd>{audioLabel}</dd>
          </div>
          <div>
            <dt>LEDs</dt>
            <dd>{lightLabel}</dd>
          </div>
          <div>
            <dt>Lift</dt>
            <dd>{motionState}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
