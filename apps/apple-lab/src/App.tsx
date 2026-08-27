import { useEffect, useMemo, useState } from "react";
import {
  createRecordedDiagnosticEvent,
  fakeDeviceTimeline,
  fakeManagedDevice,
  type DeviceTimelineEvent,
} from "./fakeDevice";
import { DiagnosticsWorkspace } from "./workspaces/DiagnosticsWorkspace";
import { HardwareTestsWorkspace } from "./workspaces/HardwareTestsWorkspace";
import { HistoricalReplayWorkspace } from "./workspaces/HistoricalReplayWorkspace";
import { LiveWorkspace } from "./workspaces/LiveWorkspace";
import { OverviewWorkspace } from "./workspaces/OverviewWorkspace";
import { SettingsWorkspace } from "./workspaces/SettingsWorkspace";
import { SimulatorWorkspace } from "./workspaces/SimulatorWorkspace";

type WorkspaceId = "overview" | "live" | "replay" | "simulator" | "tests" | "diagnostics" | "settings";

const workspaces: readonly {
  id: WorkspaceId;
  index: string;
  label: string;
  description: string;
}[] = [
  { id: "overview", index: "01", label: "Overview", description: "Apple and game health" },
  { id: "live", index: "02", label: "Live game", description: "Read-only device timeline" },
  { id: "replay", index: "03", label: "Historical replay", description: "Archived MLB game playback" },
  { id: "simulator", index: "04", label: "Simulator", description: "Offline fixture replay" },
  { id: "tests", index: "05", label: "Hardware tests", description: "Gated service controls" },
  { id: "diagnostics", index: "06", label: "Diagnostics", description: "Telemetry and ledger" },
  { id: "settings", index: "07", label: "Settings", description: "Device configuration" },
];

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceId>("overview");
  const [serviceArmed, setServiceArmed] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState<DeviceTimelineEvent[]>([]);
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
  function recordServiceAction(title: string) {
    if (!serviceArmed) return;
    setRecordedEvents((current) => [createRecordedDiagnosticEvent(title, new Date().toISOString()), ...current]);
  }
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
            <small>Local device manager</small>
          </div>
        </div>
        <section className="sidebar-device" aria-label="Selected device">
          <div>
            <span className="connection-dot" />
            <strong>{fakeManagedDevice.name}</strong>
          </div>
          <small>{fakeManagedDevice.host}</small>
          <span>FAKE DEVICE · CONNECTED</span>
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
            <i /> Autonomous service active
          </span>
          <p>The Apple continues running without this dashboard.</p>
        </footer>
      </aside>
      <section className="manager-main">
        <header className="manager-topbar">
          <div>
            <span>APPLE LAB / {activeWorkspace.label.toUpperCase()}</span>
            <strong>{fakeManagedDevice.name}</strong>
          </div>
          <div className="topbar-status">
            <span>
              <i className="status-light status-light--good" /> Feed healthy
            </span>
            <span>
              <i className="status-light status-light--safe" /> Apple home
            </span>
            <span className="transport-pill">Fake transport</span>
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
              onArm={() => setServiceArmed(true)}
              onDisarm={() => setServiceArmed(false)}
              onRecord={recordServiceAction}
            />
          )}
          {workspace === "diagnostics" && <DiagnosticsWorkspace events={allEvents} />}
          {workspace === "settings" && <SettingsWorkspace />}
        </div>
      </section>
    </main>
  );
}
