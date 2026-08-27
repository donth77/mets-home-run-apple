import { Scoreboard } from "@apple/scoreboard-ui";
import { METS_TEAM_ID, dateFromMlbTimecode, type MlbHistoricalBookmark } from "@apple/mlb-live-feed";
import { useMlbHistoricalReplay } from "./useMlbHistoricalReplay";

function timecodeLabel(timecode: string | undefined) {
  if (!timecode) return "—";
  return dateFromMlbTimecode(timecode).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function bookmarkContext(bookmark: MlbHistoricalBookmark) {
  if (bookmark.kind === "FINAL") return "Final transition";
  return bookmark.battingTeamId === METS_TEAM_ID ? "Mets home run" : "Opponent home run";
}

export function HistoricalReplayPanel() {
  const replay = useMlbHistoricalReplay();
  const busy = ["DISCOVERING", "INDEXING", "LOADING"].includes(replay.status);
  const updateCount = replay.archive?.timestamps.length ?? 0;
  const progress = updateCount === 0 || replay.currentIndex < 0 ? 0 : ((replay.currentIndex + 1) / updateCount) * 100;

  return (
    <div className="historical-replay">
      <div className="live-notice live-notice--replay" role="note">
        <strong>Recording-only replay</strong>
        <span>
          Archived MLB data is evaluated by the real C++/WASM core through recording-only outputs. This internal Apple
          Lab source cannot reach physical outputs.
        </span>
      </div>

      <section className="manager-panel archive-controls" aria-label="Historical replay source">
        <label htmlFor="archive-date">
          Completed game date
          <input
            id="archive-date"
            type="date"
            value={replay.date}
            disabled={busy || replay.playing}
            onChange={(event) => replay.setDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || replay.playing}
          onClick={() => void replay.discover()}
        >
          {replay.status === "DISCOVERING" ? "Finding games…" : "Find Mets games"}
        </button>
        <label htmlFor="archive-game">
          Game
          <select
            id="archive-game"
            value={replay.selectedGame?.gamePk ?? ""}
            disabled={busy || replay.playing || replay.games.length === 0}
            onChange={(event) => replay.selectGame(Number(event.target.value))}
          >
            <option value="">{replay.games.length === 0 ? "Discover a completed date first" : "Choose a game"}</option>
            {replay.games.map((game) => (
              <option key={game.gamePk} value={game.gamePk}>
                G{game.gameNumber} · {game.away.abbreviation} at {game.home.abbreviation} · {game.detailedState}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={busy || replay.playing || !replay.selectedGame}
          onClick={() => void replay.loadArchive()}
        >
          {replay.status === "INDEXING" ? "Indexing archive…" : "Load archive"}
        </button>
      </section>

      {replay.error && (
        <div className="recording-error" role="alert">
          <strong>Historical replay stopped</strong>
          <span>{replay.error}</span>
        </div>
      )}

      {replay.archive ? (
        <>
          <section className="manager-panel replay-transport" aria-label="Historical replay transport controls">
            <div className="replay-transport__status">
              <span>Archive position</span>
              <strong>
                {replay.currentIndex < 0 ? "Not staged" : `Update ${replay.currentIndex + 1} of ${updateCount}`}
              </strong>
              <small>
                {timecodeLabel(replay.currentTimecode)} · {replay.status}
              </small>
            </div>
            <div className="replay-buttons">
              <button type="button" disabled={busy || replay.playing} onClick={() => void replay.stageAt(0)}>
                Stage start
              </button>
              <button
                type="button"
                disabled={busy || replay.playing || replay.currentIndex <= 0}
                onClick={() => void replay.step(-1)}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={busy || replay.playing || replay.currentIndex >= updateCount - 1}
                onClick={() => void replay.step(1)}
              >
                Next update
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy && !replay.playing}
                onClick={() => void replay.togglePlaying()}
              >
                {replay.playing ? "Pause replay" : "Play replay"}
              </button>
              <label htmlFor="archive-speed">
                Speed
                <select
                  id="archive-speed"
                  value={replay.speed}
                  disabled={busy}
                  onChange={(event) => replay.setSpeed(Number(event.target.value))}
                >
                  <option value="0.5">0.5 update/s</option>
                  <option value="1">1 update/s</option>
                  <option value="2">2 updates/s</option>
                </select>
              </label>
            </div>
            <div
              className="replay-progress"
              role="progressbar"
              aria-label="Historical replay progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          </section>

          <div className="historical-grid">
            <article className="manager-panel historical-score-panel">
              <header className="panel-title">
                <div>
                  <span>Timecoded MLB snapshot</span>
                  <h2>{replay.capture ? "Normalized game state" : "Stage an archive update"}</h2>
                </div>
                <span className="read-only-badge">WASM · recording</span>
              </header>
              {replay.capture ? (
                <>
                  <Scoreboard snapshot={replay.capture.snapshot} variant="lab" />
                  <div className="live-game-detail">
                    <div>
                      <span>Feed event</span>
                      <strong>{replay.capture.snapshot.lastEvent}</strong>
                    </div>
                    <div>
                      <span>Delivery cursor</span>
                      <strong>
                        <code>{replay.capture.cursor}</code>
                      </strong>
                    </div>
                  </div>
                </>
              ) : (
                <div className="recording-empty">
                  <strong>Archive indexed</strong>
                  <p>
                    Stage the beginning, step through updates, or run one of the event bookmarks. Staging seeds prior
                    events and never celebrates history.
                  </p>
                </div>
              )}
            </article>

            <aside className="manager-panel archive-summary-panel">
              <header className="panel-title">
                <div>
                  <span>Archive index</span>
                  <h2>{updateCount} updates</h2>
                </div>
              </header>
              <dl className="detail-list">
                <div>
                  <dt>Game</dt>
                  <dd>
                    {replay.selectedGame?.gamePk} · G{replay.selectedGame?.gameNumber}
                  </dd>
                </div>
                <div>
                  <dt>Bookmarks</dt>
                  <dd>{replay.archive.bookmarks.length}</dd>
                </div>
                <div>
                  <dt>Payload</dt>
                  <dd>{replay.payloadKind ?? "—"}</dd>
                </div>
                <div>
                  <dt>Physical output</dt>
                  <dd className="good-value">DISCONNECTED</dd>
                </div>
                <div>
                  <dt>Stored raw feed</dt>
                  <dd>NONE</dd>
                </div>
              </dl>
            </aside>

            <article className="manager-panel bookmark-panel">
              <header className="panel-title panel-title--timeline">
                <div>
                  <span>Targeted regression checks</span>
                  <h2>Event bookmarks</h2>
                </div>
                <small>Stage before → run transition</small>
              </header>
              {replay.archive.bookmarks.length === 0 ? (
                <p className="empty-state">This archived game has no home-run or final-state bookmarks.</p>
              ) : (
                <ol className="bookmark-list">
                  {replay.archive.bookmarks.map((bookmark) => (
                    <li key={bookmark.id}>
                      <div>
                        <span>{bookmarkContext(bookmark)}</span>
                        <strong>{bookmark.label}</strong>
                        <p>{bookmark.detail}</p>
                        <small>
                          {timecodeLabel(bookmark.targetTimecode)} · update {bookmark.targetIndex + 1}
                        </small>
                      </div>
                      <div className="bookmark-actions">
                        <button
                          type="button"
                          disabled={busy || replay.playing}
                          onClick={() => void replay.stageBookmark(bookmark)}
                        >
                          {replay.stagedBookmarkId === bookmark.id && replay.currentIndex === bookmark.beforeIndex
                            ? "Staged"
                            : "Stage before"}
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={busy || replay.playing}
                          onClick={() => void replay.runBookmark(bookmark)}
                        >
                          Run event
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </article>

            <aside className="manager-panel historical-core-panel">
              <header className="panel-title">
                <div>
                  <span>Canonical decision result</span>
                  <h2>C++ core receipt</h2>
                </div>
              </header>
              {!replay.decision ? (
                <p className="empty-state">No archived input has been evaluated.</p>
              ) : (
                <div className="core-receipt historical-core-receipt">
                  <div className="core-receipt__summary">
                    <span>Sequence</span>
                    <strong>{replay.decision.sequenceState}</strong>
                    <span>Fault</span>
                    <strong>{replay.decision.faultLatched ? "LATCHED" : "CLEAR"}</strong>
                  </div>
                  <div>
                    <span>Commands</span>
                    {replay.decision.commands.length === 0 ? (
                      <code>NO_COMMAND</code>
                    ) : (
                      replay.decision.commands.map((command) => (
                        <code key={`${command.eventKey}-${command.type}-${command.positionMm ?? "none"}`}>
                          {command.type} · {command.celebration} · {command.subject}
                        </code>
                      ))
                    )}
                  </div>
                  <div>
                    <span>Trace</span>
                    {replay.decision.traces.length === 0 ? (
                      <code>NO_CHANGE</code>
                    ) : (
                      replay.decision.traces.map((entry) => (
                        <code key={`${entry.code}-${entry.detail}`}>
                          {entry.code}
                          {entry.detail ? ` · ${entry.detail}` : ""}
                        </code>
                      ))
                    )}
                  </div>
                </div>
              )}
            </aside>
          </div>

          <section className="manager-panel replay-receipts" aria-label="Historical replay receipts">
            <header className="panel-title panel-title--timeline">
              <div>
                <span>Bounded browser session</span>
                <h2>Replay receipts</h2>
              </div>
              <small>
                {replay.receipts.length} accepted capture{replay.receipts.length === 1 ? "" : "s"}
              </small>
            </header>
            {replay.receipts.length === 0 ? (
              <p className="empty-state">No replay captures yet.</p>
            ) : (
              <ol>
                {replay.receipts.slice(0, 12).map((receipt) => (
                  <li key={receipt.id}>
                    <time dateTime={dateFromMlbTimecode(receipt.timecode).toISOString()}>
                      {timecodeLabel(receipt.timecode)}
                    </time>
                    <span>Update {receipt.updateIndex + 1}</span>
                    <strong>{receipt.capture.snapshot.phase}</strong>
                    <code>{receipt.payloadKind}</code>
                    <span>
                      {receipt.decision.commands.map((command) => command.celebration).join(" · ") || "NO_COMMAND"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : (
        <section className="manager-panel historical-empty">
          <strong>Choose a completed Mets game</strong>
          <p>
            Loading an archive fetches its timestamp index and final feed only after you ask. No request is made merely
            by opening this local demo surface.
          </p>
        </section>
      )}
    </div>
  );
}
