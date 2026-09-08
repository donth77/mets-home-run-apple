import type { AppleDeviceState } from "../useAppleDevice";
import { ConnectedLiveView } from "./ConnectedLiveView";
import { useState } from "react";
import type { DeviceTimelineEvent } from "../fakeDevice";
import { WorkspaceHeading } from "../managerComponents";
import { useMlbRecordingFeed } from "../useMlbRecordingFeed";
import { DeviceLiveView } from "./DeviceLiveView";
import { MlbRecordingView } from "./MlbRecordingView";

export function LiveWorkspace({ events, apple }: { events: readonly DeviceTimelineEvent[]; apple?: AppleDeviceState }) {
  const [source, setSource] = useState<"device" | "mlb-recording">("device");
  const recording = useMlbRecordingFeed();
  const connected = apple?.status != null && apple.connection !== "DISCONNECTED";

  return (
    <section className="workspace" aria-labelledby="live-title">
      <WorkspaceHeading
        eyebrow="Read-only view of the Apple"
        title="Apple now"
        titleId="live-title"
        description="What the connected Apple is showing and doing right now, or a separate MLB recording. This page reads device status and does not drive motion."
      >
        <span className={source === "device" ? "mode-pill mode-pill--read" : "mode-pill mode-pill--safe"}>
          <i />{" "}
          {source === "device"
            ? connected
              ? apple.connection === "STALE"
                ? "Status stale"
                : "Device telemetry"
              : "Demo data"
            : "Recording only"}
        </span>
      </WorkspaceHeading>
      <fieldset className="live-source-switch">
        <legend className="visually-hidden">Apple now data source</legend>
        <button
          type="button"
          className={source === "device" ? "is-active" : ""}
          aria-pressed={source === "device"}
          onClick={() => {
            recording.stop();
            setSource("device");
          }}
        >
          <span>{connected ? "Connected Apple" : "Example autonomous Apple"}</span>
          <small>
            {connected ? `${apple.transport} device telemetry` : "Static demo data — not connected-device telemetry"}
          </small>
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

      {source === "device" && connected ? (
        <ConnectedLiveView apple={apple} events={events} />
      ) : source === "device" ? (
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
