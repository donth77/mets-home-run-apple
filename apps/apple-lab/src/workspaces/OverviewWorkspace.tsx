import { MAX_STROKE_MM } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { describeNextGame, describeRssi, describeSequence, sequenceTone } from "../appleDevice";
import { fakeManagedDevice, type DeviceTimelineEvent } from "../fakeDevice";
import { HealthItem, Timeline, WorkspaceHeading } from "../managerComponents";
import type { AppleDeviceState } from "../useAppleDevice";

export function OverviewWorkspace({
  events,
  onOpenLive,
  apple,
}: {
  events: readonly DeviceTimelineEvent[];
  onOpenLive: () => void;
  apple?: AppleDeviceState;
}) {
  const live = apple !== undefined && apple.device !== null && apple.status !== null && apple.connection !== "DISCONNECTED";
  const device = live ? apple.device! : fakeManagedDevice;
  const status = live ? apple.status! : null;
  const stale = apple?.connection === "STALE";
  const tone = status ? sequenceTone(status.sequence, status.fault) : "safe";
  const motionLabel = status ? describeSequence(status.sequence, status.fault) : "Home";
  const canTest = live && apple.idle && apple.pending === null && !stale;
  const healthy = status
    ? [status.wifi.state === "CONNECTED" && status.wifi.rssi >= -80, status.audio.card, status.clock, !status.fault]
    : [true, true, true, true];
  const healthScore = healthy.filter(Boolean).length;

  return (
    <section className="workspace" aria-labelledby="overview-title">
      <WorkspaceHeading
        eyebrow={live ? "Physical Apple" : "Local engineering tool"}
        title={live ? "Your Apple is connected" : "Apple Lab is ready"}
        titleId="overview-title"
        description={
          live
            ? "Live status from the Apple over Wi-Fi. Test celebrations run the Apple's own recorded game through its real engine; the Apple owns every safety decision."
            : "Use fixtures, live feeds, historical games, and the USB bench workspace without putting this browser in the autonomous game loop. Connect your Apple from the sidebar to see it here."
        }
      >
        {live ? (
          <span className={stale ? "mode-pill mode-pill--warning" : "mode-pill mode-pill--live"}>
            <i /> {stale ? "Not answering" : `Live · ${device.host}`}
          </span>
        ) : (
          <span className="mode-pill mode-pill--read">
            <i /> Preview data
          </span>
        )}
      </WorkspaceHeading>
      <div className="overview-grid">
        <article className="manager-panel overview-game">
          <header className="panel-title">
            <div>
              <span>{live ? "On the Apple's screen" : "Reference device preview"}</span>
              <h2>{live ? (device.snapshot ? "Live game" : describeMode(status!.mode)) : "Example game state"}</h2>
            </div>
            <span className="read-only-badge">Read only</span>
          </header>
          <div className="overview-game__body">
            {device.snapshot ? (
              <>
                <Scoreboard snapshot={device.snapshot} announceUpdates={false} />
                <div className="current-play">
                  <span>Current at-bat</span>
                  <strong>{device.snapshot.atBat?.batter ?? "Mets batting"}</strong>
                  <p>{device.snapshot.lastEvent}</p>
                  <small>{device.feedFreshness}</small>
                </div>
              </>
            ) : (
              <div className="current-play apple-upcoming">
                <span>{status?.mode === "REPLAY" ? "Recorded game" : "Next game"}</span>
                <strong>{status ? describeNextGame(status.game, status.mode) : device.nextGame}</strong>
                <p>{status?.lastCelebration ? `Last celebration: ${status.lastCelebration.kind} · ${status.lastCelebration.subject}` : "No celebration yet."}</p>
                <small>{device.feedFreshness}</small>
              </div>
            )}
          </div>
          <footer>
            <span>
              {device.snapshot ? (
                <>
                  Device game <strong>{device.snapshot.gamePk}</strong>
                </>
              ) : status?.game ? (
                <>
                  Scheduled game <strong>{status.game.gamePk}</strong>
                </>
              ) : (
                <>Mode {device.operatingMode}</>
              )}
            </span>
            <button type="button" className="text-button" onClick={onOpenLive}>
              Open live game →
            </button>
          </footer>
        </article>
        <article className="manager-panel apple-state-card">
          <header className="panel-title">
            <div>
              <span>{live ? "Live from the Apple" : "Simulated state"}</span>
              <h2>{live ? "Apple position" : "Apple position preview"}</h2>
            </div>
            <span className={`state-badge ${tone === "safe" ? "state-badge--safe" : tone === "live" ? "state-badge--live" : ""}`}>
              {motionLabel}
            </span>
          </header>
          <div
            className="position-visual"
            role="img"
            aria-label={`Apple at ${device.positionMm} millimeters, ${motionLabel.toLowerCase()}`}
          >
            <div className="position-track">
              <span style={{ height: `${Math.min(100, Math.max(0, (device.positionMm / MAX_STROKE_MM) * 100))}%` }} />
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
          {live ? (
            <div className="apple-test" aria-label="Test celebrations">
              <div className="apple-test__buttons">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canTest}
                  onClick={() => void apple.testCelebration("hr")}
                >
                  {apple.pending === "hr" ? "Asking…" : "Test home run"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canTest}
                  onClick={() => void apple.testCelebration("win")}
                >
                  {apple.pending === "win" ? "Asking…" : "Test Mets win"}
                </button>
              </div>
              <p className="apple-test__note" aria-live="polite">
                {status!.fault
                  ? "The Apple has a fault set and will not move until it is cleared on the device."
                  : !apple.idle
                    ? `Running: ${motionLabel}${status!.audio.playing ? ` · ${status!.audio.playing.replace(/^\//, "")}` : ""}`
                    : status!.settings.motor
                      ? "Replays the Apple's recorded game: display, audio, lights, and the full lift. Keep the travel path clear."
                      : "Motor is disabled in the Manager; a test will play the screen and audio only."}
              </p>
              {apple.error ? (
                <p className="apple-test__error" role="alert">
                  {apple.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </article>
        <article className="manager-panel device-health">
          <header className="panel-title">
            <div>
              <span>{live ? "Live telemetry" : "Reference telemetry"}</span>
              <h2>{live ? "Apple health" : "Example device health"}</h2>
            </div>
            <span className="health-score">{healthScore}/4</span>
          </header>
          <div className="health-list">
            {status ? (
              <>
                <HealthItem
                  label="Game feed"
                  value={device.feedStatus}
                  detail={device.feedFreshness}
                  tone={status.poll.lastError ? "warning" : "good"}
                />
                <HealthItem
                  label="Wi-Fi"
                  value={`${status.wifi.rssi} dBm`}
                  detail={`${describeRssi(status.wifi.rssi)} · ${status.wifi.ssid || status.wifi.state}`}
                  tone={status.wifi.rssi >= -80 ? "good" : "warning"}
                />
                <HealthItem
                  label="Storage"
                  value={status.audio.card ? `${status.audio.tracks.length} tracks` : "No card"}
                  detail={
                    status.audio.card
                      ? `${status.audio.tracks.filter((track) => track.hr).length} home run · ${status.audio.tracks.filter((track) => track.win).length} win`
                      : "Celebrations are silent"
                  }
                  tone={status.audio.card ? "good" : "warning"}
                />
                <HealthItem
                  label="Firmware"
                  value={`v${status.firmwareVersion}`}
                  detail={`Slot ${status.firmwareSlot} · ${status.clock ? "clock synced" : "clock not synced"}`}
                  tone={status.clock ? "good" : "warning"}
                />
              </>
            ) : (
              <>
                <HealthItem label="Game feed" value={device.feedStatus} detail={device.feedFreshness} tone="good" />
                <HealthItem label="Wi-Fi" value={`${device.wifiSignalDbm} dBm`} detail={device.wifiNetwork} tone="good" />
                <HealthItem label="Power" value={device.power} detail="Stable external input" tone="good" />
                <HealthItem label="Firmware" value={`v${device.firmwareVersion}`} detail={`Uptime ${device.uptime}`} />
              </>
            )}
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

function describeMode(mode: string): string {
  switch (mode) {
    case "UPCOMING":
      return "Waiting for the next game";
    case "PAUSED":
      return "Paused in the Manager";
    case "OFFSEASON":
      return "Offseason";
    case "REPLAY":
      return "Replaying a recorded game";
    default:
      return mode.charAt(0) + mode.slice(1).toLowerCase().replace(/_/g, " ");
  }
}
