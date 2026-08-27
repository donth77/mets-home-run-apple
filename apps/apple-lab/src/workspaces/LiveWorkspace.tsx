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
        description="Monitor the autonomous Apple or inspect a direct MLB feed through the same compiled C++ decision core. Neither source can reach physical outputs from this browser."
      >
        <span className={source === "device" ? "mode-pill mode-pill--read" : "mode-pill mode-pill--safe"}>
          <i /> {source === "device" ? "Monitoring only" : "Recording only"}
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
          <span>Autonomous Apple</span>
          <small>Accepted state from the fake local device</small>
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
            <strong>Read-only monitor</strong>
            <span>Leaving this screen or closing Apple Lab has no effect on autonomous game tracking.</span>
          </div>
          <DeviceLiveView events={events} />
        </>
      ) : (
        <>
          <div className="live-notice live-notice--recording">
            <strong>Developer recording transport</strong>
            <span>
              MLB data enters the canonical C++ core, but every emitted command remains an in-memory receipt. Starting
              this monitor cannot move a connected or future Apple.
            </span>
          </div>
          <MlbRecordingView recording={recording} />
        </>
      )}
    </section>
  );
}
