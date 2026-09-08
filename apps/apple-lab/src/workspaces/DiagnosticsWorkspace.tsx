import { describeRssi } from "../appleDevice";
import { fakeManagedDevice, type DeviceTimelineEvent } from "../fakeDevice";
import { Timeline, WorkspaceHeading } from "../managerComponents";
import { type AppleDeviceState, liveApple } from "../useAppleDevice";

function kilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

export function DiagnosticsWorkspace({
  events,
  apple,
}: {
  events: readonly DeviceTimelineEvent[];
  apple?: AppleDeviceState;
}) {
  const live = liveApple(apple);
  const status = live?.status ?? null;
  const device = live?.device ?? fakeManagedDevice;
  return (
    <section className="workspace" aria-labelledby="diagnostics-title">
      <WorkspaceHeading
        eyebrow={live ? "Live telemetry" : "Telemetry model"}
        title="Diagnostics"
        titleId="diagnostics-title"
        description={
          live
            ? "What the Apple reports over the selected connection, and the events Apple Lab has observed since it connected. The Apple keeps its own ledger; this is a window, not a copy."
            : "Preview the transport, feed, safety, and event-ledger data the read-only Wi-Fi connection exposes once your Apple is connected."
        }
      />
      <div className="diagnostics-grid">
        <article className="manager-panel diagnostic-summary">
          <header className="panel-title">
            <div>
              <span>Connection summary</span>
              <h2>{device.name}</h2>
            </div>
            <span
              className={
                live ? live.connection === "STALE"
                    ? "state-badge"
                    : "state-badge state-badge--live"
                  : "state-badge state-badge--safe"
              }
            >
              {live ? (live.connection === "STALE" ? "Not answering" : "Live") : "Demo data"}
            </span>
          </header>
          <dl className="detail-list detail-list--wide">
            <div>
              <dt>Device ID</dt>
              <dd>
                <code>{device.id}</code>
              </dd>
            </div>
            <div>
              <dt>Local host</dt>
              <dd>{status ? `${device.host} · ${status.wifi.ip}` : device.host}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>{device.transport}</dd>
            </div>
            <div>
              <dt>Firmware</dt>
              <dd>
                {status ? `v${status.firmwareVersion} · slot ${status.firmwareSlot}` : `v${device.firmwareVersion}`}
              </dd>
            </div>
            <div>
              <dt>Wi-Fi</dt>
              <dd>
                {device.wifiNetwork} · {device.wifiSignalDbm} dBm{status ? ` · ${describeRssi(status.wifi.rssi)}` : ""}
              </dd>
            </div>
            <div>
              <dt>{status ? "Motor" : "Power"}</dt>
              <dd>{device.power}</dd>
            </div>
            <div>
              <dt>{status ? "Clock" : "Uptime"}</dt>
              <dd>{device.uptime}</dd>
            </div>
            <div>
              <dt>Motion adapter</dt>
              <dd>{device.motionAdapter}</dd>
            </div>
            {status ? (
              <>
                <div>
                  <dt>Memory</dt>
                  <dd>
                    heap {kilobytes(status.heapFree)} free · largest {kilobytes(status.heapLargest)} · PSRAM{" "}
                    {kilobytes(status.psramFree)}
                  </dd>
                </div>
                <div>
                  <dt>MLB polls</dt>
                  <dd>
                    {status.poll.ok} ok · {status.poll.failed} failed
                    {status.poll.lastMs ? ` · last ${status.poll.lastMs} ms` : ""}
                    {status.poll.lastError ? ` · ${status.poll.lastError}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Update channel</dt>
                  <dd>
                    {status.update.state}
                    {status.update.version ? ` · ${status.update.version}` : ""}
                    {status.update.error ? ` · ${status.update.error}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Last celebration</dt>
                  <dd>
                    {status.lastCelebration
                      ? `${status.lastCelebration.kind} · ${status.lastCelebration.subject} · ${new Date(status.lastCelebration.at * 1000).toLocaleString()}`
                      : "None recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Last status</dt>
                  <dd>{apple?.lastSeenAt ? new Date(apple.lastSeenAt).toLocaleTimeString() : "—"}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </article>
        <article className="manager-panel safety-audit">
          <header className="panel-title">
            <div>
              <span>Safety invariants</span>
              <h2>{live ? "Reported by the Apple" : "Example audit"}</h2>
            </div>
          </header>
          {status ? (
            <ul className="check-list">
              <li data-ok={status.motionKnown && status.fault === false}>
                <i />
                {!status.motionKnown
                  ? "Motion state unknown; hardware tests disabled"
                  : status.fault
                    ? "The Apple reports a fault"
                    : "No fault reported by the Apple"}
              </li>
              <li data-ok={status.sequence === "IDLE"}>
                <i />
                {status.sequence === "IDLE" ? "No active motion sequence" : `Sequence in progress: ${status.sequence}`}
              </li>
              <li data-ok={status.positionMm === 0}>
                <i />
                {status.positionMm === 0
                  ? "Estimated position is home"
                  : status.positionMm === null
                    ? "Position unknown"
                    : `Estimated position ${status.positionMm} mm`}
              </li>
              <li data-ok={status.drive === "OFF" || status.sequence !== "IDLE"}>
                <i />
                Drive {status.drive} ·{" "}
                {status.settings.motor ? "motor enabled in the Manager" : "motor disabled in the Manager"}
              </li>
              <li data-ok={status.settings.requireCode}>
                <i />
                {status.settings.requireCode
                  ? "Setup code required for anything that acts"
                  : "Owner settings lock is off; guarded hardware tests require their own maintenance session"}
              </li>
            </ul>
          ) : (
            <ul className="check-list">
              <li>
                <i />
                Accepted event key persisted before motion intent
              </li>
              <li>
                <i />
                Review-pending candidates remain motion-disabled
              </li>
              <li>
                <i />
                Apple is at the retracted home limit
              </li>
              <li>
                <i />
                No active or queued motion sequence
              </li>
              <li>
                <i />
                Lab adapter is recording-only
              </li>
            </ul>
          )}
        </article>
        <article className="manager-panel diagnostic-timeline">
          <header className="panel-title panel-title--timeline">
            <div>
              <span>{live ? "Observed since connecting" : "Bounded history"}</span>
              <h2>{live ? "Apple event log" : "Example event ledger"}</h2>
            </div>
            <small>{live ? "The Apple's own ledger stays on the device" : "Stable IDs prevent replay"}</small>
          </header>
          <Timeline events={events} filters exportFileName="apple-lab-device-event-ledger" />
        </article>
      </div>
    </section>
  );
}
