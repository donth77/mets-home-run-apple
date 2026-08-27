import { MAX_STROKE_MM } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { fakeManagedDevice, type DeviceTimelineEvent } from "../fakeDevice";
import { HealthItem, Timeline, WorkspaceHeading } from "../managerComponents";

export function OverviewWorkspace({
  events,
  onOpenLive,
}: {
  events: readonly DeviceTimelineEvent[];
  onOpenLive: () => void;
}) {
  const device = fakeManagedDevice;
  return (
    <section className="workspace" aria-labelledby="overview-title">
      <WorkspaceHeading
        eyebrow="Local device manager"
        title="Your Apple is ready"
        titleId="overview-title"
        description="One view of the autonomous device, current game, and safety state. Apple Lab is optional—the device keeps running when this page is closed."
      >
        <span className="mode-pill mode-pill--live">
          <i /> Autonomous live
        </span>
      </WorkspaceHeading>
      <div className="overview-grid">
        <article className="manager-panel overview-game">
          <header className="panel-title">
            <div>
              <span>Fake device preview</span>
              <h2>Simulated game state</h2>
            </div>
            <span className="read-only-badge">Read only</span>
          </header>
          <div className="overview-game__body">
            <Scoreboard snapshot={device.snapshot} variant="lab" />
            <div className="current-play">
              <span>Current at-bat</span>
              <strong>{device.snapshot.atBat?.batter ?? "Mets batting"}</strong>
              <p>{device.snapshot.lastEvent}</p>
              <small>{device.feedFreshness}</small>
            </div>
          </div>
          <footer>
            <span>
              Device game <strong>{device.snapshot.gamePk}</strong>
            </span>
            <button type="button" className="text-button" onClick={onOpenLive}>
              Open live game →
            </button>
          </footer>
        </article>
        <article className="manager-panel apple-state-card">
          <header className="panel-title">
            <div>
              <span>Physical state</span>
              <h2>Apple position</h2>
            </div>
            <span className="state-badge state-badge--safe">Home</span>
          </header>
          <div
            className="position-visual"
            role="img"
            aria-label={`Apple retracted at ${device.positionMm} millimeters`}
          >
            <div className="position-track">
              <span style={{ height: `${(device.positionMm / MAX_STROKE_MM) * 100}%` }} />
            </div>
            <div>
              <strong>{device.positionMm.toFixed(1)}</strong>
              <span>mm</span>
            </div>
          </div>
          <dl className="compact-facts">
            <div>
              <dt>Motion</dt>
              <dd>{device.motionState}</dd>
            </div>
            <div>
              <dt>Adapter</dt>
              <dd>{device.motionAdapter}</dd>
            </div>
            <div>
              <dt>Raised hold</dt>
              <dd>{device.raisedDwellMs / 1000} seconds</dd>
            </div>
          </dl>
        </article>
        <article className="manager-panel device-health">
          <header className="panel-title">
            <div>
              <span>Device health</span>
              <h2>All systems nominal</h2>
            </div>
            <span className="health-score">4/4</span>
          </header>
          <div className="health-list">
            <HealthItem label="Game feed" value={device.feedStatus} detail={device.feedFreshness} tone="good" />
            <HealthItem label="Wi-Fi" value={`${device.wifiSignalDbm} dBm`} detail={device.wifiNetwork} tone="good" />
            <HealthItem label="Power" value={device.power} detail="Stable external input" tone="good" />
            <HealthItem label="Firmware" value={`v${device.firmwareVersion}`} detail={`Uptime ${device.uptime}`} />
          </div>
        </article>
        <article className="manager-panel recent-events">
          <header className="panel-title">
            <div>
              <span>Significant events</span>
              <h2>Recent activity</h2>
            </div>
            <button type="button" className="text-button" onClick={onOpenLive}>
              View timeline
            </button>
          </header>
          <Timeline events={events.slice(0, 4)} compact exportFileName="apple-lab-recent-activity" />
        </article>
        <article className="manager-panel autonomy-card">
          <span className="eyebrow">No dashboard dependency</span>
          <h2>Runs independently</h2>
          <p>
            The Nano owns live game tracking, deduplication, display state, sleep, and motion. Disconnecting Apple Lab
            does not interrupt a game.
          </p>
          <div
            className="autonomy-route"
            role="img"
            aria-label="Autonomous data flow from MLB feed to Nano ESP32 to Apple"
          >
            <span>MLB feed</span>
            <i>→</i>
            <span>Nano ESP32</span>
            <i>→</i>
            <span>Apple</span>
          </div>
        </article>
      </div>
    </section>
  );
}
