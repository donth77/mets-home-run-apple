import { Scoreboard } from "@apple/scoreboard-ui";
import { useEffect, useRef, useState } from "react";
import { cardFor, describeNextGame, describeSequence } from "../appleDevice";
import { mirrorCelebration, mirrorSnapshot } from "../appleMirror";
import type { DeviceTimelineEvent } from "../fakeDevice";
import { Timeline } from "../managerComponents";
import { PhysicalOutputPreview } from "../PhysicalOutputPreview";
import type { AppleDeviceState } from "../useAppleDevice";

// Ticks while the Apple is celebrating so the mirrored animation advances
// between status polls. Elapsed time is measured from when the Lab first saw
// the celebration, which trails the device by up to one poll.
function useCelebrationClock(active: boolean): number {
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    startedAt.current ??= performance.now();
    const timer = window.setInterval(() => {
      setElapsed(performance.now() - (startedAt.current ?? performance.now()));
    }, 40);
    return () => window.clearInterval(timer);
  }, [active]);
  return elapsed;
}

export function ConnectedLiveView({
  apple,
  events,
}: {
  apple: AppleDeviceState;
  events: readonly DeviceTimelineEvent[];
}) {
  const status = apple.status;
  const celebration = status ? mirrorCelebration(status) : undefined;
  const celebrationElapsedMs = useCelebrationClock(celebration !== undefined);
  if (!status) return null;
  const card = cardFor(status.screen);
  const motion = status.motionKnown ? describeSequence(status.sequence, status.fault === true) : "Unknown";
  return (
    <div className="live-grid">
      <article className="manager-panel live-score-panel">
        <h2>On the Apple's screen</h2>
        {apple.connection === "STALE" && <p role="status">Connection interrupted. Showing the last received status.</p>}
        {status.screen === null ? (
          <p>This firmware does not report its screen; showing the game state instead.</p>
        ) : null}
        <PhysicalOutputPreview
          snapshot={mirrorSnapshot(status)}
          card={card}
          celebration={celebration}
          celebrationElapsedMs={celebrationElapsedMs}
          elapsedMs={0}
          motionState={motion}
        />
        {status.snapshot ? (
          <Scoreboard snapshot={status.snapshot} />
        ) : (
          <p>{describeNextGame(status.game, status.mode)}</p>
        )}
      </article>
      <aside className="manager-panel feed-panel">
        <h2>Device feed health</h2>
        <p>
          {apple.device?.feedStatus} · {apple.device?.feedFreshness}
        </p>
        <p>Transport: {apple.transport}</p>
        <p>Last status: {apple.lastSeenAt ? new Date(apple.lastSeenAt).toLocaleTimeString() : "Unknown"}</p>
      </aside>
      <article className="manager-panel event-timeline-panel">
        <h2>Observed device events</h2>
        <Timeline events={events} filters exportFileName="apple-lab-device-history" />
      </article>
    </div>
  );
}
