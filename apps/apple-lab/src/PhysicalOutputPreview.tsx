import {
  DEVICE_DISPLAY_HEIGHT,
  DEVICE_DISPLAY_WIDTH,
  type DeviceCardScreen,
  DeviceDisplayRenderer,
  rgb565ToRgba,
} from "@apple/device-display-wasm";
import {
  type AppleCoreEvent,
  type GameSnapshot,
  type PresentationSnapshot,
  toDeviceDisplayState,
} from "@apple/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeDeviceDisplay } from "./physicalDisplayCanvas";

interface PhysicalOutputPreviewProps {
  snapshot: PresentationSnapshot;
  celebration?: AppleCoreEvent;
  celebrationElapsedMs: number;
  elapsedMs: number;
  motionState: string;
  /** A card screen (setup, syncing, approval prompt) takes precedence over the game screen. */
  card?: DeviceCardScreen | null;
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
  card = null,
}: PhysicalOutputPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DeviceDisplayRenderer | undefined>(undefined);
  const activeCelebrationKey = useRef<string | undefined>(undefined);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererError, setRendererError] = useState<string>();
  const displayState = useMemo(
    () => toDeviceDisplayState(underlyingSnapshot(snapshot, celebration)),
    [celebration, snapshot],
  );

  useEffect(() => {
    let cancelled = false;
    void DeviceDisplayRenderer.create()
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
    if (!rendererReady) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    let frame: Uint16Array;
    if (celebration && renderer && activeCelebrationKey.current === celebration.eventKey) {
      frame = renderer.renderRgb565(celebrationElapsedMs);
    } else if (card) {
      frame = renderer.renderCardRgb565(card);
    } else {
      frame = renderer.renderScreenRgb565(displayState, elapsedMs);
    }
    const rgba = rgb565ToRgba(frame);
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), DEVICE_DISPLAY_WIDTH, DEVICE_DISPLAY_HEIGHT), 0, 0);
  }, [card, celebration, celebrationElapsedMs, displayState, elapsedMs, rendererReady]);

  const audioLabel = !celebration
    ? "Silent"
    : celebration.celebration === "METS_WIN"
      ? "Victory track slot"
      : "Random home-run track slot";
  const lightLabel = celebration ? "Celebration pattern" : "Off";
  const displayLabel = celebration
    ? `${celebration.celebration.replaceAll("_", " ")} animation · C++ renderer`
    : card
      ? `${card.kind === "INFO" ? "Info" : "Card"} · ${card.status}`
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
            ? "Display renderer unavailable"
            : rendererReady
              ? "C++ display renderer ready"
              : "Loading C++ renderer…"}
        </small>
      </div>
      <div className="physical-output-body">
        <div className="physical-screen-shell">
          <canvas
            ref={canvasRef}
            width={DEVICE_DISPLAY_WIDTH}
            height={DEVICE_DISPLAY_HEIGHT}
            role="img"
            aria-label={
              celebration
                ? `${celebration.celebration} display animation for ${celebration.subject}`
                : card
                  ? `${card.title}: ${card.status}${card.note ? ` — ${card.note.replace("|", " · ")}` : ""}`
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
