import { useUsbAppleDevice } from "./useUsbAppleDevice";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppleConnectionPanel } from "./AppleConnection";
import { describeSequence } from "./appleDevice";
import { createRecordedDiagnosticEvent, type DeviceTimelineEvent, fakeDeviceTimeline } from "./fakeDevice";
import { useAppleDevice } from "./useAppleDevice";
import { useUsbBenchDevice } from "./useUsbBenchDevice";
import { DiagnosticsWorkspace } from "./workspaces/DiagnosticsWorkspace";
import { HardwareTestsWorkspace } from "./workspaces/HardwareTestsWorkspace";
import { HistoricalReplayWorkspace } from "./workspaces/HistoricalReplayWorkspace";
import { LiveWorkspace } from "./workspaces/LiveWorkspace";
import { OverviewWorkspace } from "./workspaces/OverviewWorkspace";
import { SimulatorWorkspace } from "./workspaces/SimulatorWorkspace";

const GITHUB_MARK =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d={GITHUB_MARK} />
    </svg>
  );
}

type WorkspaceId = "overview" | "live" | "replay" | "simulator" | "tests" | "diagnostics";

const workspaces: readonly {
  id: WorkspaceId;
  index: string;
  label: string;
  description: string;
}[] = [
  { id: "overview", index: "01", label: "Overview", description: "Lab and device preview" },
  { id: "simulator", index: "02", label: "Simulator", description: "Scenarios in the browser or on the Apple" },
  { id: "live", index: "03", label: "Apple now", description: "What the Apple is showing right now" },
  { id: "replay", index: "04", label: "Historical replay", description: "Archived MLB game playback" },
  { id: "tests", index: "05", label: "Hardware tests", description: "Gated service controls" },
  { id: "diagnostics", index: "06", label: "Diagnostics", description: "Device telemetry and events" },
];

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceId>("overview");
  const [serviceArmed, setServiceArmed] = useState(false);
  const [recordedEvents, setRecordedEvents] = useState<DeviceTimelineEvent[]>([]);
  const usbBench = useUsbBenchDevice();
  const benchConnected = usbBench.connection === "CONNECTED";
  const wifiApple = useAppleDevice();
  const usbApple = useUsbAppleDevice(usbBench);
  const apple = wifiApple.connection !== "DISCONNECTED" ? wifiApple : usbApple;
  const appleLinked = apple.connection === "CONNECTED" || apple.connection === "STALE";
  // With the Apple connected the timeline is what the Lab actually observed;
  // the reference timeline is only for the Lab running on its own.
  const allEvents = useMemo(
    () =>
      [...recordedEvents, ...apple.events, ...(appleLinked ? [] : fakeDeviceTimeline)].sort(
        (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
      ),
    [recordedEvents, apple.events, appleLinked],
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
        <AppleConnectionPanel apple={wifiApple} benchConnected={benchConnected} />
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
          <a
            className="source-link"
            href="https://github.com/donth77/mets-home-run-apple#mets-home-run-apple"
            target="_blank"
            rel="noopener"
            aria-label="Home Run Apple on GitHub"
            title="Home Run Apple on GitHub"
          >
            <GitHubMark />
          </a>
        </footer>
      </aside>
      <section className="manager-main">
        <header className="manager-topbar">
          <div>
            <span>APPLE LAB / {activeWorkspace.label.toUpperCase()}</span>
            <strong>
              {appleLinked
                ? `Home Run Apple · ${apple.host}`
                : benchConnected
                  ? "Nano ESP32 · USB bench"
                  : "Reference device · demo"}
            </strong>
          </div>
          <div className="topbar-status">
            <span>
              <i className="status-light status-light--good" /> Lab tools ready
            </span>
            <span>
              <i
                className={`status-light ${
                  appleLinked
                    ? apple.idle
                      ? "status-light--safe"
                      : "status-light--good"
                    : benchConnected
                      ? "status-light--safe"
                      : ""
                }`}
              />{" "}
              {appleLinked && apple.status
                ? apple.connection === "STALE"
                  ? "Apple not answering"
                  : `Apple ${apple.status.motionKnown ? describeSequence(apple.status.sequence, apple.status.fault).toLowerCase() : "motion unknown"}`
                : apple.connection === "CONNECTING"
                  ? `Connecting to ${apple.host}…`
                  : benchConnected
                    ? usbBench.driverState?.state === "STOP"
                      ? "Outputs low"
                      : "Bench active"
                    : "Hardware disconnected"}
            </span>
            <span className="transport-pill">
              {appleLinked
                ? apple.transport === "USB"
                  ? "USB serial"
                  : "Wi-Fi"
                : benchConnected
                  ? "USB serial"
                  : "No device"}
            </span>
          </div>
        </header>
        <div id="workspace-content" className="manager-content" tabIndex={-1}>
          {workspace === "overview" && (
            <OverviewWorkspace events={allEvents} onOpenLive={() => setWorkspace("live")} apple={apple} />
          )}
          {workspace === "live" && <LiveWorkspace events={allEvents} apple={apple} />}
          {workspace === "replay" && <HistoricalReplayWorkspace />}
          {workspace === "simulator" && <SimulatorWorkspace apple={apple} />}
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
          {workspace === "diagnostics" && <DiagnosticsWorkspace events={allEvents} apple={apple} />}
        </div>
      </section>
    </main>
  );
}
