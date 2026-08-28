import type { PresentationSnapshot } from "@apple/protocol";

export function LiveGamedayWidget({
  snapshot,
  standby = false,
}: {
  snapshot: PresentationSnapshot;
  standby?: boolean;
}) {
  const activityLabel = standby ? "Updates paused" : snapshot.phase === "DELAYED" ? "Game delayed" : "Live game";

  return (
    <aside className="gameday-card" aria-label="Current game on MLB Gameday">
      <a
        href={`https://www.mlb.com/gameday/${snapshot.gamePk}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`${snapshot.away.name} at ${snapshot.home.name}; open MLB Gameday in a new tab`}
      >
        <header>
          <span>
            <i aria-hidden="true" /> {activityLabel}
          </span>
          <small>MLB Gameday</small>
        </header>
        <div className="gameday-card__body">
          <div className="gameday-card__details">
            <strong>
              {snapshot.away.abbreviation} at {snapshot.home.abbreviation}
            </strong>
            <span>{standby ? "Check MLB Gameday for the latest score" : "Pitch-by-pitch, box score & Statcast"}</span>
          </div>
          <b className="gameday-card__action">
            Open <i aria-hidden="true">↗</i>
          </b>
        </div>
      </a>
    </aside>
  );
}
