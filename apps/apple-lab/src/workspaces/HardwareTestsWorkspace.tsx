import type { DeviceTimelineEvent } from "../fakeDevice";
import { Timeline, WorkspaceHeading } from "../managerComponents";
import { UsbBenchPanel } from "../UsbBenchPanel";
import type { UsbBenchDevice } from "../useUsbBenchDevice";

export function HardwareTestsWorkspace({
  armed,
  events,
  onArm,
  onDisarm,
  onRecord,
  bench,
}: {
  armed: boolean;
  events: readonly DeviceTimelineEvent[];
  onArm: () => void;
  onDisarm: () => void;
  onRecord: (title: string) => void;
  bench: UsbBenchDevice;
}) {
  const tests = [
    {
      title: "Home-position check",
      detail: "Requires the final home sensor and a time-limited physical maintenance session.",
    },
    {
      title: "25-cycle motion soak",
      detail: "Will repeat the engine-driven sequence with receipts, current, and temperature records.",
    },
    {
      title: "Speaker and SD test",
      detail: "Will validate decoding, amplifier output, track selection, and stop behavior.",
    },
    {
      title: "Status-light test",
      detail: "Will validate current draw and the configured celebration-light pattern.",
    },
  ];
  return (
    <section className="workspace" aria-labelledby="tests-title">
      <WorkspaceHeading
        eyebrow="Bench commissioning"
        title="Hardware tests"
        titleId="tests-title"
        description="Connect a Nano over USB, inspect real serial evidence, and run whichever guarded profile the firmware reports: the no-power logic test, bounded actuator jogs, or the engine-driven motion sequence."
      >
        <span className={bench.connection === "CONNECTED" ? "mode-pill mode-pill--read" : "mode-pill mode-pill--safe"}>
          <i /> {bench.connection === "CONNECTED" ? "USB bench connected" : "Hardware disconnected"}
        </span>
      </WorkspaceHeading>
      <UsbBenchPanel bench={bench} armed={armed} onArm={onArm} onDisarm={onDisarm} onTestRecorded={onRecord} />
      <section className="manager-panel test-control-panel">
        <header className="panel-title">
          <div>
            <span>Not enabled yet</span>
            <h2>Powered component tests</h2>
          </div>
          <small>Separate guarded firmware profiles required</small>
        </header>
        <div className="test-control-grid">
          {tests.map((test) => (
            <article key={test.title} className="test-control-card">
              <span className="test-control-card__icon" aria-hidden="true" />
              <h3>{test.title}</h3>
              <p>{test.detail}</p>
              <button type="button" disabled>
                Unavailable
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="manager-panel service-log" aria-live="polite">
        <header className="panel-title">
          <div>
            <span>Verified sessions</span>
            <h2>Commissioning receipts</h2>
          </div>
        </header>
        {events.length === 0 ? (
          <p className="empty-state">No completed USB self-tests have been recorded in this session.</p>
        ) : (
          <Timeline events={events} compact exportFileName="apple-lab-service-receipts" />
        )}
      </section>
    </section>
  );
}
