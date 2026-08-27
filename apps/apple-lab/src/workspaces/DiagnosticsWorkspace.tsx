import { fakeManagedDevice, type DeviceTimelineEvent } from "../fakeDevice";
import { Timeline, WorkspaceHeading } from "../managerComponents";

export function DiagnosticsWorkspace({ events }: { events: readonly DeviceTimelineEvent[] }) {
  const device = fakeManagedDevice;
  return (
    <section className="workspace" aria-labelledby="diagnostics-title">
      <WorkspaceHeading
        eyebrow="Device evidence"
        title="Diagnostics"
        titleId="diagnostics-title"
        description="Inspect transport, feed, safety, and event-ledger state without changing physical behavior."
      />
      <div className="diagnostics-grid">
        <article className="manager-panel diagnostic-summary">
          <header className="panel-title">
            <div>
              <span>Connection summary</span>
              <h2>{device.name}</h2>
            </div>
            <span className="state-badge state-badge--safe">Healthy</span>
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
              <dd>{device.host}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>{device.transport}</dd>
            </div>
            <div>
              <dt>Firmware</dt>
              <dd>v{device.firmwareVersion}</dd>
            </div>
            <div>
              <dt>Wi-Fi</dt>
              <dd>
                {device.wifiNetwork} · {device.wifiSignalDbm} dBm
              </dd>
            </div>
            <div>
              <dt>Power</dt>
              <dd>{device.power}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{device.uptime}</dd>
            </div>
            <div>
              <dt>Motion adapter</dt>
              <dd>{device.motionAdapter}</dd>
            </div>
          </dl>
        </article>
        <article className="manager-panel safety-audit">
          <header className="panel-title">
            <div>
              <span>Safety invariants</span>
              <h2>Current audit</h2>
            </div>
          </header>
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
        </article>
        <article className="manager-panel diagnostic-timeline">
          <header className="panel-title panel-title--timeline">
            <div>
              <span>Bounded history</span>
              <h2>Device event ledger</h2>
            </div>
            <small>Stable IDs prevent replay</small>
          </header>
          <Timeline events={events} filters exportFileName="apple-lab-device-event-ledger" />
        </article>
      </div>
    </section>
  );
}
