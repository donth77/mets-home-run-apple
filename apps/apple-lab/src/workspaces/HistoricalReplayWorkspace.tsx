import { HistoricalReplayPanel } from "../HistoricalReplayPanel";
import { WorkspaceHeading } from "../managerComponents";

export function HistoricalReplayWorkspace() {
  return (
    <section className="workspace" aria-labelledby="historical-replay-title">
      <WorkspaceHeading
        eyebrow="Archived game testing"
        title="Historical replay"
        titleId="historical-replay-title"
        description="Replay completed MLB games update by update through the canonical C++ decision core, without any physical output route."
      />
      <HistoricalReplayPanel />
    </section>
  );
}
