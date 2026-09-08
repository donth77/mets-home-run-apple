import { Scoreboard } from "@apple/scoreboard-ui";
import { describeNextGame } from "../appleDevice";
import { Timeline } from "../managerComponents";
import type { DeviceTimelineEvent } from "../fakeDevice";
import type { AppleDeviceState } from "../useAppleDevice";

export function ConnectedLiveView({
  apple,
  events,
}: {
  apple: AppleDeviceState;
  events: readonly DeviceTimelineEvent[];
}) {
  const status = apple.status;
  if (!status) return null;
  return (
    <div className="live-grid">
      <article className="manager-panel live-score-panel">
        <h2>On the Apple's screen</h2>
        {apple.connection === "STALE" && <p role="status">Connection interrupted. Showing the last received status.</p>}
        {status.snapshot ? (
          <Scoreboard snapshot={status.snapshot} />
        ) : (
          <p>{describeNextGame(status.game, status.mode)} · live scoreboard unavailable</p>
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
