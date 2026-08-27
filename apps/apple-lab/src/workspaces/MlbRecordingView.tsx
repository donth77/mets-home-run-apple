import { Scoreboard } from "@apple/scoreboard-ui";
import type { MlbRecordingFeedState } from "../useMlbRecordingFeed";

export function MlbRecordingView({ recording }: { recording: MlbRecordingFeedState }) {
  const recordingActive = recording.status === "CONNECTING" || recording.status === "POLLING";
  const snapshot = recording.capture?.snapshot;

  return (
    <>
      <div className="recording-controls manager-panel">
        <label htmlFor="recording-date">
          Schedule date
          <input
            id="recording-date"
            type="date"
            value={recording.date}
            disabled={recordingActive}
            onChange={(event) => recording.setDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={recordingActive || recording.status === "DISCOVERING"}
          onClick={() => void recording.discover()}
        >
          {recording.status === "DISCOVERING" ? "Finding games…" : "Find Mets games"}
        </button>
        <label htmlFor="recording-game">
          Game
          <select
            id="recording-game"
            value={recording.selectedGame?.gamePk ?? ""}
            disabled={recordingActive || recording.games.length === 0}
            onChange={(event) => recording.selectGame(Number(event.target.value))}
          >
            <option value="">{recording.games.length === 0 ? "Discover a game first" : "Choose a game"}</option>
            {recording.games.map((game) => (
              <option key={game.gamePk} value={game.gamePk}>
                G{game.gameNumber} · {game.away.abbreviation} at {game.home.abbreviation} · {game.detailedState}
              </option>
            ))}
          </select>
        </label>
        {recordingActive ? (
          <button type="button" className="stop-button" onClick={recording.stop}>
            Stop recording
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={!recording.selectedGame}
            onClick={() => void recording.start()}
          >
            Start recording
          </button>
        )}
      </div>
      {recording.error && (
        <div className="recording-error" role="alert">
          <strong>Recording stopped</strong>
          <span>{recording.error}</span>
        </div>
      )}
      <div className="recording-grid">
        <article className="manager-panel recording-score-panel">
          <header className="panel-title">
            <div>
              <span>Normalized display state</span>
              <h2>{snapshot ? "Latest accepted capture" : "Waiting for a capture"}</h2>
            </div>
            <span className="read-only-badge">WASM · recording</span>
          </header>
          {snapshot ? (
            <>
              <Scoreboard snapshot={snapshot} variant="lab" />
              <div className="live-game-detail">
                <div>
                  <span>At bat</span>
                  <strong>{snapshot.atBat?.batter ?? "—"}</strong>
                </div>
                <div>
                  <span>Last feed event</span>
                  <strong>{snapshot.lastEvent}</strong>
                </div>
              </div>
            </>
          ) : (
            <div className="recording-empty">
              <strong>No live payload loaded</strong>
              <p>
                Choose a date, discover its Mets game, and start the recording transport. Opening this panel makes no
                network request by itself.
              </p>
            </div>
          )}
        </article>
        <aside className="manager-panel recording-health-panel">
          <header className="panel-title">
            <div>
              <span>Transport receipt</span>
              <h2>{recording.status}</h2>
            </div>
          </header>
          <dl className="detail-list">
            <div>
              <dt>Physical output</dt>
              <dd className="good-value">DISCONNECTED</dd>
            </div>
            <div>
              <dt>Payload</dt>
              <dd>{recording.payloadKind ?? "—"}</dd>
            </div>
            <div>
              <dt>Cursor</dt>
              <dd>
                <code>{recording.capture?.cursor ?? "—"}</code>
              </dd>
            </div>
            <div>
              <dt>Fresh plays</dt>
              <dd>
                {recording.capture ? `${recording.capture.changedPlayCount} of ${recording.capture.rawPlayCount}` : "—"}
              </dd>
            </div>
            <div>
              <dt>Upstream wait</dt>
              <dd>{recording.capture ? `${recording.capture.waitMs / 1000} seconds` : "—"}</dd>
            </div>
            <div>
              <dt>Next request</dt>
              <dd>
                {recording.nextPollAt
                  ? new Date(recording.nextPollAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "—"}
              </dd>
            </div>
          </dl>
        </aside>
        <article className="manager-panel core-receipt-panel">
          <header className="panel-title panel-title--timeline">
            <div>
              <span>Canonical decision result</span>
              <h2>C++ core receipt</h2>
            </div>
            <small>No TypeScript event rules</small>
          </header>
          {!recording.decision ? (
            <p className="empty-state">No envelope has been evaluated in this session.</p>
          ) : (
            <div className="core-receipt">
              <div className="core-receipt__summary">
                <span>Sequence</span>
                <strong>{recording.decision.sequenceState}</strong>
                <span>Fault latch</span>
                <strong>{recording.decision.faultLatched ? "LATCHED" : "CLEAR"}</strong>
              </div>
              <div>
                <span>Commands</span>
                {recording.decision.commands.length === 0 ? (
                  <code>NO_COMMAND</code>
                ) : (
                  recording.decision.commands.map((command) => (
                    <code key={`${command.eventKey}-${command.type}-${command.positionMm ?? "none"}`}>
                      {command.type} · {command.eventKey}
                    </code>
                  ))
                )}
              </div>
              <div>
                <span>Trace</span>
                {recording.decision.traces.length === 0 ? (
                  <code>NO_CHANGE</code>
                ) : (
                  recording.decision.traces.map((entry) => (
                    <code key={`${entry.code}-${entry.detail}`}>
                      {entry.code}
                      {entry.detail ? ` · ${entry.detail}` : ""}
                    </code>
                  ))
                )}
              </div>
            </div>
          )}
        </article>
        <aside className="manager-panel recording-boundary-panel">
          <header className="panel-title">
            <div>
              <span>Safety boundary</span>
              <h2>Observation only</h2>
            </div>
          </header>
          <ul className="check-list">
            <li>
              <i />
              Direct browser transport is opt-in
            </li>
            <li>
              <i />
              Historical bootstrap events are seeded, not replayed
            </li>
            <li>
              <i />
              Diff cursor honors MLB’s wait interval
            </li>
            <li>
              <i />
              Review-pending evidence remains still
            </li>
            <li>
              <i />
              No local-device or GPIO command route exists
            </li>
          </ul>
        </aside>
      </div>
    </>
  );
}
