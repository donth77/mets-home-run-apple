import { AppleTestSession } from "../AppleTestSession";
import { MAX_STROKE_MM } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { describeLastCelebration, describeNextGame, describeRssi, describeSequence, sequenceTone } from "../appleDevice";
import { fakeManagedDevice, type DeviceTimelineEvent } from "../fakeDevice";
import { HealthItem, Timeline, WorkspaceHeading } from "../managerComponents";
import { type AppleDeviceState, liveApple } from "../useAppleDevice";

export function OverviewWorkspace({
  events,
  onOpenLive,
  apple,
}: {
  events: readonly DeviceTimelineEvent[];
  onOpenLive: () => void;
  apple?: AppleDeviceState;
}) {
  const live = liveApple(apple);
  const status = live?.status ?? null;
  const device = live?.device ?? fakeManagedDevice;
  const stale = live?.connection === "STALE";
  const tone = status ? (status.motionKnown ? sequenceTone(status.sequence, status.fault) : "warning") : "safe";
  const motionLabel = status
    ? status.motionKnown
      ? describeSequence(status.sequence, status.fault)
      : "Unknown"
    : "Home";
  // One click arms and runs: the button asks the Apple for a session, waits
  // for the owner's tap, then fires. Clicking again while waiting cancels.
  const canAsk = live !== null && !stale && live.status.motionKnown && !live.status.fault && live.status.settings.motor;
  const canClick = canAsk && live !== null && (live.queued !== null || (live.idle && live.pending === null));
  const waitSeconds = Math.max(0, Math.ceil((status?.maintenance.remainingMs ?? 0) / 1000));
  const healthy = status
    ? [
        status.wifi.state === "CONNECTED" && status.wifi.rssi >= -80,
        status.audio.card,
        status.clock,
        status.fault === false && status.motionKnown,
      ]
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
            ? `Live status from the Apple over ${live?.transport === "USB" ? "USB" : "Wi-Fi"}. Test celebrations run the Apple's own recorded game through its real engine; the Apple owns every safety decision.`
            : "Use scenarios, live feeds, historical games, and the USB bench workspace without putting this browser in the autonomous game loop. Connect your Apple from the sidebar to see it here."
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
              <h2>{status ? (device.snapshot ? "Live game" : describeMode(status.mode)) : "Example game state"}</h2>
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
                <p>
                  {status?.lastCelebration
                    ? `Last celebration: ${describeLastCelebration(status.lastCelebration)}`
                    : "No celebration yet."}
                </p>
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
              Open Apple now →
            </button>
          </footer>
        </article>
        <article className="manager-panel apple-state-card">
          <header className="panel-title">
            <div>
              <span>{live ? "Live from the Apple" : "Simulated state"}</span>
              <h2>{live ? "Apple position" : "Apple position preview"}</h2>
            </div>
            <span
              className={`state-badge ${tone === "safe" ? "state-badge--safe" : tone === "live" ? "state-badge--live" : ""}`}
            >
              {motionLabel}
            </span>
          </header>
          <div
            className="position-visual"
            role="img"
            aria-label={
              device.positionMm === null
                ? "Apple position unknown"
                : `Apple at ${device.positionMm} millimeters, ${motionLabel.toLowerCase()}`
            }
          >
            <div className="position-track">
              <span
                style={{ height: `${Math.min(100, Math.max(0, ((device.positionMm ?? 0) / MAX_STROKE_MM) * 100))}%` }}
              />
            </div>
            <div>
              <strong>{device.positionMm?.toFixed(1) ?? "Unknown"}</strong>
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
            <section className="apple-test" aria-label="Test celebrations">
              <AppleTestSession apple={live} />
              <div className="apple-test__buttons">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canClick || (live.queued !== null && live.queued !== "hr")}
                  onClick={() => void live.testCelebration("hr")}
                >
                  {live.queued === "hr"
                    ? `Waiting for the button… ${waitSeconds} s · cancel`
                    : live.pending === "hr"
                      ? "Starting…"
                      : "Test home run"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canClick || (live.queued !== null && live.queued !== "win")}
                  onClick={() => void live.testCelebration("win")}
                >
                  {live.queued === "win"
                    ? `Waiting for the button… ${waitSeconds} s · cancel`
                    : live.pending === "win"
                      ? "Starting…"
                      : "Test Mets win"}
                </button>
              </div>
              <p className="apple-test__note" aria-live="polite">
                {!live.status.motionKnown
                  ? "Motion status is incomplete; tests are disabled."
                  : live.status.fault
                    ? "The Apple has a fault set and will not move until it is cleared on the device."
                    : !live.idle
                      ? `Running: ${motionLabel}${live.status.audio.playing ? ` · ${live.status.audio.playing.replace(/^\//, "")}` : ""}`
                      : live.queued
                        ? "Walk to the Apple and tap its owner button once — don't hold it. The test starts by itself."
                        : live.status.settings.motor
                          ? "Replays the Apple's recorded game: display, audio, lights, and the full lift. You'll be asked to tap the Apple's button to approve it."
                          : "Motor is disabled in the Manager; a test will play the screen and audio only."}
              </p>
            </section>
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
                  label={device.feedLabel}
                  value={device.feedStatus}
                  detail={device.feedFreshness}
                  tone={device.feedHealthy ? "good" : "warning"}
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
                <HealthItem label={device.feedLabel} value={device.feedStatus} detail={device.feedFreshness} tone="good" />
                <HealthItem
                  label="Wi-Fi"
                  value={`${device.wifiSignalDbm} dBm`}
                  detail={device.wifiNetwork}
                  tone="good"
                />
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
