import { Scoreboard } from "@apple/scoreboard-ui";
import { fakeManagedDevice, type DeviceTimelineEvent } from "../fakeDevice";
import { Timeline } from "../managerComponents";

export function DeviceLiveView({ events }: { events: readonly DeviceTimelineEvent[] }) {
  const device = fakeManagedDevice;

  return (
    <div className="live-grid">
      <article className="manager-panel live-score-panel">
        <header className="panel-title">
          <div>
            <span>Example device display</span>
            <h2>Reference game state</h2>
          </div>
          <span className="state-badge state-badge--live">Demo</span>
        </header>
        <Scoreboard snapshot={device.snapshot} announceUpdates={false} />
        <div className="live-game-detail">
          <div>
            <span>At bat</span>
            <strong>{device.snapshot.atBat?.batter}</strong>
          </div>
          <div>
            <span>Last accepted event</span>
            <strong>{device.snapshot.lastEvent}</strong>
          </div>
        </div>
      </article>
      <aside className="manager-panel feed-panel">
        <header className="panel-title">
          <div>
            <span>Reference transport</span>
            <h2>Example feed health</h2>
          </div>
        </header>
        <dl className="detail-list">
          <div>
            <dt>Status</dt>
            <dd className="good-value">{device.feedStatus}</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>{device.feedFreshness}</dd>
          </div>
          <div>
            <dt>Review gate</dt>
            <dd>{device.snapshot.review}</dd>
          </div>
          <div>
            <dt>Game context</dt>
            <dd>
              {device.snapshot.gamePk} · G{device.snapshot.gameNumber}
            </dd>
          </div>
          <div>
            <dt>Operating mode</dt>
            <dd>AUTONOMOUS</dd>
          </div>
        </dl>
      </aside>
      <article className="manager-panel event-timeline-panel">
        <header className="panel-title panel-title--timeline">
          <div>
            <span>Example device history</span>
            <h2>Reference timeline</h2>
          </div>
          <small>Meaningful changes only—not every pitch</small>
        </header>
        <Timeline events={events} filters exportFileName="apple-lab-device-history" />
      </article>
      <aside className="manager-panel live-context-panel">
        <header className="panel-title">
          <div>
            <span>Next transition</span>
            <h2>Game context</h2>
          </div>
        </header>
        <div className="context-callout">
          <span>Apple</span>
          <strong>Retracted and armed</strong>
          <p>The next confirmed, newly observed Mets home run may enqueue one sequence.</p>
        </div>
        <dl className="detail-list">
          <div>
            <dt>Half inning</dt>
            <dd>Bottom {device.snapshot.inning}</dd>
          </div>
          <div>
            <dt>Outs</dt>
            <dd>{device.snapshot.outs}</dd>
          </div>
          <div>
            <dt>Runners</dt>
            <dd>First base</dd>
          </div>
          <div>
            <dt>Next scheduled game</dt>
            <dd>{device.nextGame}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
