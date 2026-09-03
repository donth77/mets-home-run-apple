import { useState } from "react";
import type { DeviceTimelineEvent } from "../fakeDevice";
import { WorkspaceHeading } from "../managerComponents";
import { useMlbRecordingFeed } from "../useMlbRecordingFeed";
import { DeviceLiveView } from "./DeviceLiveView";
import { MlbRecordingView } from "./MlbRecordingView";

export function LiveWorkspace({ events }: { events: readonly DeviceTimelineEvent[] }) {
  const [source, setSource] = useState<"device" | "mlb-recording">("device");
  const recording = useMlbRecordingFeed();

  return (
    <section className="workspace" aria-labelledby="live-title">
      <WorkspaceHeading
        eyebrow="Read-only game workspace"
        title="Live game"
        titleId="live-title"
        description="Inspect an example autonomous-device view or a direct MLB feed through the compiled C++ game-state and decision layers. Neither source can reach physical outputs from this browser."
      >
        <span className={source === "device" ? "mode-pill mode-pill--read" : "mode-pill mode-pill--safe"}>
          <i /> {source === "device" ? "Demo data" : "Recording only"}
        </span>
      </WorkspaceHeading>
      <fieldset className="live-source-switch">
        <legend className="visually-hidden">Live game data source</legend>
        <button
          type="button"
          className={source === "device" ? "is-active" : ""}
          aria-pressed={source === "device"}
          onClick={() => {
            recording.stop();
            setSource("device");
          }}
        >
          <span>Example autonomous Apple</span>
          <small>Static demo data — not connected-device telemetry</small>
        </button>
        <button
          type="button"
          className={source === "mlb-recording" ? "is-active" : ""}
          aria-pressed={source === "mlb-recording"}
          onClick={() => setSource("mlb-recording")}
        >
          <span>MLB direct · developer</span>
          <small>Live transport with recording-only WASM output</small>
        </button>
      </fieldset>

      {source === "device" ? (
        <>
          <div className="live-notice">
            <strong>Demo device view</strong>
            <span>Reference data only. Live USB test telemetry remains available in Hardware Tests.</span>
          </div>
          <DeviceLiveView events={events} />
        </>
      ) : (
        <>
          <div className="live-notice live-notice--recording">
            <strong>Developer recording transport</strong>
            <span>
              MLB data enters the C++ game-state projector before its smaller evidence envelope reaches the decision
              core. Every emitted command remains an in-memory receipt and cannot move an Apple.
            </span>
          </div>
          <MlbRecordingView recording={recording} />
        </>
      )}
    </section>
  );
}
