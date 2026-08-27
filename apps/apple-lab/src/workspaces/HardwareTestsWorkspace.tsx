import type { DeviceTimelineEvent } from "../fakeDevice";
import { HealthItem, Timeline, WorkspaceHeading } from "../managerComponents";

export function HardwareTestsWorkspace({
  armed,
  events,
  onArm,
  onDisarm,
  onRecord,
}: {
  armed: boolean;
  events: readonly DeviceTimelineEvent[];
  onArm: () => void;
  onDisarm: () => void;
  onRecord: (title: string) => void;
}) {
  const tests = [
    {
      title: "Display test",
      detail: "Record a scoreboard and pixel-pattern diagnostic.",
      action: "Display test recorded",
    },
    {
      title: "Raise / lower cycle",
      detail: "Record one 50 mm extend, hold, and retract sequence.",
      action: "Raise / lower cycle recorded",
    },
    {
      title: "Home-position check",
      detail: "Record a retracted-limit verification request.",
      action: "Home-position check recorded",
    },
    {
      title: "Status-light test",
      detail: "Record the configured celebration-light pattern.",
      action: "Status-light test recorded",
    },
  ];
  return (
    <section className="workspace" aria-labelledby="tests-title">
      <WorkspaceHeading
        eyebrow="Gated service workspace"
        title="Hardware tests"
        titleId="tests-title"
        description="Service controls are isolated from live monitoring. The current fake adapter records requests but has no path to physical outputs."
      >
        <span className={armed ? "mode-pill mode-pill--warning" : "mode-pill mode-pill--safe"}>
          <i /> {armed ? "Recording armed" : "Controls locked"}
        </span>
      </WorkspaceHeading>
      <div className={armed ? "service-safety is-armed" : "service-safety"} role="status">
        <div>
          <span>{armed ? "Recording session active" : "Safety interlock"}</span>
          <strong>
            {armed ? "Fake commands expire automatically after 60 seconds" : "No test command can be issued"}
          </strong>
          <p>
            Physical-device support will require a separate firmware authorization handshake, idle motion state, and
            time-limited maintenance lease.
          </p>
        </div>
        {armed ? (
          <button type="button" className="secondary-button" onClick={onDisarm}>
            End session
          </button>
        ) : (
          <button type="button" className="arm-button" onClick={onArm}>
            Arm recording controls
          </button>
        )}
      </div>
      <section className="interlock-grid" aria-label="Current safety interlocks">
        <HealthItem
          label="Device transport"
          value="Fake adapter"
          detail="No GPIO or network command path"
          tone="good"
        />
        <HealthItem
          label="Motion output"
          value="Recording only"
          detail="Commands remain in browser memory"
          tone="good"
        />
        <HealthItem
          label="Live automation"
          value="Unaffected"
          detail="Manager workspace selection changes nothing"
          tone="good"
        />
        <HealthItem label="Session timeout" value="60 seconds" detail="Returns to locked automatically" />
      </section>
      <section className="manager-panel test-control-panel">
        <header className="panel-title">
          <div>
            <span>Service actions</span>
            <h2>Recorded test commands</h2>
          </div>
          <small>Fake device adapter</small>
        </header>
        <div className="test-control-grid">
          {tests.map((test) => (
            <article key={test.action} className="test-control-card">
              <span className="test-control-card__icon" aria-hidden="true" />
              <h3>{test.title}</h3>
              <p>{test.detail}</p>
              <button type="button" disabled={!armed} onClick={() => onRecord(test.action)}>
                {armed ? "Record test" : "Locked"}
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="manager-panel service-log" aria-live="polite">
        <header className="panel-title">
          <div>
            <span>This browser session</span>
            <h2>Recorded receipts</h2>
          </div>
        </header>
        {events.length === 0 ? (
          <p className="empty-state">No service actions have been recorded.</p>
        ) : (
          <Timeline events={events} compact exportFileName="apple-lab-service-receipts" />
        )}
      </section>
    </section>
  );
}
