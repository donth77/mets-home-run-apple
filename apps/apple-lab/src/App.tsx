import { useCallback, useEffect, useMemo, useState } from "react";
import { createRecordedDiagnosticEvent, type DeviceTimelineEvent, fakeDeviceTimeline } from "./fakeDevice";
import { useUsbBenchDevice } from "./useUsbBenchDevice";
import { DiagnosticsWorkspace } from "./workspaces/DiagnosticsWorkspace";
import { HardwareTestsWorkspace } from "./workspaces/HardwareTestsWorkspace";
import { HistoricalReplayWorkspace } from "./workspaces/HistoricalReplayWorkspace";
import { LiveWorkspace } from "./workspaces/LiveWorkspace";
import { OverviewWorkspace } from "./workspaces/OverviewWorkspace";
import { SimulatorWorkspace } from "./workspaces/SimulatorWorkspace";

type WorkspaceId = "overview" | "live" | "replay" | "simulator" | "tests" | "diagnostics";

const workspaces: readonly {
  id: WorkspaceId;
  index: string;
  label: string;
  description: string;
}[] = [
  { id: "overview", index: "01", label: "Overview", description: "Lab and device preview" },
  { id: "live", index: "02", label: "Live game", description: "Demo device or MLB recording" },
  { id: "replay", index: "03", label: "Historical replay", description: "Archived MLB game playback" },
  { id: "simulator", index: "04", label: "Simulator", description: "Offline fixture replay" },
  { id: "tests", index: "05", label: "Hardware tests", description: "Gated service controls" },
  { id: "diagnostics", index: "06", label: "Diagnostics", description: "Demo telemetry model" },
];

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceId>("overview");
  const [serviceArmed, setServiceArmed] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState<DeviceTimelineEvent[]>([]);
  const usbBench = useUsbBenchDevice();
  const benchConnected = usbBench.connection === "CONNECTED";
  const allEvents = useMemo(
    () =>
      [...recordedEvents, ...fakeDeviceTimeline].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
    [recordedEvents],
  );
  useEffect(() => {
    if (!serviceArmed) return;
    const timer = window.setTimeout(() => setServiceArmed(false), 60_000);
    return () => window.clearTimeout(timer);
  }, [serviceArmed]);
  const recordServiceAction = useCallback(
    (title: string) => {
      if (!serviceArmed) return;
      setRecordedEvents((current) => [createRecordedDiagnosticEvent(title, new Date().toISOString()), ...current]);
    },
    [serviceArmed],
  );
  const armServiceSession = useCallback(() => setServiceArmed(true), []);
  const disarmServiceSession = useCallback(() => setServiceArmed(false), []);
  const activeWorkspace = workspaces.find((item) => item.id === workspace) ?? workspaces[0];

  return (
    <main className="manager-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <aside className="manager-sidebar">
        <div className="manager-brand">
          <img src="/favicon.png" alt="" />
          <div>
            <strong>Apple Lab</strong>
            <small>Local engineering tool</small>
          </div>
        </div>
        <section className="sidebar-device" aria-label="Selected device">
          <div>
            <span className={benchConnected ? "connection-dot" : "connection-dot connection-dot--offline"} />
            <strong>{benchConnected ? "Nano ESP32" : "No physical device"}</strong>
          </div>
          <small>{benchConnected ? "USB serial · local bench" : "Simulator and feed tools available"}</small>
          <span>{benchConnected ? "USB BENCH · CONNECTED" : "HARDWARE · DISCONNECTED"}</span>
        </section>
        <nav className="workspace-nav" aria-label="Apple Lab workspaces">
          {workspaces.map((item) => (
            <button
              type="button"
              key={item.id}
              className={workspace === item.id ? "is-active" : ""}
              aria-current={workspace === item.id ? "page" : undefined}
              onClick={() => setWorkspace(item.id)}
            >
              <span>{item.index}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
            </button>
          ))}
        </nav>
        <footer className="sidebar-footer">
          <span>
            <i /> Device remains autonomous
          </span>
          <p>Apple Lab is optional and never sits in the live control loop.</p>
        </footer>
      </aside>
      <section className="manager-main">
        <header className="manager-topbar">
          <div>
            <span>APPLE LAB / {activeWorkspace.label.toUpperCase()}</span>
            <strong>{benchConnected ? "Nano ESP32 · USB bench" : "Reference device · demo"}</strong>
          </div>
          <div className="topbar-status">
            <span>
              <i className="status-light status-light--good" /> Lab tools ready
            </span>
            <span>
              <i className={`status-light ${benchConnected ? "status-light--safe" : ""}`} />{" "}
              {benchConnected
                ? usbBench.driverState?.state === "STOP"
                  ? "Outputs low"
                  : "Bench active"
                : "Hardware disconnected"}
            </span>
            <span className="transport-pill">{benchConnected ? "USB serial" : "No device"}</span>
          </div>
        </header>
        <div id="workspace-content" className="manager-content" tabIndex={-1}>
          {workspace === "overview" && <OverviewWorkspace events={allEvents} onOpenLive={() => setWorkspace("live")} />}
          {workspace === "live" && <LiveWorkspace events={allEvents} />}
          {workspace === "replay" && <HistoricalReplayWorkspace />}
          {workspace === "simulator" && <SimulatorWorkspace />}
          {workspace === "tests" && (
            <HardwareTestsWorkspace
              armed={serviceArmed}
              events={recordedEvents}
              onArm={armServiceSession}
              onDisarm={disarmServiceSession}
              onRecord={recordServiceAction}
              bench={usbBench}
            />
          )}
          {workspace === "diagnostics" && <DiagnosticsWorkspace events={allEvents} />}
        </div>
      </section>
    </main>
  );
}
