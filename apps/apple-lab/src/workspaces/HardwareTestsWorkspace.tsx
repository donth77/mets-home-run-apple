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
  return (
    <section className="workspace" aria-labelledby="tests-title">
      <WorkspaceHeading
        eyebrow="Bench commissioning"
        title="Hardware tests"
        titleId="tests-title"
        description="Connect a Nano over USB, inspect real serial evidence, and run whichever guarded profile the firmware reports: the no-power logic test, bounded actuator jogs, the engine-driven motion sequence, or the microSD and amplifier checks."
      >
        <span className={bench.connection === "CONNECTED" ? "mode-pill mode-pill--read" : "mode-pill mode-pill--safe"}>
          <i /> {bench.connection === "CONNECTED" ? "USB bench connected" : "Hardware disconnected"}
        </span>
      </WorkspaceHeading>
      <UsbBenchPanel bench={bench} armed={armed} onArm={onArm} onDisarm={onDisarm} onTestRecorded={onRecord} />
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
